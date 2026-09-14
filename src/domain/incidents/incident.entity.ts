/**
 * Vocabulario del dominio de incidencias. Los identificadores permanecen
 * estables para los contratos; las etiquetas se presentan en español.
 */
export type IncidentStatus =
  | 'open'
  | 'assigned'
  | 'in_progress'
  | 'resolved'
  | 'closed';

export const INCIDENT_STATUS_LABELS: Readonly<Record<IncidentStatus, string>> = {
  open: 'Reportada',
  assigned: 'Asignada',
  in_progress: 'En proceso',
  resolved: 'En verificación',
  closed: 'Cerrada',
};

export type CampusRole = 'reporter' | 'technician' | 'coordinator';

export const CAMPUS_ROLE_LABELS: Readonly<Record<CampusRole, string>> = {
  reporter: 'Reportante',
  technician: 'Técnico',
  coordinator: 'Coordinador',
};

export type IncidentCategory =
  | 'electrical'
  | 'laboratory'
  | 'water'
  | 'connectivity'
  | 'equipment'
  | 'safety'
  | 'maintenance';

export type IncidentLocation = Readonly<{
  source: 'provider' | 'manual';
  label: string;
  latitude?: number;
  longitude?: number;
}>;

export type Incident = Readonly<{
  id: string;
  reporterId: string;
  category: IncidentCategory;
  description: string;
  location: IncidentLocation;
  assignedTechnicianId: string | null;
  status: IncidentStatus;
}>;
