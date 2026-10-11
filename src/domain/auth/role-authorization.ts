export type CampusOpsActorId =
  | 'reporter-1'
  | 'reporter-2'
  | 'technician-1'
  | 'technician-2'
  | 'coordinator-1';

export type CampusOpsRole = 'reporter' | 'technician' | 'coordinator';

export type IncidentForAuthorization = Readonly<{
  reporterId: string;
  assignedTechnicianId: string | null;
}>;

export type IncidentAction =
  | 'start'
  | 'resolve'
  | 'assign'
  | 'prioritize'
  | 'close'
  | 'reopen'
  | 'comment'
  | 'addEvidence';

const ACTOR_ROLES: Readonly<Record<CampusOpsActorId, CampusOpsRole>> = {
  'reporter-1': 'reporter',
  'reporter-2': 'reporter',
  'technician-1': 'technician',
  'technician-2': 'technician',
  'coordinator-1': 'coordinator',
};

/**
 * Resuelve el perfil desde una identidad conocida.
 * No acepta el rol enviado por la interfaz como fuente de autoridad.
 */
export function roleForActor(actorId: string): CampusOpsRole | null {
  if (!Object.prototype.hasOwnProperty.call(ACTOR_ROLES, actorId)) {
    return null;
  }

  return ACTOR_ROLES[actorId as CampusOpsActorId];
}

/** Solo los perfiles reportantes pueden registrar incidencias. */
export function canCreateIncident(actorId: string): boolean {
  return roleForActor(actorId) === 'reporter';
}

/**
 * Un reportante consulta sus propias incidencias; un técnico consulta
 * las que tiene asignadas; coordinación puede consultar todas.
 */
export function canViewIncident(
  actorId: string,
  incident: IncidentForAuthorization,
): boolean {
  const role = roleForActor(actorId);

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
 * Autoriza acciones de dominio a partir de la identidad del actor
 * y de la incidencia objetivo, no de la visibilidad de los controles.
 */
export function canPerformIncidentAction(
  actorId: string,
  action: IncidentAction,
  incident: IncidentForAuthorization,
): boolean {
  const role = roleForActor(actorId);

  if (!role) {
    return false;
  }

  if (action === 'close' || action === 'reopen') {
    return role === 'coordinator';
  }

  if (action === 'assign' || action === 'prioritize') {
    return role === 'coordinator';
  }

  if (action === 'start' || action === 'resolve') {
    return (
      role === 'technician' &&
      incident.assignedTechnicianId === actorId
    );
  }

  if (action === 'comment' || action === 'addEvidence') {
    return canViewIncident(actorId, incident);
  }

  return false;
}
