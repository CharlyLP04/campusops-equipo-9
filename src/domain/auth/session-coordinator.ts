import type { AuthEvent } from '../../course-evaluation/contracts';
import type { SessionCoordinatorSummary, SessionStatus } from './session.types';

/**
 * Coordinador de sesión concurrente con política single-flight.
 *
 * Resuelve el problema de ráfagas concurrentes de 401: cuando múltiples solicitudes
 * descubren simultáneamente que el token expiró, coalescen en una sola operación de
 * refresco compartida en vuelo, evitando bucles y llamadas duplicadas al servidor.
 * Una vez renovado el token, cada solicitud pendiente se reintenta exactamente una vez.
 * Ante fallo de renovación o cierre de sesión, se retorna al estado anónimo y se
 * eliminan los tokens persistidos.
 */
export class SessionCoordinator {
  private status: SessionStatus = 'anonymous';
  private activeGeneration: number | null = null;
  private refreshCalls = 0;
  private refreshInProgress = false;
  private refreshingGeneration: number | null = null;
  private pendingRequestIds: string[] = [];
  private readonly retriedRequestIds: string[] = [];
  private persistedToken: string | null = null;

  /**
   * Procesa una secuencia de eventos de autenticación y retorna el resumen acumulado.
   */
  public processEvents(events: readonly AuthEvent[]): SessionCoordinatorSummary {
    for (const event of events) {
      this.handleEvent(event);
    }

    return this.getSummary();
  }

  private handleEvent(event: AuthEvent): void {
    switch (event.type) {
      case 'request401':
        this.handleRequest401(event.requestId, event.generation);
        break;

      case 'refreshSucceeded':
        this.handleRefreshSucceeded(event.generation, event.token);
        break;

      case 'refreshFailed':
        this.handleRefreshFailed();
        break;

      case 'logout':
        this.handleLogout();
        break;
    }
  }

  private handleRequest401(requestId?: string, generation?: number): void {
    const reqGen = generation ?? 0;

    // Si el token ya fue renovado previamente a una generación superior,
    // la petición atrasada se reintenta directamente sin invocar otro refresh.
    if (this.activeGeneration !== null && reqGen < this.activeGeneration) {
      if (requestId && !this.retriedRequestIds.includes(requestId)) {
        this.retriedRequestIds.push(requestId);
      }
      return;
    }

    // Single-flight: Si ya hay un refresco en progreso para esta generación,
    // coalescemos la petición encolándola sin disparar otra llamada HTTP.
    if (!this.refreshInProgress) {
      this.refreshInProgress = true;
      this.refreshingGeneration = reqGen;
      this.refreshCalls += 1;
    }

    if (requestId && !this.pendingRequestIds.includes(requestId)) {
      this.pendingRequestIds.push(requestId);
    }
  }

  private handleRefreshSucceeded(generation?: number, token?: string): void {
    this.refreshInProgress = false;
    this.refreshingGeneration = null;
    this.status = 'authenticated';
    this.activeGeneration = generation !== undefined ? generation : ((this.activeGeneration ?? 0) + 1);
    this.persistedToken = token ?? null;

    // Reintentar cada solicitud encolada exactamente una vez
    for (const reqId of this.pendingRequestIds) {
      if (!this.retriedRequestIds.includes(reqId)) {
        this.retriedRequestIds.push(reqId);
      }
    }
    this.pendingRequestIds = [];
  }

  private handleRefreshFailed(): void {
    this.refreshInProgress = false;
    this.refreshingGeneration = null;
    this.status = 'anonymous';
    this.activeGeneration = null;
    this.persistedToken = null;
    // Las solicitudes encoladas fallan con error de autorización; se vacía la cola sin reintento
    this.pendingRequestIds = [];
  }

  private handleLogout(): void {
    this.refreshInProgress = false;
    this.refreshingGeneration = null;
    this.status = 'anonymous';
    this.activeGeneration = null;
    this.persistedToken = null;
    this.pendingRequestIds = [];
  }

  public getSummary(): SessionCoordinatorSummary {
    return {
      status: this.status,
      activeGeneration: this.activeGeneration,
      refreshCalls: this.refreshCalls,
      retriedRequestIds: [...this.retriedRequestIds],
      persistedToken: this.persistedToken,
    };
  }
}
