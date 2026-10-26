import type { SyncFields } from './sync.types';

/**
 * Acciones que un actor puede preparar sin conexión. Las acciones de
 * coordinación (assign, prioritize, close, reopen) se ejecutan en línea.
 */
export type PendingOperationAction = 'start' | 'resolve' | 'comment' | 'add_evidence';

/**
 * - `pending`: espera envío o reintento.
 * - `conflict`: el servidor cambió la base; requiere decisión explícita.
 * - `failed`: agotó reintentos o fue rechazada; se conserva para revisión.
 *
 * Ningún estado distinto de "confirmada por el servidor" retira la operación.
 */
export type PendingOperationStatus = 'pending' | 'conflict' | 'failed';

/**
 * Cambio pendiente persistido en la cola offline.
 *
 * - `operationId` es estable: se genera una sola vez al encolar y se envía
 *   como `Idempotency-Key`, de modo que un reenvío no aplica dos veces.
 * - `baseVersion` y `baseFields` describen la versión desde la que se partió.
 * - `localFields` describe el efecto que el autor pretendía producir; se
 *   conserva aunque haya conflicto para no borrar la intención local.
 * - `payload` es el contenido que se envía al backend (nota, referencia de
 *   fotografía pendiente, diagnóstico...). Una referencia de fotografía sólo
 *   identifica un recurso pendiente; no prueba que la imagen se haya subido.
 */
export type PendingOperation = Readonly<{
  operationId: string;
  incidentId: string;
  authorId: string;
  action: PendingOperationAction;
  payload: SyncFields;
  baseVersion: number;
  baseFields: SyncFields;
  localFields: SyncFields;
  createdAt: string;
  attempts: number;
  status: PendingOperationStatus;
  lastError?: string;
  conflictFields?: readonly string[];
}>;
