export type CampusOpsActorId =
  | 'reporter-1'
  | 'reporter-2'
  | 'technician-1'
  | 'technician-2'
  | 'coordinator-1';

export type CampusOpsRole =
  | 'reporter'
  | 'technician'
  | 'coordinator';

export type IncidentAction =
  | 'start'
  | 'resolve'
  | 'assign'
  | 'prioritize'
  | 'close'
  | 'reopen'
  | 'comment'
  | 'addEvidence'
  | 'add_evidence';

export interface IncidentForAuthorization {
  readonly reporterId: string;
  readonly assignedTechnicianId: string | null;
}

const ACTOR_ROLES: Readonly<Record<CampusOpsActorId, CampusOpsRole>> = {
  'reporter-1': 'reporter',
  'reporter-2': 'reporter',
  'technician-1': 'technician',
  'technician-2': 'technician',
  'coordinator-1': 'coordinator',
};

export function roleForActor(actorId: string): CampusOpsRole | null {
  if (!Object.prototype.hasOwnProperty.call(ACTOR_ROLES, actorId)) {
    return null;
  }

  return ACTOR_ROLES[actorId as CampusOpsActorId];
}

function resolveRole(value: string): CampusOpsRole | null {
  if (
    value === 'reporter' ||
    value === 'technician' ||
    value === 'coordinator'
  ) {
    return value;
  }

  return roleForActor(value);
}

export function canCreateIncident(
  actorIdOrRole: string,
): boolean {
  return resolveRole(actorIdOrRole) === 'reporter';
}

export function canViewIncident(
  actorId: string,
  incident: IncidentForAuthorization,
): boolean;

export function canViewIncident(
  role: CampusOpsRole,
  actorId: string,
  incident: IncidentForAuthorization,
): boolean;

export function canViewIncident(
  first: string,
  second: string | IncidentForAuthorization,
  third?: IncidentForAuthorization,
): boolean {
  const role =
    typeof second === 'string'
      ? resolveRole(first)
      : roleForActor(first);

  const actorId =
    typeof second === 'string'
      ? second
      : first;

  const incident =
    typeof second === 'string'
      ? third
      : second;

  if (!role || !incident) {
    return false;
  }

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

export function canPerformIncidentAction(
  actorId: string,
  action: IncidentAction,
  incident: IncidentForAuthorization,
): boolean;

export function canPerformIncidentAction(
  role: CampusOpsRole,
  actorId: string,
  action: IncidentAction,
  incident: IncidentForAuthorization,
): boolean;

export function canPerformIncidentAction(
  first: string,
  second: string,
  third: IncidentAction | IncidentForAuthorization,
  fourth?: IncidentForAuthorization,
): boolean {
  const explicitRole = fourth !== undefined;

  const role = explicitRole
    ? resolveRole(first)
    : roleForActor(first);

  const actorId = explicitRole
    ? second
    : first;

  const action = explicitRole
    ? (third as IncidentAction)
    : (second as IncidentAction);

  const incident = explicitRole
    ? fourth
    : (third as IncidentForAuthorization);

  if (!role || !incident) {
    return false;
  }

  if (
    action === 'assign' ||
    action === 'prioritize' ||
    action === 'close' ||
    action === 'reopen'
  ) {
    return role === 'coordinator';
  }

  if (action === 'start' || action === 'resolve') {
    return (
      role === 'technician' &&
      incident.assignedTechnicianId === actorId
    );
  }

  if (
    action === 'comment' ||
    action === 'addEvidence' ||
    action === 'add_evidence'
  ) {
    return explicitRole
      ? canViewIncident(role, actorId, incident)
      : canViewIncident(actorId, incident);
  }

  return false;
}