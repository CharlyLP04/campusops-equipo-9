import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';

import { EnqueueIncidentActionUseCase } from '../src/application/sync/enqueue-incident-action.usecase';
import { SyncService } from '../src/application/sync/sync.service';
import type { OfflineQueuePort } from '../src/domain/sync/offline-queue.port';
import type { PendingOperation } from '../src/domain/sync/pending-operation';
import { HttpSyncRemote } from '../src/infrastructure/sync/http-sync-remote';

/**
 * Integración contra el backend didáctico real (course-backend/server.mjs),
 * sin Internet público: se levanta en 127.0.0.1 con un puerto libre y se
 * conecta por `node:http` para evitar el mock de `fetch` de jest-expo.
 */
function nodeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === 'string' ? input : input.toString());
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      {
        method: init?.method ?? 'GET',
        headers: init?.headers as http.OutgoingHttpHeaders,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const status = res.statusCode ?? 500;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            json: async () => JSON.parse(text),
            text: async () => text,
          } as Response);
        });
      },
    );

    const abort = () => {
      req.destroy();
      const error = new Error('The operation was aborted.');
      error.name = 'AbortError';
      reject(error);
    };

    if (init?.signal) {
      if (init.signal.aborted) {
        abort();
        return;
      }
      init.signal.addEventListener('abort', abort, { once: true });
    }

    req.on('error', reject);
    if (typeof init?.body === 'string') {
      req.write(init.body);
    }
    req.end();
  });
}

class QueueDouble implements OfflineQueuePort {
  readonly items: PendingOperation[] = [];
  async enqueue(operation: PendingOperation) {
    if (!this.items.some((item) => item.operationId === operation.operationId)) this.items.push(operation);
  }
  async list() {
    return [...this.items];
  }
  async replace(operation: PendingOperation) {
    const index = this.items.findIndex((item) => item.operationId === operation.operationId);
    if (index >= 0) this.items[index] = operation;
  }
  async remove(operationId: string) {
    const index = this.items.findIndex((item) => item.operationId === operationId);
    if (index >= 0) this.items.splice(index, 1);
  }
}

let server: ChildProcessWithoutNullStreams;
let baseUrl = '';

function startBackend(): Promise<void> {
  return new Promise((resolve, reject) => {
    server = spawn(process.execPath, [path.join(__dirname, '..', 'course-backend', 'server.mjs')], {
      env: { ...process.env, COURSE_BACKEND_HOST: '127.0.0.1', COURSE_BACKEND_PORT: '0' },
    });
    const timer = setTimeout(() => reject(new Error('backend did not start')), 10000);
    server.stdout.on('data', (chunk: Buffer) => {
      const match = /listening at (http:\/\/[^\s]+)/.exec(chunk.toString());
      if (match) {
        clearTimeout(timer);
        baseUrl = match[1] ?? '';
        resolve();
      }
    });
    server.on('error', reject);
  });
}

async function coordinatorAction(body: Record<string, unknown>, key: string) {
  const response = await nodeFetch(`${baseUrl}/v1/incidents/campus-inc-001/actions`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer course-valid-token',
      'X-Course-Actor': 'coordinator-1',
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as { incident: { version: number; payload: Record<string, unknown> } } };
}

async function readIncident() {
  const response = await nodeFetch(`${baseUrl}/v1/incidents/campus-inc-001`, {
    headers: { Authorization: 'Bearer course-valid-token', 'X-Course-Actor': 'coordinator-1' },
  });
  return (await response.json()) as { version: number; status: string; payload: { assignedTechnicianId: string; notes: unknown[]; history: unknown[] } };
}

beforeAll(startBackend, 15000);
afterAll(() => {
  server?.kill();
});

const incidentV1 = {
  id: 'campus-inc-001',
  version: 1,
  reporterId: 'reporter-1',
  assignedTechnicianId: 'technician-1',
  status: 'assigned',
} as const;

describe('SyncService + HttpSyncRemote contra course-backend', () => {
  it('reasignación remota vs inicio offline: conflicto en work, cola intacta y asignación remota preservada', async () => {
    const queue = new QueueDouble();
    let n = 0;
    const enqueue = new EnqueueIncidentActionUseCase(queue, () => `offline-start-${++n}-tech1`);
    const sync = new SyncService(queue, new HttpSyncRemote({ baseUrl, fetchImpl: nodeFetch }));

    // 1. Sin conexión: technician-1 inicia atención desde la versión base 1.
    const op = await enqueue.execute({ actorId: 'technician-1', incident: incidentV1, action: 'start' });

    // 2. Mientras tanto, coordinación reasigna en el servidor.
    const reassign = await coordinatorAction({ action: 'assign', baseVersion: 1, technicianId: 'technician-2' }, 'reassign-week08-it');
    expect(reassign.status).toBe(201);

    // 3. Al reconectar se detecta el conflicto.
    const report = await sync.syncPending();
    expect(report.conflicts).toEqual([
      { operationId: op.operationId, incidentId: 'campus-inc-001', fields: ['work'], reason: 'forbidden' },
    ]);
    expect(report.retained).toEqual([op.operationId]);
    expect((await queue.list())[0]).toMatchObject({ status: 'conflict', localFields: op.localFields });

    const remote = await readIncident();
    expect(remote.version).toBe(2);
    expect(remote.status).toBe('assigned');
    expect(remote.payload.assignedTechnicianId).toBe('technician-2');
  });

  it('reenvío con la misma operationId: el backend responde duplicate y aplica el efecto una sola vez', async () => {
    const before = await readIncident();
    const queue = new QueueDouble();
    const enqueue = new EnqueueIncidentActionUseCase(queue, () => 'offline-note-tech2-0001');
    const remote = new HttpSyncRemote({ baseUrl, fetchImpl: nodeFetch });
    const sync = new SyncService(queue, remote);

    const op = await enqueue.execute({
      actorId: 'technician-2',
      incident: { ...incidentV1, version: before.version, assignedTechnicianId: 'technician-2' },
      action: 'comment',
      payload: { text: 'Nota ficticia registrada sin conexion' },
    });

    // Respuesta perdida: el servidor aplicó, pero la operación sigue en la cola.
    const lost = await remote.submit(op);
    expect(lost).toMatchObject({ kind: 'applied', duplicate: false });

    const report = await sync.syncPending();
    expect(report.confirmed).toEqual([op.operationId]);
    expect(report.duplicates).toEqual([op.operationId]);
    expect(await queue.list()).toEqual([]);

    const after = await readIncident();
    expect(after.version).toBe(before.version + 1);
    expect(after.payload.notes).toHaveLength(before.payload.notes.length + 1);
  });

  it('error 500 controlado: la operación no se retira de la cola', async () => {
    const current = await readIncident();
    const queue = new QueueDouble();
    const enqueue = new EnqueueIncidentActionUseCase(queue, () => 'offline-note-tech2-0500');
    const sync = new SyncService(queue, new HttpSyncRemote({ baseUrl, fetchImpl: nodeFetch, scenario: 'server_error' }));
    const op = await enqueue.execute({
      actorId: 'technician-2',
      incident: { ...incidentV1, version: current.version, assignedTechnicianId: 'technician-2' },
      action: 'comment',
      payload: { text: 'Nota que no debe perderse' },
    });

    const report = await sync.syncPending();
    expect(report.confirmed).toEqual([]);
    expect(report.retained).toEqual([op.operationId]);
    expect((await queue.list())[0]).toMatchObject({ status: 'pending', attempts: 1, lastError: 'controlled_failure' });
    expect((await readIncident()).version).toBe(current.version);
  });

  it('timeout: se controla como reintentable sin excepción no manejada', async () => {
    const current = await readIncident();
    const queue = new QueueDouble();
    const enqueue = new EnqueueIncidentActionUseCase(queue, () => 'offline-note-tech2-slow');
    const sync = new SyncService(
      queue,
      new HttpSyncRemote({ baseUrl, fetchImpl: nodeFetch, scenario: 'timeout_after_commit', timeoutMs: 200 }),
    );
    const op = await enqueue.execute({
      actorId: 'technician-2',
      incident: { ...incidentV1, version: current.version, assignedTechnicianId: 'technician-2' },
      action: 'comment',
      payload: { text: 'Nota con respuesta perdida tras commit' },
    });

    const report = await sync.syncPending();
    expect(report.retained).toEqual([op.operationId]);
    expect((await queue.list())[0]).toMatchObject({ status: 'pending', lastError: 'timeout' });

    // El servidor ya había guardado el cambio antes del timeout del cliente.
    // Al reenviar con la misma operationId, el backend reconoce la clave y no duplica el efecto.
    const replay = await new SyncService(queue, new HttpSyncRemote({ baseUrl, fetchImpl: nodeFetch })).syncPending();
    expect(replay.confirmed).toEqual([op.operationId]);
    expect(replay.duplicates).toEqual([op.operationId]);
    expect((await readIncident()).version).toBe(current.version + 1);
  });
});
