import type { Incident } from '../../domain/incidents/incident.entity';
import type { IncidentRepository } from '../../domain/incidents/incident-repository.port';

/**
 * Caso de uso: Obtener la lista completa de incidencias.
 * Recibe el repositorio por inyección de dependencias (Dependency Inversion).
 */
export class GetIncidentsUseCase {
  constructor(private readonly repository: IncidentRepository) {}

  async execute(): Promise<readonly Incident[]> {
    return this.repository.findAll();
  }
}
