import type { Incident } from '../../domain/incidents/incident.entity';
import type { IncidentRepository as IncidentRepositoryPort } from '../../domain/incidents/incident-repository.port';

const SYNTHETIC_INCIDENTS: readonly Incident[] = [
  {
    id: 'incident-001',
    reporterId: 'reporter-001',
    category: 'electrical',
    description: 'Lámpara apagada en el pasillo del edificio de aulas.',
    location: { source: 'manual', label: 'Edificio de aulas, pasillo norte' },
    assignedTechnicianId: null,
    status: 'open',
  },
  {
    id: 'incident-002',
    reporterId: 'reporter-002',
    category: 'connectivity',
    description: 'Sin conectividad en el laboratorio de cómputo.',
    location: { source: 'manual', label: 'Laboratorio de cómputo A' },
    assignedTechnicianId: 'technician-001',
    status: 'in_progress',
  },
  {
    id: 'incident-003',
    reporterId: 'reporter-003',
    category: 'water',
    description: 'Fuga de agua junto al acceso de la biblioteca.',
    location: { source: 'manual', label: 'Biblioteca, acceso principal' },
    assignedTechnicianId: 'technician-002',
    status: 'resolved',
  },
  {
    id: 'incident-004',
    reporterId: 'reporter-004',
    category: 'equipment',
    description: 'Proyector sin imagen en el salón de pruebas.',
    location: { source: 'manual', label: 'Edificio de aulas, salón 204' },
    assignedTechnicianId: 'technician-001',
    status: 'closed',
  },
  {
    id: 'incident-005',
    reporterId: 'reporter-005',
    category: 'safety',
    description: 'Puerta de emergencia trabada en edificio de gobierno.',
    location: { source: 'manual', label: 'Edificio de gobierno, planta baja' },
    assignedTechnicianId: 'technician-003',
    status: 'assigned',
  },
];

export class InMemoryIncidentRepository implements IncidentRepositoryPort {
  private readonly incidents: readonly Incident[];

  constructor(incidents: readonly Incident[] = SYNTHETIC_INCIDENTS) {
    this.incidents = incidents;
  }

  findAll(): readonly Incident[] {
    return [...this.incidents];
  }

  findById(id: string): Incident | undefined {
    return this.incidents.find((incident) => incident.id === id);
  }
}
