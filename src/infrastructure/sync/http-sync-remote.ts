import type {
  RemoteConflictReason,
  RemoteSubmitResult,
  SyncRemotePort,
} from '../../application/sync/sync-remote.port';
import { parseRemoteResource } from '../../course-evaluation';
import type { PendingOperation } from '../../domain/sync/pending-operation';
import type { SyncSnapshot } from '../../domain/sync/sync.types';

type FetchLike = typeof fetch;

export type HttpSyncRemoteOptions = Readonly<{
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  /** Token de sesión vigente (semana 6). Nunca se registra en logs. */
  accessTokenProvider?: () => string | null;
  scenario?: string;
}>;

const DEFAULT_URL = 'http://127.0.0.1:4310';
const DEFAULT_TIMEOUT_MS = 5000;
const CONFLICT_CODES: readonly RemoteConflictReason[] = [
  'version_conflict',
  'transition_conflict',
  'idempotency_key_reused',
];

function readCode(body: unknown): string | null {
  if (body && typeof body === 'object' && 'code' in body) {
    const code = (body as { code: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

/**
 * Adaptador HTTP de la cola contra `POST /v1/incidents/:id/actions`.
 * El `operationId` se envía como `Idempotency-Key`; el backend responde con
 * `duplicate: true` cuando la operación ya estaba aplicada.
 */
export class HttpSyncRemote implements SyncRemotePort {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;
  private readonly accessTokenProvider: () => string | null;
  private readonly scenario: string;

  constructor(options: HttpSyncRemoteOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_URL).replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.accessTokenProvider = options.accessTokenProvider ?? (() => 'course-valid-token');
    this.scenario = options.scenario ?? 'success';
  }

  async submit(operation: PendingOperation): Promise<RemoteSubmitResult> {
    let response: Response;
    try {
      response = await this.request(
        `/v1/incidents/${encodeURIComponent(operation.incidentId)}/actions`,
        operation.authorId,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': operation.operationId },
          body: JSON.stringify({
            ...operation.payload,
            action: operation.action,
            baseVersion: operation.baseVersion,
          }),
        },
      );
    } catch (error) {
      return {
        kind: 'retryable',
        reason: error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'network',
      };
    }

    const body: unknown = await response.json().catch(() => null);

    if (response.status === 200 || response.status === 201) {
      const incident = (body as { incident?: { version?: unknown } } | null)?.incident;
      const version = typeof incident?.version === 'number' ? incident.version : NaN;
      if (!Number.isInteger(version)) {
        // 2xx sin contrato válido: no se puede afirmar que se aplicó.
        return { kind: 'retryable', reason: 'contract' };
      }
      return {
        kind: 'applied',
        version,
        duplicate: (body as { duplicate?: unknown }).duplicate === true,
      };
    }

    const code = readCode(body);
    if (response.status === 409) {
      const reason = CONFLICT_CODES.find((item) => item === code) ?? 'version_conflict';
      const currentVersion = (body as { currentVersion?: unknown } | null)?.currentVersion;
      return typeof currentVersion === 'number'
        ? { kind: 'conflict', reason, currentVersion }
        : { kind: 'conflict', reason };
    }
    if (response.status === 403) {
      return { kind: 'conflict', reason: 'forbidden' };
    }
    if (response.status === 401 || response.status === 408 || response.status === 429 || response.status >= 500) {
      return { kind: 'retryable', reason: code ?? `http_${response.status}` };
    }
    return { kind: 'rejected', reason: code ?? `http_${response.status}` };
  }

  async fetchSnapshot(incidentId: string, actorId: string): Promise<SyncSnapshot | null> {
    const response = await this.request(
      `/v1/incidents/${encodeURIComponent(incidentId)}`,
      actorId,
      { method: 'GET' },
    );
    if (response.status === 403 || response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`snapshot_http_${response.status}`);
    }
    const parsed = parseRemoteResource(await response.json());
    if (!parsed.ok) {
      throw new Error('snapshot_contract');
    }
    const payload = parsed.value.payload ?? {};
    const assigned = payload.assignedTechnicianId;
    return {
      id: parsed.value.id,
      version: parsed.value.version,
      fields: {
        work: {
          assignedTechnicianId: typeof assigned === 'string' ? assigned : null,
          status: parsed.value.status,
        },
      },
    };
  }

  private async request(path: string, actorId: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.accessTokenProvider() ?? ''}`,
          'X-Course-Actor': actorId,
          'X-Course-Scenario': this.scenario,
          ...(init.headers as Record<string, string> | undefined),
        },
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
