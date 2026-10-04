import type {
  Incident,
  IncidentCategory,
} from './incident.entity';

export type CreateIncidentInput = Readonly<{
  category: IncidentCategory;
  description: string;
  location: string;
  idempotencyKey: string;
}>;

export interface IncidentRepository {
  findAll(): Promise<readonly Incident[]>;
  findById(id: string): Promise<Incident | undefined>;
  create(input: CreateIncidentInput): Promise<Incident>;
}