import { canPerformIncidentAction } from '../../domain/auth/role-authorization';
import type { OfflineQueuePort } from '../../domain/sync/offline-queue.port';
import type {
  PendingOperation,
  PendingOperationAction,
} from '../../domain/sync/pending-operation';
import type { SyncFields } from '../../domain/sync/sync.types';
import { AuthorizationError } from '../auth/authorization.error';

/** Última versión conocida localmente de la incidencia. */
export type KnownIncident = Readonly<{
  id: string;
  version: number;
  reporterId: string;
  assignedTechnicianId: string | null;
  status: string;
}>;

export type EnqueueIncidentActionInput = Readonly<{
  actorId: string;
  incident: KnownIncident;
  action: PendingOperationAction;
  payload?: SyncFields;
}>;

export type OperationIdFactory = () => string;
export type Clock = () => Date;

export function workFieldsOf(incident: KnownIncident): SyncFields {
  return {
    work: {
      assignedTechnicianId: incident.assignedTechnicianId,
      status: incident.status,
    },
  };
}

function localEffect(
  action: PendingOperationAction,
  baseFields: SyncFields,
  payload: SyncFields,
  operationId: string,
): SyncFields {
  const work = baseFields.work as Readonly<Record<string, unknown>>;
  switch (action) {
    case 'start':
      return { ...baseFields, work: { ...work, status: 'in_progress' } };
    case 'resolve':
      return { ...baseFields, work: { ...work, status: 'resolved' } };
    case 'comment':
    case 'add_evidence':
      // Notas y referencias de fotografía se agregan sin tocar `work`; se
      // indexan por operationId para que dos notas nunca colisionen.
      return { ...baseFields, [`${action}:${operationId}`]: payload };
  }
}

/**
 * Prepara una acción sin conexión y la persiste en la cola.
 *
 * La autorización por perfil de la semana 6 se valida aquí, antes de
 * encolar: ocultar el botón no basta. El servidor vuelve a validar al
 * sincronizar, porque la asignación pudo cambiar mientras tanto.
 */
export class EnqueueIncidentActionUseCase {
  constructor(
    private readonly queue: OfflineQueuePort,
    private readonly nextOperationId: OperationIdFactory,
    private readonly clock: Clock = () => new Date(),
  ) {}

  async execute(input: EnqueueIncidentActionInput): Promise<PendingOperation> {
    const { actorId, incident, action } = input;
    const payload = input.payload ?? {};

    if (
      !canPerformIncidentAction(actorId, action, {
        reporterId: incident.reporterId,
        assignedTechnicianId: incident.assignedTechnicianId,
      })
    ) {
      throw new AuthorizationError(
        `El perfil actual no puede ejecutar "${action}" sobre esta incidencia.`,
      );
    }

    const operationId = this.nextOperationId();
    if (operationId.length < 8) {
      throw new Error('operationId debe tener al menos 8 caracteres (Idempotency-Key).');
    }

    const baseFields = workFieldsOf(incident);
    const operation: PendingOperation = {
      operationId,
      incidentId: incident.id,
      authorId: actorId,
      action,
      payload,
      baseVersion: incident.version,
      baseFields,
      localFields: localEffect(action, baseFields, payload, operationId),
      createdAt: this.clock().toISOString(),
      attempts: 0,
      status: 'pending',
    };

    await this.queue.enqueue(operation);
    return operation;
  }
}
