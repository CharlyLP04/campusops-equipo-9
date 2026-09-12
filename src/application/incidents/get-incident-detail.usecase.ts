import { Incident } from '../../domain/incidents/incident.entity';
import { IncidentRepository } from '../../domain/incidents/incident-repository.port';

/**
 * Caso de uso: Obtener el detalle de una incidencia por ID.
 * Recibe el repositorio por inyección de dependencias (Dependency Inversion).
 */
export class GetIncidentDetailUseCase {
  constructor(private readonly repository: IncidentRepository) {}

  async execute(id: string): Promise<Incident | null> {
    return this.repository.findById(id);
  }
}
