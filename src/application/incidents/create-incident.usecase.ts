import type { Incident } from '../../domain/incidents/incident.entity';
import type {
  CreateIncidentInput,
  IncidentRepository,
} from '../../domain/incidents/incident-repository.port';
import type { SessionIdentityPort } from '../../domain/auth/session-identity.port';
import { canCreateIncident, roleForActor } from '../../domain/auth/role-authorization';
import { AuthorizationError } from '../auth/authorization.error';

const ANONYMOUS_IDENTITY: SessionIdentityPort = {
  getAuthenticatedIdentity: () => null,
};

export class CreateIncidentUseCase {
  constructor(
    private readonly repository: IncidentRepository,
    private readonly identity: SessionIdentityPort = ANONYMOUS_IDENTITY,
  ) {}

  async execute(input: CreateIncidentInput): Promise<Incident> {
    const identity = this.identity.getAuthenticatedIdentity();

    if (
      !identity ||
      roleForActor(identity.actorId) !== identity.role ||
      !canCreateIncident(identity.actorId)
    ) {
      throw new AuthorizationError(
        'Solo un reportante autenticado puede crear incidencias.',
      );
    }

    return this.repository.create(input);
  }
}
