import {
  CloudIncidentError,
  CloudIncidentRepository,
} from '../src/infrastructure/incidents/cloud-incident.repository';

const validIncident = {
  id: 'inc-001',
  version: 1,
  status: 'open',
  payload: {
    category: 'water',
    description: 'Fuga sintética en laboratorio',
    location: 'Edificio B',
    reporterId: 'reporter-1',
    assignedTechnicianId: null,
  },
};

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('CloudIncidentRepository — resiliencia con fetch simulado', () => {
  test('procesa una lista válida sin depender de Internet', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(response({ items: [validIncident] }));

    const repository = new CloudIncidentRepository({
      fetchImpl: fetchImpl as typeof fetch,
    });

    const incidents = await repository.findAll();

    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({
      id: 'inc-001',
      reporterId: 'reporter-1',
      category: 'water',
      status: 'open',
    });
  });

  test('procesa correctamente el detalle de una incidencia', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(validIncident));

    const repository = new CloudIncidentRepository({
      fetchImpl: fetchImpl as typeof fetch,
    });

    const incident = await repository.findById('inc-001');

    expect(incident).toMatchObject({
      id: 'inc-001',
      description: 'Fuga sintética en laboratorio',
    });
  });

  test('crea una incidencia válida con clave de idempotencia', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(response({ incident: validIncident }));

    const repository = new CloudIncidentRepository({
      fetchImpl: fetchImpl as typeof fetch,
    });

    const incident = await repository.create({
      category: 'water',
      description: 'Fuga sintética en laboratorio',
      location: 'Edificio B',
      idempotencyKey: 'operation-001',
    });

    expect(incident.id).toBe('inc-001');

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('/v1/incidents'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Idempotency-Key': 'operation-001',
        }),
      }),
    );
  });

  test('no inventa una incidencia cuando el payload es null', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      response({
        ...validIncident,
        payload: null,
      }),
    );

    const repository = new CloudIncidentRepository({
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(repository.findById('inc-001')).rejects.toMatchObject({
      kind: 'domain',
    });
  });

  test('rechaza un recurso malformado como error de contrato', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      response({
        id: 'inc-001',
        status: 'open',
        payload: {},
      }),
    );

    const repository = new CloudIncidentRepository({
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(repository.findById('inc-001')).rejects.toMatchObject({
      kind: 'contract',
    });
  });

  test('convierte una respuesta HTTP 500 en un error controlado', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(response({ message: 'Synthetic failure' }, 500));

    const repository = new CloudIncidentRepository({
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(repository.findAll()).rejects.toMatchObject({
      kind: 'http',
      status: 500,
    });
  });

  test('aborta una respuesta lenta y produce un timeout controlado', async () => {
    const fetchImpl = jest.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    );

    const repository = new CloudIncidentRepository({
      fetchImpl: fetchImpl as typeof fetch,
      timeoutMs: 10,
    });

    await expect(repository.findAll()).rejects.toBeInstanceOf(
      CloudIncidentError,
    );

    await expect(
      new CloudIncidentRepository({
        fetchImpl: fetchImpl as typeof fetch,
        timeoutMs: 10,
      }).findAll(),
    ).rejects.toMatchObject({
      kind: 'timeout',
    });
  });
});