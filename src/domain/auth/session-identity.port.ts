import type { CampusOpsActorId, CampusOpsRole } from './role-authorization';

export type AuthenticatedIdentity = Readonly<{
  actorId: CampusOpsActorId;
  role: CampusOpsRole;
}>;

/**
 * Contrato de lectura de identidad para los casos de uso.
 * No expone tokens ni permite elegir arbitrariamente un rol.
 */
export interface SessionIdentityPort {
  getAuthenticatedIdentity(): AuthenticatedIdentity | null;
}
