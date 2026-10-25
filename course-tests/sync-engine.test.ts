import { AuthorizationError } from '../src/application/auth/authorization.error';
import {
  EnqueueIncidentActionUseCase,
  type KnownIncident,
} from '../src/application/sync/enqueue-incident-action.usecase';
import type {
  RemoteSubmitResult,
  SyncRemotePort,
} from '../src/application/sync/sync-remote.port';
import { SyncService } from '../src/application/sync/sync.service';
import { deduplicateOperations } from '../src/domain/sync/deduplicate-operations';
import type { OfflineQueuePort } from '../src/domain/sync/offline-queue.port';
import type { PendingOperation } from '../src/domain/sync/pending-operation';
import { resolveSync } from '../src/domain/sync/resolve-sync';
import type { SyncSnapshot } from '../src/domain/sync/sync.types';

/**
 * Doble de prueba del puerto de cola. La implementación persistente real
 * (SQLite) vive en infraestructura; aquí sólo se verifica la política del
 * motor de sincronización.
 */
class QueueDouble implements OfflineQueuePort {
  readonly items: PendingOperation[] = [];
  async enqueue(operation: PendingOperation): Promise<void> {
    if (!this.items.some((item) => item.operationId === operation.operationId)) {
      this.items.push(operation);
    }
  }
  async list(): Promise<readonly PendingOperation[]> {
    return [...this.items];
  }
  async replace(operation: PendingOperation): Promise<void> {
    const index = this.items.findIndex((item) => item.operationId === operation.operationId);
    if (index >= 0) this.items[index] = operation;
  }
  async remove(operationId: string): Promise<void> {
    const index = this.items.findIndex((item) => item.operationId === operationId);
    if (index >= 0) this.items.splice(index, 1);
  }
}

/** Servidor simulado con idempotencia por clave y control de versión. */
class RemoteDouble implements SyncRemotePort {
  readonly applied = new Map<string, number>();
  effects = 0;
  version = 1;
  assignedTechnicianId: string | null = 'technician-1';
  status = 'assigned';
  scripted: RemoteSubmitResult[] = [];
  submitCalls: string[] = [];

  async submit(operation: PendingOperation): Promise<RemoteSubmitResult> {
    this.submitCalls.push(operation.operationId);
    const next = this.scripted.shift();
    if (next) return next;
    const previous = this.applied.get(operation.operationId);
    if (previous !== undefined) return { kind: 'applied', version: previous, duplicate: true };
    if (operation.authorId.startsWith('technician') && operation.authorId !== this.assignedTechnicianId) {
      return { kind: 'conflict', reason: 'forbidden' };
    }
    if (operation.baseVersion !== this.version) {
      return { kind: 'conflict', reason: 'version_conflict', currentVersion: this.version };
    }
    this.version += 1;
    this.effects += 1;
    if (operation.action === 'start') this.status = 'in_progress';
    this.applied.set(operation.operationId, this.version);
    return { kind: 'applied', version: this.version, duplicate: false };
  }

  async fetchSnapshot(incidentId: string, actorId: string): Promise<SyncSnapshot | null> {
    if (actorId.startsWith('technician') && actorId !== this.assignedTechnicianId) return null;
    return {
      id: incidentId,
      version: this.version,
      fields: { work: { assignedTechnicianId: this.assignedTechnicianId, status: this.status } },
    };
  }
}

const incidentV1: KnownIncident = {
  id: 'campus-inc-001',
  version: 1,
  reporterId: 'reporter-1',
  assignedTechnicianId: 'technician-1',
  status: 'assigned',
};

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function ids(prefix = 'op-week08') {
  let counter = 0;
  return () => `${prefix}-${String(++counter).padStart(4, '0')}`;
}

const fixedClock = () => new Date('2026-10-25T12:00:00.000Z');

describe('resolveSync (motor real de CampusOps)', () => {
  it('declara conflicto en work cuando se cruzan inicio local y reasignación remota', () => {
    const base = deepFreeze({ id: 'campus-inc-001', version: 1, fields: { work: { assignedTechnicianId: 'technician-1', status: 'assigned' } } });
    const local = deepFreeze({ ...base, fields: { work: { assignedTechnicianId: 'technician-1', status: 'in_progress' } } });
    const remote = deepFreeze({ ...base, version: 2, fields: { work: { assignedTechnicianId: 'technician-2', status: 'assigned' } } });
    expect(resolveSync(base, local, remote)).toEqual({ kind: 'conflict', fields: ['work'] });
  });

  it('reporta varios campos incompatibles en orden de nombre', () => {
    const base = { id: 'r1', version: 1, fields: { title: 'A', priority: 1, area: 'x' } };
    const local = { id: 'r1', version: 1, fields: { title: 'L', priority: 3, area: 'x' } };
    const remote = { id: 'r1', version: 2, fields: { title: 'R', priority: 2, area: 'x' } };
    expect(resolveSync(base, local, remote)).toEqual({ kind: 'conflict', fields: ['priority', 'title'] });
  });

  it('compara por contenido JSON: mismo contenido con distinto orden de claves no es conflicto', () => {
    const base = { id: 'r1', version: 1, fields: { work: { assignedTechnicianId: 't1', status: 'assigned' } } };
    const local = { id: 'r1', version: 1, fields: { work: { status: 'in_progress', assignedTechnicianId: 't1' } } };
    const remote = { id: 'r1', version: 2, fields: { work: { assignedTechnicianId: 't1', status: 'in_progress' } } };
    expect(resolveSync(base, local, remote)).toEqual({
      kind: 'merged',
      fields: { work: { status: 'in_progress', assignedTechnicianId: 't1' } },
    });
  });

  it('combina campos independientes sin mutar las entradas', () => {
    const base = deepFreeze({ id: 'r1', version: 1, fields: { note: 'a', priority: 'medium' } });
    const local = deepFreeze({ id: 'r1', version: 1, fields: { note: 'nota local', priority: 'medium' } });
    const remote = deepFreeze({ id: 'r1', version: 2, fields: { note: 'a', priority: 'high' } });
    const before = JSON.stringify([base, local, remote]);
    expect(resolveSync(base, local, remote)).toEqual({ kind: 'merged', fields: { note: 'nota local', priority: 'high' } });
    expect(JSON.stringify([base, local, remote])).toBe(before);
  });
});

describe('deduplicateOperations', () => {
  it('conserva la primera operación de cada operationId sin mutar la entrada', () => {
    const operations = deepFreeze([
      { operationId: 'op-1', value: 'primera' },
      { operationId: 'op-2', value: 'otra' },
      { operationId: 'op-1', value: 'repetida' },
    ]);
    const result = deduplicateOperations(operations);
    expect(result).toEqual([operations[0], operations[1]]);
    expect(result[0]).toBe(operations[0]);
    expect(operations).toHaveLength(3);
  });
});

describe('EnqueueIncidentActionUseCase (autorización semana 6)', () => {
  it('encola inicio de atención del técnico asignado con identidad estable y versión base', async () => {
    const queue = new QueueDouble();
    const useCase = new EnqueueIncidentActionUseCase(queue, ids(), fixedClock);
    const operation = await useCase.execute({ actorId: 'technician-1', incident: incidentV1, action: 'start' });
    expect(operation).toMatchObject({
      operationId: 'op-week08-0001',
      incidentId: 'campus-inc-001',
      authorId: 'technician-1',
      baseVersion: 1,
      status: 'pending',
      localFields: { work: { assignedTechnicianId: 'technician-1', status: 'in_progress' } },
    });
    expect(await queue.list()).toEqual([operation]);
  });

  it('rechaza a un técnico no asignado y a un reportante sin encolar nada', async () => {
    const queue = new QueueDouble();
    const useCase = new EnqueueIncidentActionUseCase(queue, ids(), fixedClock);
    await expect(useCase.execute({ actorId: 'technician-2', incident: incidentV1, action: 'start' })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(useCase.execute({ actorId: 'reporter-1', incident: incidentV1, action: 'start' })).rejects.toBeInstanceOf(AuthorizationError);
    expect(await queue.list()).toEqual([]);
  });

  it('registra una referencia de fotografía pendiente sin afirmar que se subió', async () => {
    const queue = new QueueDouble();
    const useCase = new EnqueueIncidentActionUseCase(queue, ids(), fixedClock);
    const operation = await useCase.execute({
      actorId: 'technician-1',
      incident: incidentV1,
      action: 'add_evidence',
      payload: { evidenceId: 'photo-ref-local-001' },
    });
    expect(operation.payload).toEqual({ evidenceId: 'photo-ref-local-001' });
    expect(operation.localFields.work).toEqual(operation.baseFields.work);
    expect(operation.status).toBe('pending');
  });
});

describe('SyncService (política de cola)', () => {
  async function setup() {
    const queue = new QueueDouble();
    const remote = new RemoteDouble();
    const enqueue = new EnqueueIncidentActionUseCase(queue, ids(), fixedClock);
    const sync = new SyncService(queue, remote, { maxAttempts: 2 });
    return { queue, remote, enqueue, sync };
  }

  it('confirma y retira sólo la operación aplicada por el servidor', async () => {
    const { queue, remote, enqueue, sync } = await setup();
    const op = await enqueue.execute({ actorId: 'technician-1', incident: incidentV1, action: 'start' });
    const report = await sync.syncPending();
    expect(report.confirmed).toEqual([op.operationId]);
    expect(report.retained).toEqual([]);
    expect(remote.effects).toBe(1);
    expect(await queue.list()).toEqual([]);
  });

  it('reasignación concurrente: declara conflicto en work, conserva la intención local y no toca la asignación remota', async () => {
    const { queue, remote, enqueue, sync } = await setup();
    const op = await enqueue.execute({ actorId: 'technician-1', incident: incidentV1, action: 'start' });
    // Mientras el técnico está sin conexión, coordinación reasigna en el servidor.
    remote.assignedTechnicianId = 'technician-2';
    remote.version = 2;

    const report = await sync.syncPending();

    expect(report.conflicts).toEqual([
      { operationId: op.operationId, incidentId: 'campus-inc-001', fields: ['work'], reason: 'forbidden' },
    ]);
    expect(report.confirmed).toEqual([]);
    expect(report.retained).toEqual([op.operationId]);
    const stored = (await queue.list())[0] as PendingOperation;
    expect(stored.status).toBe('conflict');
    expect(stored.localFields).toEqual(op.localFields);
    expect(stored.baseVersion).toBe(1);
    expect(remote.assignedTechnicianId).toBe('technician-2');
    expect(remote.effects).toBe(0);

    // Una nueva sincronización no reenvía en bucle una operación en conflicto.
    await sync.syncPending();
    expect(remote.submitCalls).toEqual([op.operationId]);
  });

  it('rebasa una operación compatible cuando sólo cambió la versión remota', async () => {
    const { queue, remote, enqueue, sync } = await setup();
    const op = await enqueue.execute({ actorId: 'technician-1', incident: incidentV1, action: 'start' });
    remote.version = 2; // p. ej. coordinación cambió la prioridad, no work.

    const first = await sync.syncPending();
    expect(first.rebased).toEqual([op.operationId]);
    expect((await queue.list())[0]).toMatchObject({ baseVersion: 2, status: 'pending', operationId: op.operationId });

    const second = await sync.syncPending();
    expect(second.confirmed).toEqual([op.operationId]);
    expect(remote.effects).toBe(1);
  });

  it('reenvío con la misma identidad: el servidor no aplica dos veces el efecto', async () => {
    const { queue, remote, enqueue, sync } = await setup();
    const op = await enqueue.execute({ actorId: 'technician-1', incident: incidentV1, action: 'start' });
    // Respuesta perdida: el servidor aplicó pero el cliente no recibió confirmación.
    await remote.submit(op);
    remote.submitCalls = [];
    expect(remote.effects).toBe(1);

    const report = await sync.syncPending();
    expect(report.confirmed).toEqual([op.operationId]);
    expect(report.duplicates).toEqual([op.operationId]);
    expect(remote.effects).toBe(1);
    expect(await queue.list()).toEqual([]);
  });

  it('deduplica la cola antes de enviar', async () => {
    const { queue, remote, enqueue, sync } = await setup();
    const op = await enqueue.execute({ actorId: 'technician-1', incident: incidentV1, action: 'start' });
    queue.items.push({ ...op }); // copia corrupta con la misma identidad
    await sync.syncPending();
    expect(remote.submitCalls).toEqual([op.operationId]);
    expect(remote.effects).toBe(1);
  });

  it('error 500 o timeout no retira la operación; tras agotar intentos queda failed pero en cola', async () => {
    const { queue, remote, enqueue, sync } = await setup();
    const op = await enqueue.execute({ actorId: 'technician-1', incident: incidentV1, action: 'start' });
    remote.scripted = [
      { kind: 'retryable', reason: 'controlled_failure' },
      { kind: 'retryable', reason: 'timeout' },
    ];

    const first = await sync.syncPending();
    expect(first.retained).toEqual([op.operationId]);
    expect((await queue.list())[0]).toMatchObject({ attempts: 1, status: 'pending', lastError: 'controlled_failure' });

    await sync.syncPending();
    expect((await queue.list())[0]).toMatchObject({ attempts: 2, status: 'failed', lastError: 'timeout' });

    // `failed` no se reenvía automáticamente ni se descarta.
    await sync.syncPending();
    expect(remote.submitCalls).toHaveLength(2);
    expect(remote.effects).toBe(0);
    expect(await queue.list()).toHaveLength(1);
  });

  it('una excepción de red del adaptador se controla y conserva la operación', async () => {
    const queue = new QueueDouble();
    const failing: SyncRemotePort = {
      submit: async () => { throw new TypeError('Network request failed'); },
      fetchSnapshot: async () => null,
    };
    const enqueue = new EnqueueIncidentActionUseCase(queue, ids(), fixedClock);
    const op = await enqueue.execute({ actorId: 'technician-1', incident: incidentV1, action: 'start' });
    const report = await new SyncService(queue, failing).syncPending();
    expect(report.retained).toEqual([op.operationId]);
    expect((await queue.list())[0]?.lastError).toBe('network');
  });

  it('sincronizaciones simultáneas comparten una sola ejecución', async () => {
    const { remote, enqueue, sync } = await setup();
    await enqueue.execute({ actorId: 'technician-1', incident: incidentV1, action: 'start' });
    const [a, b] = await Promise.all([sync.syncPending(), sync.syncPending()]);
    expect(a).toBe(b);
    expect(remote.submitCalls).toHaveLength(1);
  });

  it('el conflicto sólo se retira por decisión explícita del autor', async () => {
    const { queue, remote, enqueue, sync } = await setup();
    const op = await enqueue.execute({ actorId: 'technician-1', incident: incidentV1, action: 'start' });
    remote.assignedTechnicianId = 'technician-2';
    remote.version = 2;
    await sync.syncPending();

    // Sin visibilidad remota, reintentar no inventa una base nueva.
    const retried = await sync.resolveConflict(op.operationId, 'retry_on_remote');
    expect(retried?.status).toBe('conflict');
    expect(await queue.list()).toHaveLength(1);

    const discarded = await sync.resolveConflict(op.operationId, 'discard_local');
    expect(discarded?.operationId).toBe(op.operationId);
    expect(await queue.list()).toEqual([]);
  });
});
