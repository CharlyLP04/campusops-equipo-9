import type { PendingOperation } from '../../domain/sync/pending-operation';
import type { SyncSnapshot } from '../../domain/sync/sync.types';

export type RemoteConflictReason =
  | 'version_conflict'
  | 'transition_conflict'
  | 'forbidden'
  | 'idempotency_key_reused';

/**
 * Resultado de enviar una operación. Sólo `applied` autoriza retirarla de la
 * cola; `duplicate: true` indica que el servidor ya la había aplicado con la
 * misma `Idempotency-Key` y no la volvió a ejecutar.
 */
export type RemoteSubmitResult =
  | Readonly<{ kind: 'applied'; version: number; duplicate: boolean }>
  | Readonly<{ kind: 'conflict'; reason: RemoteConflictReason; currentVersion?: number }>
  | Readonly<{ kind: 'retryable'; reason: string }>
  | Readonly<{ kind: 'rejected'; reason: string }>;

export interface SyncRemotePort {
  submit(operation: PendingOperation): Promise<RemoteSubmitResult>;

  /**
   * Estado remoto visible para el actor. Devuelve `null` si el actor ya no
   * puede ver la incidencia (por ejemplo, un técnico que fue reasignado).
   */
  fetchSnapshot(incidentId: string, actorId: string): Promise<SyncSnapshot | null>;
}
