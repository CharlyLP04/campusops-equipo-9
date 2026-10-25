import type { OfflineQueuePort } from '../../domain/sync/offline-queue.port';
import type { PendingOperation } from '../../domain/sync/pending-operation';
import { deduplicateOperations } from '../../domain/sync/deduplicate-operations';
import { canonicalJson, resolveSync } from '../../domain/sync/resolve-sync';
import type { SyncSnapshot } from '../../domain/sync/sync.types';
import type { RemoteSubmitResult, SyncRemotePort } from './sync-remote.port';

export type SyncConflict = Readonly<{
  operationId: string;
  incidentId: string;
  fields: readonly string[];
  reason: string;
}>;

export type SyncReport = Readonly<{
  /** Operaciones confirmadas por el servidor y retiradas de la cola. */
  confirmed: readonly string[];
  /** Subconjunto de `confirmed` que el servidor reconoció como repetidas (no las aplicó otra vez). */
  duplicates: readonly string[];
  /** Operaciones con base obsoleta pero compatibles; se rebasan y esperan el siguiente envío. */
  rebased: readonly string[];
  /** Operaciones incompatibles; quedan en la cola con estado `conflict`. */
  conflicts: readonly SyncConflict[];
  /** Todo lo que sigue en la cola tras esta ejecución. */
  retained: readonly string[];
}>;

export type ConflictDecision = 'discard_local' | 'retry_on_remote';

export type SyncServiceOptions = Readonly<{ maxAttempts?: number }>;

const DEFAULT_MAX_ATTEMPTS = 5;

/** Campos que la intención local modifica respecto de su base, en orden de nombre. */
function changedByLocal(operation: PendingOperation): readonly string[] {
  const names = new Set([
    ...Object.keys(operation.baseFields),
    ...Object.keys(operation.localFields),
  ]);
  return Array.from(names)
    .filter(
      (name) =>
        canonicalJson(operation.baseFields[name]) !==
        canonicalJson(operation.localFields[name]),
    )
    .sort();
}

/**
 * Envía la cola offline al servidor con la política documentada en
 * `docs/sync-policy.md`:
 *
 * 1. Deduplica por `operationId` (se conserva la primera).
 * 2. Envía cada operación con su `operationId` como `Idempotency-Key`.
 * 3. Sólo una confirmación (`applied`) retira la operación de la cola.
 * 4. Ante conflicto consulta el estado remoto y aplica `resolveSync`:
 *    - compatible → rebasa la operación a la versión remota (sigue en cola);
 *    - incompatible → marca `conflict` con los campos, sin borrar la intención
 *      local ni sobrescribir el dato remoto.
 * 5. Errores transitorios incrementan `attempts`; al llegar al máximo la
 *    operación pasa a `failed`, pero sigue en la cola.
 *
 * Las ejecuciones concurrentes comparten la misma promesa para no enviar
 * dos veces la misma operación desde el cliente.
 */
export class SyncService {
  private inFlight: Promise<SyncReport> | null = null;
  private readonly maxAttempts: number;

  constructor(
    private readonly queue: OfflineQueuePort,
    private readonly remote: SyncRemotePort,
    options: SyncServiceOptions = {},
  ) {
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  }

  syncPending(): Promise<SyncReport> {
    if (!this.inFlight) {
      this.inFlight = this.runSync().finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  /**
   * Resolución explícita de un conflicto por parte del autor.
   * - `discard_local`: el autor acepta el estado remoto y retira su intención.
   * - `retry_on_remote`: rebasa sobre la versión remota actual y la reenvía en
   *   la siguiente sincronización; el servidor vuelve a validar permisos.
   */
  async resolveConflict(
    operationId: string,
    decision: ConflictDecision,
  ): Promise<PendingOperation | null> {
    const operation = (await this.queue.list()).find(
      (item) => item.operationId === operationId,
    );
    if (!operation) {
      return null;
    }

    if (decision === 'discard_local') {
      await this.queue.remove(operationId);
      return operation;
    }

    const snapshot = await this.safeSnapshot(operation);
    if (!snapshot) {
      // Sin visibilidad remota no hay base sobre la cual reintentar.
      return operation;
    }
    const rebased = this.rebase(operation, snapshot, operation.localFields);
    await this.queue.replace(rebased);
    return rebased;
  }

  private async runSync(): Promise<SyncReport> {
    const confirmed: string[] = [];
    const duplicates: string[] = [];
    const rebased: string[] = [];
    const conflicts: SyncConflict[] = [];

    const pending = deduplicateOperations(
      (await this.queue.list()).filter((item) => item.status === 'pending'),
    );

    for (const operation of pending) {
      const result = await this.safeSubmit(operation);

      switch (result.kind) {
        case 'applied':
          await this.queue.remove(operation.operationId);
          confirmed.push(operation.operationId);
          if (result.duplicate) {
            duplicates.push(operation.operationId);
          }
          break;

        case 'conflict': {
          const outcome = await this.handleConflict(operation, result.reason);
          if (outcome.kind === 'rebased') {
            rebased.push(operation.operationId);
          } else {
            conflicts.push(outcome.conflict);
          }
          break;
        }

        case 'retryable': {
          const attempts = operation.attempts + 1;
          await this.queue.replace({
            ...operation,
            attempts,
            status: attempts >= this.maxAttempts ? 'failed' : 'pending',
            lastError: result.reason,
          });
          break;
        }

        case 'rejected':
          await this.queue.replace({
            ...operation,
            attempts: operation.attempts + 1,
            status: 'failed',
            lastError: result.reason,
          });
          break;
      }
    }

    const retained = (await this.queue.list()).map((item) => item.operationId);
    return { confirmed, duplicates, rebased, conflicts, retained };
  }

  private async handleConflict(
    operation: PendingOperation,
    reason: string,
  ): Promise<
    | Readonly<{ kind: 'rebased' }>
    | Readonly<{ kind: 'conflict'; conflict: SyncConflict }>
  > {
    const snapshot =
      reason === 'idempotency_key_reused' ? null : await this.safeSnapshot(operation);

    let fields: readonly string[];
    if (snapshot) {
      const resolution = resolveSync(
        { id: operation.incidentId, version: operation.baseVersion, fields: operation.baseFields },
        { id: operation.incidentId, version: operation.baseVersion, fields: operation.localFields },
        snapshot,
      );
      if (resolution.kind === 'merged') {
        await this.queue.replace(this.rebase(operation, snapshot, resolution.fields));
        return { kind: 'rebased' };
      }
      fields = resolution.fields;
    } else {
      // El actor ya no ve la incidencia (p. ej. técnico reasignado) o la
      // clave se reutilizó: se reportan los campos que tocaba su intención.
      fields = changedByLocal(operation);
    }

    await this.queue.replace({
      ...operation,
      attempts: operation.attempts + 1,
      status: 'conflict',
      lastError: reason,
      conflictFields: fields,
    });

    return {
      kind: 'conflict',
      conflict: { operationId: operation.operationId, incidentId: operation.incidentId, fields, reason },
    };
  }

  private rebase(
    operation: PendingOperation,
    snapshot: SyncSnapshot,
    localFields: PendingOperation['localFields'],
  ): PendingOperation {
    // Se descartan el error y los campos del conflicto anterior.
    const { lastError: _lastError, conflictFields: _conflictFields, ...rest } = operation;
    return {
      ...rest,
      baseVersion: snapshot.version,
      baseFields: snapshot.fields,
      localFields,
      attempts: operation.attempts + 1,
      status: 'pending',
    };
  }

  private async safeSubmit(operation: PendingOperation): Promise<RemoteSubmitResult> {
    try {
      return await this.remote.submit(operation);
    } catch {
      return { kind: 'retryable', reason: 'network' };
    }
  }

  private async safeSnapshot(operation: PendingOperation): Promise<SyncSnapshot | null> {
    try {
      return await this.remote.fetchSnapshot(operation.incidentId, operation.authorId);
    } catch {
      return null;
    }
  }
}
