import { Incident } from '../../domain/incidents/incident.entity';
import { IncidentRepository } from '../../domain/incidents/incident-repository.port';

/**
 * Repositorio en memoria con datos sintéticos para desarrollo y pruebas.
 * Implementa el puerto IncidentRepository del dominio.
 * Solo se instancia en la raíz de composición (App.tsx).
 */
const SEED_INCIDENTS: Incident[] = [
  {
    id: 'INC-001',
    title: 'Corte de luz en laboratorio A-204',
    description:
      'El laboratorio de cómputo A-204 perdió suministro eléctrico durante el turno vespertino. Varios equipos quedaron sin respaldo de UPS.',
    zone: 'Edificio A — Piso 2',
    category: 'Eléctrico',
    status: 'Reportada',
    reportedAt: '2026-09-08T09:15:00-06:00',
    updatedAt: '2026-09-08T09:15:00-06:00',
    reportedBy: 'user-101',
    assignedTo: null,
  },
  {
    id: 'INC-002',
    title: 'Fuga de agua en sanitarios planta baja',
    description:
      'Se detectó fuga de agua bajo los lavabos del baño de damas en planta baja. El piso está inundado parcialmente.',
    zone: 'Edificio B — Planta baja',
    category: 'Agua',
    status: 'Asignada',
    reportedAt: '2026-09-08T10:30:00-06:00',
    updatedAt: '2026-09-08T11:00:00-06:00',
    reportedBy: 'user-102',
    assignedTo: 'tech-005',
  },
  {
    id: 'INC-003',
    title: 'Proyector sin imagen en aula C-110',
    description:
      'El proyector del aula C-110 enciende pero no proyecta imagen. El cable HDMI fue reemplazado sin éxito.',
    zone: 'Edificio C — Piso 1',
    category: 'Equipamiento',
    status: 'En proceso',
    reportedAt: '2026-09-09T08:00:00-06:00',
    updatedAt: '2026-09-09T09:45:00-06:00',
    reportedBy: 'user-103',
    assignedTo: 'tech-002',
  },
  {
    id: 'INC-004',
    title: 'Red inalámbrica intermitente en biblioteca',
    description:
      'La red Wi-Fi de la biblioteca presenta cortes frecuentes desde la actualización de firmware del lunes.',
    zone: 'Biblioteca Central',
    category: 'Conectividad',
    status: 'En verificación',
    reportedAt: '2026-09-09T14:20:00-06:00',
    updatedAt: '2026-09-10T10:00:00-06:00',
    reportedBy: 'user-104',
    assignedTo: 'tech-007',
  },
  {
    id: 'INC-005',
    title: 'Puerta de emergencia sin cierre en D-301',
    description:
      'La puerta de emergencia del corredor D-301 no cierra correctamente. Representa riesgo de seguridad.',
    zone: 'Edificio D — Piso 3',
    category: 'Seguridad',
    status: 'Cerrada',
    reportedAt: '2026-09-07T16:00:00-06:00',
    updatedAt: '2026-09-08T08:00:00-06:00',
    reportedBy: 'user-105',
    assignedTo: 'tech-003',
  },
];

export class InMemoryIncidentRepository implements IncidentRepository {
  private readonly incidents: Incident[] = [...SEED_INCIDENTS];

  async findAll(): Promise<Incident[]> {
    return [...this.incidents];
  }

  async findById(id: string): Promise<Incident | null> {
    return this.incidents.find((inc) => inc.id === id) ?? null;
  }
}
