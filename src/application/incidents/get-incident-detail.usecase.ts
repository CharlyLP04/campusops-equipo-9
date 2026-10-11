import type { Incident } from '../../domain/incidents/incident.entity';
import type { IncidentRepository } from '../../domain/incidents/incident-repository.port';
import type { SessionIdentityPort } from '../../domain/auth/session-identity.port';
import { canViewIncident, roleForActor } from '../../domain/auth/role-authorization';
import { AuthorizationError } from '../auth/authorization.error';

const ANONYMOUS_IDENTITY: SessionIdentityPort = {
  getAuthenticatedIdentity: () => null,
};

export class GetIncidentDetailUseCase {
  constructor(
    private readonly repository: IncidentRepository,
    private readonly identity: SessionIdentityPort = ANONYMOUS_IDENTITY,
  ) {}

  async execute(id: string): Promise<Incident | undefined> {
    const identity = this.identity.getAuthenticatedIdentity();

    if (
      !identity ||
      roleForActor(identity.actorId) !== identity.role
    ) {
      throw new AuthorizationError();
    }

    const incident = await this.repository.findById(id);

    if (!incident) {
      return undefined;
    }

    if (
      !canViewIncident(identity.actorId, {
        reporterId: incident.reporterId,
        assignedTechnicianId: incident.assignedTechnicianId,
      })
    ) {
      // No revelamos datos de una incidencia fuera del alcance del actor.
      throw new AuthorizationError();
    }

    return incident;
  }
}
