import { SessionCoordinator } from '../src/domain/auth/session-coordinator';
import {
  canCreateIncident,
  canPerformIncidentAction,
  canViewIncident,
} from '../src/domain/auth/role-authorization';

describe('SessionCoordinator — Concurrencia Single-Flight y Ciclo de Sesión', () => {
  it('coalesce múltiples 401 simultáneos en una sola llamada de refresh', () => {
    const coordinator = new SessionCoordinator();

    const summary = coordinator.processEvents([
      { type: 'request401', requestId: 'req-alpha', generation: 0 },
      { type: 'request401', requestId: 'req-beta', generation: 0 },
      { type: 'request401', requestId: 'req-gamma', generation: 0 },
      { type: 'request401', requestId: 'req-delta', generation: 0 },
      { type: 'refreshSucceeded', generation: 1, token: 'token-gen-1' },
    ]);

    expect(summary).toEqual({
      status: 'authenticated',
      activeGeneration: 1,
      refreshCalls: 1,
      retriedRequestIds: ['req-alpha', 'req-beta', 'req-gamma', 'req-delta'],
      persistedToken: 'token-gen-1',
    });
  });

  it('transición segura a anonymous cuando falla la renovación del token', () => {
    const coordinator = new SessionCoordinator();

    const summary = coordinator.processEvents([
      { type: 'request401', requestId: 'req-fail', generation: 0 },
      { type: 'refreshFailed' },
    ]);

    expect(summary.status).toBe('anonymous');
    expect(summary.activeGeneration).toBeNull();
    expect(summary.persistedToken).toBeNull();
    expect(summary.refreshCalls).toBe(1);
    expect(summary.retriedRequestIds).toEqual([]);
  });

  it('logout elimina el token persistido y regresa al estado no autenticado', () => {
    const coordinator = new SessionCoordinator();

    const summary = coordinator.processEvents([
      { type: 'request401', requestId: 'req-1', generation: 0 },
      { type: 'refreshSucceeded', generation: 1, token: 'active-token-1' },
      { type: 'logout' },
    ]);

    expect(summary.status).toBe('anonymous');
    expect(summary.activeGeneration).toBeNull();
    expect(summary.persistedToken).toBeNull();
  });

  it('petición 401 desfasada con generación previa se reintenta sin disparar refresh duplicado', () => {
    const coordinator = new SessionCoordinator();

    const summary = coordinator.processEvents([
      { type: 'request401', requestId: 'req-1', generation: 0 },
      { type: 'refreshSucceeded', generation: 1, token: 'new-token' },
      // Petición con generación 0 que llegó tarde después de completado el refresh
      { type: 'request401', requestId: 'req-lagged', generation: 0 },
    ]);

    // refreshCalls debe mantenerse en 1 porque la generación 0 ya fue renovada a generación 1
    expect(summary.refreshCalls).toBe(1);
    expect(summary.activeGeneration).toBe(1);
    expect(summary.retriedRequestIds).toContain('req-lagged');
  });

  it('soporta múltiples ciclos sucesivos de expiración y renovación', () => {
    const coordinator = new SessionCoordinator();

    const summary = coordinator.processEvents([
      { type: 'request401', requestId: 'cycle-1', generation: 0 },
      { type: 'refreshSucceeded', generation: 1, token: 'token-cycle-1' },
      { type: 'request401', requestId: 'cycle-2', generation: 1 },
      { type: 'refreshSucceeded', generation: 2, token: 'token-cycle-2' },
    ]);

    expect(summary.refreshCalls).toBe(2);
    expect(summary.activeGeneration).toBe(2);
    expect(summary.persistedToken).toBe('token-cycle-2');
    expect(summary.retriedRequestIds).toEqual(['cycle-1', 'cycle-2']);
  });
});

describe('RoleAuthorization — Control de Acceso Basado en Perfiles CampusOps', () => {
  const incidentFixture = {
    reporterId: 'reporter-1',
    assignedTechnicianId: 'technician-1',
  };

  it('valida permisos para el perfil Reportante', () => {
    expect(canCreateIncident('reporter')).toBe(true);
    expect(canCreateIncident('technician')).toBe(false);
    expect(canCreateIncident('coordinator')).toBe(false);

    // Puede ver sus propias incidencias
    expect(canViewIncident('reporter', 'reporter-1', incidentFixture)).toBe(true);
    // No puede ver incidencias de otros reportantes
    expect(canViewIncident('reporter', 'reporter-2', incidentFixture)).toBe(false);

    // No puede ejecutar acciones de resolución ni de coordinación
    expect(canPerformIncidentAction('reporter', 'reporter-1', 'resolve', incidentFixture)).toBe(false);
    expect(canPerformIncidentAction('reporter', 'reporter-1', 'close', incidentFixture)).toBe(false);
    expect(canPerformIncidentAction('reporter', 'reporter-1', 'assign', incidentFixture)).toBe(false);

    // Puede comentar en sus incidencias visibles
    expect(canPerformIncidentAction('reporter', 'reporter-1', 'comment', incidentFixture)).toBe(true);
  });

  it('valida permisos para el perfil Técnico', () => {
    // Solo puede ver y resolver incidencias asignadas a él
    expect(canViewIncident('technician', 'technician-1', incidentFixture)).toBe(true);
    expect(canViewIncident('technician', 'technician-2', incidentFixture)).toBe(false);

    expect(canPerformIncidentAction('technician', 'technician-1', 'start', incidentFixture)).toBe(true);
    expect(canPerformIncidentAction('technician', 'technician-1', 'resolve', incidentFixture)).toBe(true);

    // Técnico 2 no asignado no puede resolver
    expect(canPerformIncidentAction('technician', 'technician-2', 'resolve', incidentFixture)).toBe(false);

    // No puede realizar acciones de coordinación
    expect(canPerformIncidentAction('technician', 'technician-1', 'assign', incidentFixture)).toBe(false);
    expect(canPerformIncidentAction('technician', 'technician-1', 'close', incidentFixture)).toBe(false);
    expect(canPerformIncidentAction('technician', 'technician-1', 'reopen', incidentFixture)).toBe(false);
  });

  it('valida permisos para el perfil Coordinador', () => {
    // Coordinador tiene visibilidad global
    expect(canViewIncident('coordinator', 'coordinator-1', incidentFixture)).toBe(true);

    // Coordinador puede asignar, priorizar, cerrar y reabrir
    expect(canPerformIncidentAction('coordinator', 'coordinator-1', 'assign', incidentFixture)).toBe(true);
    expect(canPerformIncidentAction('coordinator', 'coordinator-1', 'prioritize', incidentFixture)).toBe(true);
    expect(canPerformIncidentAction('coordinator', 'coordinator-1', 'close', incidentFixture)).toBe(true);
    expect(canPerformIncidentAction('coordinator', 'coordinator-1', 'reopen', incidentFixture)).toBe(true);

    // Coordinador no ejecuta directamente la resolución técnica
    expect(canPerformIncidentAction('coordinator', 'coordinator-1', 'resolve', incidentFixture)).toBe(false);
  });
});
