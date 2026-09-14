import type { Incident } from './incident.entity';

export interface IncidentRepository {
  findAll(): readonly Incident[];
  findById(id: string): Incident | undefined;
}
