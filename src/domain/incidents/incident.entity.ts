/**
 * Entidad de dominio: Incidencia.
 * Soporta los 5 estados del ciclo de vida institucional de CampusOps.
 */
export type IncidentStatus =
  | 'Reportada'
  | 'Asignada'
  | 'En proceso'
  | 'En verificación'
  | 'Cerrada';

export type IncidentCategory =
  | 'Eléctrico'
  | 'Laboratorio'
  | 'Agua'
  | 'Conectividad'
  | 'Equipamiento'
  | 'Seguridad'
  | 'Mantenimiento';

export type CampusRole = 'Reportante' | 'Técnico' | 'Coordinador';

export interface Incident {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly zone: string;
  readonly category: IncidentCategory;
  readonly status: IncidentStatus;
  readonly reportedAt: string;  // ISO date string
  readonly updatedAt: string;   // ISO date string
  readonly reportedBy: string;  // actor id
  readonly assignedTo: string | null;
}
