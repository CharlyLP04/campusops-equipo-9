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
  private incidents: readonly Incident[];

  constructor(incidents: readonly Incident[] = SYNTHETIC_INCIDENTS) {
    this.incidents = incidents;
  }

  async findAll(): Promise<readonly Incident[]> {
    return [...this.incidents];
  }

  async findById(id: string): Promise<Incident | undefined> {
    return this.incidents.find((incident) => incident.id === id);
  }

  async create(input: {
    category: Incident['category'];
    description: string;
    location: string;
    idempotencyKey: string;
  }): Promise<Incident> {
    const incident: Incident = {
      id: `incident-local-${this.incidents.length + 1}`,
      reporterId: 'reporter-local',
      category: input.category,
      description: input.description,
      location: {
        source: 'manual',
        label: input.location,
      },
      assignedTechnicianId: null,
      status: 'open',
    };
    this.incidents = [...this.incidents, incident];
    return incident;
  }

}
