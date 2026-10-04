import type { Incident } from '../../domain/incidents/incident.entity';
import type {
  CreateIncidentInput,
  IncidentRepository,
} from '../../domain/incidents/incident-repository.port';

export class CreateIncidentUseCase {
  constructor(private readonly repository: IncidentRepository) {}

  async execute(input: CreateIncidentInput): Promise<Incident> {
    return await this.repository.create(input);
  }
}