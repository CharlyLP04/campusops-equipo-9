import { Incident } from './incident.entity';

/**
 * Puerto abstracto del repositorio de incidencias.
 * Define el contrato que la capa de Aplicación consume;
 * la implementación concreta vive en Infrastructure.
 */
export interface IncidentRepository {
  findAll(): Promise<Incident[]>;
  findById(id: string): Promise<Incident | null>;
}
