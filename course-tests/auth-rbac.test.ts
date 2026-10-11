import {
  canCreateIncident,
  canPerformIncidentAction,
  canViewIncident,
  roleForActor,
} from '../src/domain/auth/role-authorization';

describe('Autorización RBAC de CampusOps', () => {
  const ownIncident = {
    reporterId: 'reporter-1',
    assignedTechnicianId: 'technician-1',
  };

  it('resuelve los perfiles conocidos y rechaza actores desconocidos', () => {
    expect(roleForActor('reporter-1')).toBe('reporter');
    expect(roleForActor('technician-1')).toBe('technician');
    expect(roleForActor('coordinator-1')).toBe('coordinator');
    expect(roleForActor('unknown-actor')).toBeNull();
  });

  it('permite que el reportante cree incidencias', () => {
    expect(canCreateIncident('reporter-1')).toBe(true);
    expect(canCreateIncident('technician-1')).toBe(false);
    expect(canCreateIncident('coordinator-1')).toBe(false);
    expect(canCreateIncident('unknown-actor')).toBe(false);
  });

  it('limita la consulta de incidencias según el perfil y la relación', () => {
    expect(canViewIncident('reporter-1', ownIncident)).toBe(true);
    expect(canViewIncident('reporter-2', ownIncident)).toBe(false);
    expect(canViewIncident('technician-1', ownIncident)).toBe(true);
    expect(canViewIncident('technician-2', ownIncident)).toBe(false);
    expect(canViewIncident('coordinator-1', ownIncident)).toBe(true);
    expect(canViewIncident('unknown-actor', ownIncident)).toBe(false);
  });

  it('solo permite resolver al técnico asignado', () => {
    expect(
      canPerformIncidentAction('technician-1', 'resolve', ownIncident),
    ).toBe(true);

    expect(
      canPerformIncidentAction('technician-2', 'resolve', ownIncident),
    ).toBe(false);

    expect(
      canPerformIncidentAction('reporter-1', 'resolve', ownIncident),
    ).toBe(false);

    expect(
      canPerformIncidentAction('coordinator-1', 'resolve', ownIncident),
    ).toBe(false);
  });

  it('reserva cerrar y reabrir para coordinación', () => {
    expect(
      canPerformIncidentAction('coordinator-1', 'close', ownIncident),
    ).toBe(true);

    expect(
      canPerformIncidentAction('coordinator-1', 'reopen', ownIncident),
    ).toBe(true);

    expect(
      canPerformIncidentAction('reporter-1', 'close', ownIncident),
    ).toBe(false);

    expect(
      canPerformIncidentAction('technician-1', 'reopen', ownIncident),
    ).toBe(false);
  });

  it('no autoriza acciones para identidades desconocidas', () => {
    expect(
      canPerformIncidentAction('unknown-actor', 'close', ownIncident),
    ).toBe(false);
  });
});
