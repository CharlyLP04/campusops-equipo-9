import type { PendingOperation } from './pending-operation';

/**
 * Puerto de la cola offline. La implementación de producción debe ser
 * persistente (sobrevive al cierre de la app); una lista en memoria no
 * cumple el contrato y sólo se permite como doble de prueba.
 */
export interface OfflineQueuePort {
  /**
   * Agrega una operación. Si ya existe otra con el mismo `operationId`, se
   * conserva la primera y la llamada no tiene efecto (idempotente).
   */
  enqueue(operation: PendingOperation): Promise<void>;

  /** Devuelve las operaciones en orden de creación. */
  list(): Promise<readonly PendingOperation[]>;

  /** Sustituye el registro con el mismo `operationId` (estado, intentos...). */
  replace(operation: PendingOperation): Promise<void>;

  /** Retira una operación. Sólo debe llamarse tras confirmación del servidor o decisión explícita del autor. */
  remove(operationId: string): Promise<void>;
}
