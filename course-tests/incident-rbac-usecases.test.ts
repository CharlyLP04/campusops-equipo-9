import type { Incident } from '../src/domain/incidents/incident.entity';
import type {
  CreateIncidentInput,
  IncidentRepository,
} from '../src/domain/incidents/incident-repository.port';
import type {
  AuthenticatedIdentity,
  SessionIdentityPort,
} from '../src/domain/auth/session-identity.port';
import { AuthorizationError } from '../src/application/auth/authorization.error';
import { CreateIncidentUseCase } from '../src/application/incidents/create-incident.usecase';
import { GetIncidentsUseCase } from '../src/application/incidents/get-incidents.usecase';
import { GetIncidentDetailUseCase } from '../src/application/incidents/get-incident-detail.usecase';

const incidents: readonly Incident[] = [
  {
    id: 'incident-1',
    reporterId: 'reporter-1',
    category: 'electrical',
    description: 'Lámpara apagada',
    location: { source: 'manual', label: 'Edificio A' },
    assignedTechnicianId: 'technician-1',
    status: 'assigned',
  },
  {
    id: 'incident-2',
    reporterId: 'reporter-2',
    category: 'water',
    description: 'Fuga de agua',
    location: { source: 'manual', label: 'Edificio B' },
    assignedTechnicianId: 'technician-2',
    status: 'in_progress',
  },
  {
    id: 'incident-3',
    reporterId: 'reporter-2',
    category: 'equipment',
    description: 'Equipo dañado',
    location: { source: 'manual', label: 'Laboratorio' },
    assignedTechnicianId: 'technician-1',
    status: 'assigned',
  },
];

function makeIdentity(
  identity: AuthenticatedIdentity | null,
): SessionIdentityPort {
  return { getAuthenticatedIdentity: () => identity };
}

function makeRepository(): IncidentRepository {
  return {
    findAll: jest.fn(async () => incidents),
    findById: jest.fn(async (id: string) =>
      incidents.find((incident) => incident.id === id),
    ),
    create: jest.fn(async (input: CreateIncidentInput): Promise<Incident> => ({
      id: 'incident-new',
      reporterId: 'reporter-1',
      category: input.category,
      description: input.description,
      location: { source: 'manual', label: input.location },
      assignedTechnicianId: null,
      status: 'open',
    })),
  };
}

const reporter: AuthenticatedIdentity = {
  actorId: 'reporter-1',
  role: 'reporter',
};

const technician: AuthenticatedIdentity = {
  actorId: 'technician-1',
  role: 'technician',
};

const coordinator: AuthenticatedIdentity = {
  actorId: 'coordinator-1',
  role: 'coordinator',
};

const createInput: CreateIncidentInput = {
  category: 'electrical',
  description: 'Nueva lámpara apagada',
  location: 'Edificio C',
  idempotencyKey: 'rbac-test-key-001',
};

describe('RBAC integrado en los casos de uso', () => {
  it('rechaza la consulta de incidencias sin sesión', async () => {
    const repository = makeRepository();
    const useCase = new GetIncidentsUseCase(
      repository,
      makeIdentity(null),
    );

    await expect(useCase.execute()).rejects.toBeInstanceOf(AuthorizationError);
    expect(repository.findAll).not.toHaveBeenCalled();
  });

  it('filtra la lista para que el reportante vea solo sus incidencias', async () => {
    const useCase = new GetIncidentsUseCase(
      makeRepository(),
      makeIdentity(reporter),
    );

    const result = await useCase.execute();

    expect(result.map((incident) => incident.id)).toEqual(['incident-1']);
  });

  it('permite al técnico ver únicamente las incidencias asignadas', async () => {
    const useCase = new GetIncidentsUseCase(
      makeRepository(),
      makeIdentity(technician),
    );

    const result = await useCase.execute();

    expect(result.map((incident) => incident.id)).toEqual([
      'incident-1',
      'incident-3',
    ]);
  });

  it('permite a coordinación consultar todas las incidencias', async () => {
    const useCase = new GetIncidentsUseCase(
      makeRepository(),
      makeIdentity(coordinator),
    );

    const result = await useCase.execute();

    expect(result).toHaveLength(3);
  });

  it('no revela por ID una incidencia fuera del alcance del reportante', async () => {
    const repository = makeRepository();
    const useCase = new GetIncidentDetailUseCase(
      repository,
      makeIdentity(reporter),
    );

    await expect(
      useCase.execute('incident-2'),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('rechaza una identidad cuyo rol no coincide con el actor', async () => {
    const forgedIdentity: AuthenticatedIdentity = {
      actorId: 'reporter-1',
      role: 'coordinator',
    };

    const repository = makeRepository();
    const useCase = new CreateIncidentUseCase(
      repository,
      makeIdentity(forgedIdentity),
    );

    await expect(
      useCase.execute(createInput),
    ).rejects.toBeInstanceOf(AuthorizationError);

    expect(repository.create).not.toHaveBeenCalled();
  });

  it('permite crear incidencias a reportantes autenticados', async () => {
    const repository = makeRepository();
    const useCase = new CreateIncidentUseCase(
      repository,
      makeIdentity(reporter),
    );

    const result = await useCase.execute(createInput);

    expect(result.reporterId).toBe('reporter-1');
    expect(repository.create).toHaveBeenCalledTimes(1);
  });

  it('rechaza la creación si no existe una identidad autenticada', async () => {
    const repository = makeRepository();
    const useCase = new CreateIncidentUseCase(
      repository,
      makeIdentity(null),
    );

    await expect(
      useCase.execute(createInput),
    ).rejects.toBeInstanceOf(AuthorizationError);

    expect(repository.create).not.toHaveBeenCalled();
  });
});
