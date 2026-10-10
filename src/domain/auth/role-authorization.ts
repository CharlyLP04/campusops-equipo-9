import type { CampusOpsRole, IncidentAction } from './session.types';

export interface IncidentContext {
  readonly reporterId: string;
  readonly assignedTechnicianId: string | null;
}

export const COORDINATOR_ACTIONS: ReadonlySet<IncidentAction> = new Set([
  'assign',
  'prioritize',
  'close',
  'reopen',
]);

export const TECHNICIAN_ACTIONS: ReadonlySet<IncidentAction> = new Set([
  'start',
  'resolve',
]);

export const SHARED_ACTIONS: ReadonlySet<IncidentAction> = new Set([
  'comment',
  'add_evidence',
]);

/**
 * Valida si un actor tiene visibilidad de lectura sobre una incidencia dada.
 */
export function canViewIncident(
  role: CampusOpsRole,
  actorId: string,
  incident: IncidentContext,
): boolean {
  if (role === 'coordinator') {
    return true;
  }
  if (role === 'reporter') {
    return incident.reporterId === actorId;
  }
  if (role === 'technician') {
    return incident.assignedTechnicianId === actorId;
  }
  return false;
}

/**
 * Valida si un actor puede crear una nueva incidencia.
 */
export function canCreateIncident(role: CampusOpsRole): boolean {
  return role === 'reporter';
}

/**
 * Valida si un actor tiene autorización para ejecutar una acción específica sobre una incidencia.
 * Esta validación a nivel de dominio asegura que no se dependa únicamente de ocultar botones en la UI.
 */
export function canPerformIncidentAction(
  role: CampusOpsRole,
  actorId: string,
  action: IncidentAction,
  incident: IncidentContext,
): boolean {
  const isVisible = canViewIncident(role, actorId, incident);

  if (COORDINATOR_ACTIONS.has(action)) {
    return role === 'coordinator';
  }

  if (TECHNICIAN_ACTIONS.has(action)) {
    return role === 'technician' && isVisible;
  }

  if (SHARED_ACTIONS.has(action)) {
    return isVisible;
  }

  return false;
}
