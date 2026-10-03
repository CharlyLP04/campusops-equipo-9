import {
    parseRemoteResource,
  } from '../../course-evaluation';

  import type {
    Incident,
    IncidentCategory,
    IncidentStatus,
  } from '../../domain/incidents/incident.entity';

  import type {
    CreateIncidentInput,
    IncidentRepository,
  } from '../../domain/incidents/incident-repository.port';

  type FetchLike = typeof fetch;

  type CloudIncidentRepositoryOptions = Readonly<{
    baseUrl?: string;
    accessToken?: string;
    actorId?: string;
    timeoutMs?: number;
    scenario?: string;
    fetchImpl?: FetchLike;
  }>;

  export type CloudIncidentErrorKind =
    | 'timeout'
    | 'network'
    | 'http'
    | 'contract'
    | 'domain';

    export class CloudIncidentError extends Error {
        readonly kind: CloudIncidentErrorKind;
        readonly status: number | undefined;

        constructor(
          kind: CloudIncidentErrorKind,
          message: string,
          status?: number,
        ) {
          super(message);
          this.name = 'CloudIncidentError';
          this.kind = kind;
          this.status = status;
        }
      }

  const DEFAULT_URL = 'http://127.0.0.1:4310';
  const DEFAULT_TIMEOUT_MS = 5000;
  const DEFAULT_ACCESS_TOKEN = 'course-valid-token';
  const DEFAULT_ACTOR_ID = 'reporter-1';

  const INCIDENT_CATEGORIES: readonly IncidentCategory[] = [
    'electrical',
    'laboratory',
    'water',
    'connectivity',
    'equipment',
    'safety',
    'maintenance',
  ];

  const INCIDENT_STATUSES: readonly IncidentStatus[] = [
    'open',
    'assigned',
    'in_progress',
    'resolved',
    'closed',
  ];

  function isRecord(value: unknown): value is Record<string, unknown> {
    return (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value)
    );
  }

  function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  }

  function isIncidentCategory(value: unknown): value is IncidentCategory {
    return (
      typeof value === 'string' &&
      INCIDENT_CATEGORIES.includes(value as IncidentCategory)
    );
  }

  function isIncidentStatus(value: unknown): value is IncidentStatus {
    return (
      typeof value === 'string' &&
      INCIDENT_STATUSES.includes(value as IncidentStatus)
    );
  }

  function toDomainIncident(input: unknown): Incident {
    const parsed = parseRemoteResource(input);

    if (!parsed.ok) {
      throw new CloudIncidentError(
        'contract',
        'Remote incident does not match the published contract.',
      );
    }

    const { id, status, payload } = parsed.value;

    if (payload === null) {
      throw new CloudIncidentError(
        'domain',
        'Remote incident payload is null and cannot be converted to an Incident.',
      );
    }

    const category = payload.category;
    const description = payload.description;
    const location = payload.location;
    const reporterId = payload.reporterId;
    const assignedTechnicianId = payload.assignedTechnicianId;

    if (
      !isIncidentCategory(category) ||
      !isNonEmptyString(description) ||
      !isNonEmptyString(location) ||
      !isNonEmptyString(reporterId) ||
      !isIncidentStatus(status) ||
      !(
        assignedTechnicianId === null ||
        isNonEmptyString(assignedTechnicianId)
      )
    ) {
      throw new CloudIncidentError(
        'domain',
        'Remote incident payload does not satisfy the CampusOps domain.',
      );
    }

    return {
      id,
      reporterId,
      category,
      description,
      location: {
        source: 'manual',
        label: location,
      },
      assignedTechnicianId,
      status,
    };
  }

  function getResponseItems(body: unknown): readonly unknown[] {
    if (!isRecord(body) || !Array.isArray(body.items)) {
      throw new CloudIncidentError(
        'contract',
        'Remote incident list does not match the expected response contract.',
      );
    }

    return body.items;
  }

  export class CloudIncidentRepository implements IncidentRepository {
    private readonly baseUrl: string;
    private readonly accessToken: string;
    private readonly actorId: string;
    private readonly timeoutMs: number;
    private readonly scenario: string | undefined;
    private readonly fetchImpl: FetchLike;

    constructor(options: CloudIncidentRepositoryOptions = {}) {
      this.baseUrl =
        options.baseUrl ??
        process.env.EXPO_PUBLIC_COURSE_BACKEND_URL ??
        DEFAULT_URL;

      this.accessToken =
        options.accessToken ??
        process.env.EXPO_PUBLIC_COURSE_BACKEND_TOKEN ??
        DEFAULT_ACCESS_TOKEN;

      this.actorId =
        options.actorId ??
        process.env.EXPO_PUBLIC_COURSE_ACTOR ??
        DEFAULT_ACTOR_ID;

      this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      this.scenario = options.scenario;
      this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    }

    private async request(
      path: string,
      options: Readonly<{
        method: 'GET' | 'POST';
        body?: unknown;
        idempotencyKey?: string;
      }>,
    ): Promise<unknown> {
      const controller = new AbortController();

      const timeoutId = setTimeout(() => {
        controller.abort();
      }, this.timeoutMs);

      const headers: Record<string, string> = {
        Accept: 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
        'X-Course-Actor': this.actorId,
      };

      if (options.body !== undefined) {
        headers['Content-Type'] = 'application/json';
      }

      if (this.scenario) {
        headers['X-Course-Scenario'] = this.scenario;
      }

      if (options.idempotencyKey) {
        headers['Idempotency-Key'] = options.idempotencyKey;
      }

      try {
        const requestInit: RequestInit = {
            method: options.method,
            headers,
            signal: controller.signal,
          };

          if (options.body !== undefined) {
            requestInit.body = JSON.stringify(options.body);
          }

          const response = await this.fetchImpl(
            `${this.baseUrl}${path}`,
            requestInit,
          );

        if (!response.ok) {
          throw new CloudIncidentError(
            'http',
            `Cloud request failed with HTTP ${response.status}.`,
            response.status,
          );
        }

        try {
          return await response.json();
        } catch {
          throw new CloudIncidentError(
            'contract',
            'Cloud response was not valid JSON.',
          );
        }
      } catch (error) {
        if (error instanceof CloudIncidentError) {
          throw error;
        }

        if (controller.signal.aborted) {
          throw new CloudIncidentError(
            'timeout',
            'Cloud request timed out.',
          );
        }

        throw new CloudIncidentError(
          'network',
          'Cloud request failed before a valid response was received.',
        );
      } finally {
        clearTimeout(timeoutId);
      }
    }

    async findAll(): Promise<readonly Incident[]> {
      const body = await this.request('/v1/incidents', {
        method: 'GET',
      });

      return getResponseItems(body).map(toDomainIncident);
    }

    async findById(id: string): Promise<Incident | undefined> {
      const encodedId = encodeURIComponent(id);

      try {
        const body = await this.request(`/v1/incidents/${encodedId}`, {
          method: 'GET',
        });

        return toDomainIncident(body);
      } catch (error) {
        if (
          error instanceof CloudIncidentError &&
          error.kind === 'http' &&
          error.status === 404
        ) {
          return undefined;
        }

        throw error;
      }
    }

    async create(input: CreateIncidentInput): Promise<Incident> {
      if (
        input.idempotencyKey.trim().length < 8 ||
        !isNonEmptyString(input.description) ||
        !isNonEmptyString(input.location)
      ) {
        throw new CloudIncidentError(
          'domain',
          'Create incident input is invalid.',
        );
      }

      const body = await this.request('/v1/incidents', {
        method: 'POST',
        body: {
          category: input.category,
          description: input.description,
          location: input.location,
        },
        idempotencyKey: input.idempotencyKey,
      });

      if (!isRecord(body) || !Object.hasOwn(body, 'incident')) {
        throw new CloudIncidentError(
          'contract',
          'Create incident response does not match the expected contract.',
        );
      }

      return toDomainIncident(body.incident);
    }
  }
