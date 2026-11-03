import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';

import {
  createResolveIncidentLocationUseCase,
} from '../src/application/location/resolve-incident-location.usecase';
import {
  CachedGeocodingService,
} from '../src/infrastructure/location/cached-geocoding.service';
import {
  HttpSyncRemote,
} from '../src/infrastructure/sync/http-sync-remote';
import type {
  PendingOperation,
} from '../src/domain/sync/pending-operation';

function nodeFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url = new URL(
    typeof input === 'string' ? input : input.toString(),
  );

  return new Promise((resolve, reject) => {
    const request = http.request(
      url,
      {
        method: init?.method ?? 'GET',
        headers: init?.headers as http.OutgoingHttpHeaders,
      },
      (response) => {
        const chunks: Buffer[] = [];

        response.on('data', (chunk: Buffer) => chunks.push(chunk));

        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const status = response.statusCode ?? 500;

          resolve({
            ok: status >= 200 && status < 300,
            status,
            headers: {
              get(name: string): string | null {
                const value =
                  response.headers[name.toLowerCase()];

                if (Array.isArray(value)) {
                  return value[0] ?? null;
                }

                return value ?? null;
              },
            },
            json: async () => JSON.parse(text),
            text: async () => text,
          } as unknown as Response);
        });
      },
    );

    const abort = (): void => {
      request.destroy();

      const error = new Error('The operation was aborted.');
      error.name = 'AbortError';
      reject(error);
    };

    if (init?.signal) {
      if (init.signal.aborted) {
        abort();
        return;
      }

      init.signal.addEventListener('abort', abort, {
        once: true,
      });
    }

    request.on('error', reject);

    if (typeof init?.body === 'string') {
      request.write(init.body);
    }

    request.end();
  });
}

let backend: ChildProcessWithoutNullStreams;
let baseUrl = '';

function startBackend(): Promise<void> {
  return new Promise((resolve, reject) => {
    backend = spawn(
      process.execPath,
      [
        path.join(
          __dirname,
          '..',
          'course-backend',
          'server.mjs',
        ),
      ],
      {
        env: {
          ...process.env,
          COURSE_BACKEND_HOST: '127.0.0.1',
          COURSE_BACKEND_PORT: '0',
        },
      },
    );

    const timeout = setTimeout(() => {
      reject(new Error('El backend didáctico no inició.'));
    }, 10_000);

    backend.stdout.on('data', (chunk: Buffer) => {
      const match = /listening at (http:\/\/[^\s]+)/.exec(
        chunk.toString(),
      );

      if (match?.[1]) {
        clearTimeout(timeout);
        baseUrl = match[1];
        resolve();
      }
    });

    backend.on('error', reject);
  });
}

const credentialsProvider = () => ({
  actorId: 'technician-1',
  accessToken: 'course-valid-token',
});

function geocodingService(
  scenario = 'success',
  timeoutMs = 200,
  fetchImpl: typeof fetch = nodeFetch,
): CachedGeocodingService {
  return new CachedGeocodingService({
    baseUrl,
    scenario,
    timeoutMs,
    cacheTtlMs: 60_000,
    credentialsProvider,
    fetchImpl,
  });
}

async function postAction(
  body: Record<string, unknown>,
  idempotencyKey: string,
): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  const response = await nodeFetch(
    `${baseUrl}/v1/incidents/campus-inc-001/actions`,
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer course-valid-token',
        'X-Course-Actor': 'technician-1',
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(body),
    },
  );

  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

async function readIncident(): Promise<{
  version: number;
  status: string;
  payload: {
    history: Array<{
      operationId: string;
      action: string;
    }>;
  };
}> {
  const response = await nodeFetch(
    `${baseUrl}/v1/incidents/campus-inc-001`,
    {
      headers: {
        Authorization: 'Bearer course-valid-token',
        'X-Course-Actor': 'technician-1',
      },
    },
  );

  return response.json() as Promise<{
    version: number;
    status: string;
    payload: {
      history: Array<{
        operationId: string;
        action: string;
      }>;
    };
  }>;
}

beforeAll(startBackend, 15_000);

afterAll(() => {
  backend?.kill();
});

describe('Semana 9 — inyección real de fallas y resiliencia', () => {
  test('geocodificación nominal y segunda consulta desde caché', async () => {
    let networkCalls = 0;

    const countingFetch: typeof fetch = async (input, init) => {
      networkCalls += 1;
      return nodeFetch(input, init);
    };

    const service = geocodingService(
      'success',
      200,
      countingFetch,
    );

    const first = await service.geocode('Edificio A');
    const second = await service.geocode('  edificio   a  ');

    expect(first).toEqual({
      kind: 'success',
      location: {
        label: 'Edificio de prueba A',
        latitude: 0,
        longitude: 0,
      },
      cacheHit: false,
    });

    expect(second).toEqual({
      kind: 'success',
      location: {
        label: 'Edificio de prueba A',
        latitude: 0,
        longitude: 0,
      },
      cacheHit: true,
    });

    expect(networkCalls).toBe(1);
  });

  test.each([
    'incomplete',
    'invalid_coordinates',
    'rate_limited',
    'server_error',
    'malformed',
    'slow',
  ])(
    'el escenario %s degrada limpiamente a ubicación manual',
    async (scenario) => {
      const service = geocodingService(
        scenario,
        scenario === 'slow' ? 50 : 200,
      );

      const resolveLocation =
        createResolveIncidentLocationUseCase({
          geocoding: service,
          sleep: async () => undefined,
        });

      await expect(
        resolveLocation(
          'Edificio A',
          'Entrada principal del campus',
        ),
      ).resolves.toEqual({
        source: 'manual',
        label: 'Entrada principal del campus',
      });
    },
  );

  test('429 respeta Retry-After y se detiene en el intento 4', async () => {
    let networkCalls = 0;
    const delays: number[] = [];

    const countingFetch: typeof fetch = async (input, init) => {
      networkCalls += 1;
      return nodeFetch(input, init);
    };

    const resolveLocation =
      createResolveIncidentLocationUseCase({
        geocoding: geocodingService(
          'rate_limited',
          200,
          countingFetch,
        ),
        sleep: async (milliseconds) => {
          delays.push(milliseconds);
        },
      });

    await expect(
      resolveLocation('Edificio A', 'Ubicación manual'),
    ).resolves.toEqual({
      source: 'manual',
      label: 'Ubicación manual',
    });

    expect(networkCalls).toBe(4);
    expect(delays).toEqual([1000, 1000, 1000]);
  });

  test('500 usa backoff y se detiene sin bucle infinito', async () => {
    let networkCalls = 0;
    const delays: number[] = [];

    const countingFetch: typeof fetch = async (input, init) => {
      networkCalls += 1;
      return nodeFetch(input, init);
    };

    const resolveLocation =
      createResolveIncidentLocationUseCase({
        geocoding: geocodingService(
          'server_error',
          200,
          countingFetch,
        ),
        sleep: async (milliseconds) => {
          delays.push(milliseconds);
        },
      });

    await expect(
      resolveLocation('Edificio A', 'Captura manual'),
    ).resolves.toEqual({
      source: 'manual',
      label: 'Captura manual',
    });

    expect(networkCalls).toBe(4);
    expect(delays).toEqual([200, 400, 800]);
  });

  test(
    'timeout_after_commit reintenta con la misma clave y no duplica historial',
    async () => {
      const start = await postAction(
        {
          action: 'start',
          baseVersion: 1,
        },
        'start-campus-inc-001-w09',
      );

      expect(start.status).toBe(201);

      const operation: PendingOperation = {
        operationId: 'resolve-campus-inc-001-op-1',
        incidentId: 'campus-inc-001',
        authorId: 'technician-1',
        action: 'resolve',
        payload: {
          diagnosis: 'Diagnóstico ficticio de laboratorio',
        },
        baseVersion: 2,
        baseFields: {
          status: 'in_progress',
        },
        localFields: {
          status: 'resolved',
          diagnosis: 'Diagnóstico ficticio de laboratorio',
        },
        createdAt: '2026-11-03T04:00:00.000Z',
        attempts: 0,
        status: 'pending',
      };

      const remote = new HttpSyncRemote({
        baseUrl,
        fetchImpl: nodeFetch,
        timeoutMs: 200,
        scenarioForAttempt: (attempt) =>
          attempt === 1
            ? 'timeout_after_commit'
            : 'success',
        sleepImpl: async () => undefined,
      });

      const result = await remote.submitWithRetry(operation);

      expect(result.ok).toBe(true);

      if (!result.ok) {
        throw new Error('La resolución no se recuperó.');
      }

      expect(result.attempts).toBe(2);
      expect(result.duplicate).toBe(true);
      expect(result.value).toMatchObject({
        kind: 'applied',
        version: 3,
        duplicate: true,
      });

      expect(result.metrics).toHaveLength(2);
      expect(result.metrics[0]).toMatchObject({
        attempt: 1,
        status: 'timeout',
        duplicate: false,
      });
      expect(result.metrics[1]).toMatchObject({
        attempt: 2,
        status: 200,
        duplicate: true,
      });

      const incident = await readIncident();

      expect(incident.version).toBe(3);
      expect(incident.status).toBe('resolved');

      const resolutionHistory = incident.payload.history.filter(
        (entry) =>
          entry.operationId ===
            'resolve-campus-inc-001-op-1' &&
          entry.action === 'resolve',
      );

      expect(resolutionHistory).toHaveLength(1);

      const telemetry = JSON.stringify(result.telemetry);

      expect(telemetry).not.toContain('technician-1');
      expect(telemetry).not.toContain('course-valid-token');
      expect(telemetry).not.toContain('latitude');
      expect(telemetry).not.toContain('longitude');
    },
    15_000,
  );
});