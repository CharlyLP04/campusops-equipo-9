import {
  DEFAULT_RETRY_POLICY,
  planRetry,
  type PlanRetryDecision,
  type RetryPolicyConfig,
} from '../../domain/resilience/plan-retry';
import { redactForTelemetry } from '../../course-evaluation';

/**
 * Resultado de un intento individual ejecutado por el adaptador de transporte.
 */
export type AttemptOutcome<T> =
  | Readonly<{
      kind: 'ok';
      value: T;
      status: number;
      duplicate?: boolean;
    }>
  | Readonly<{
      kind: 'fail';
      status: number | 'timeout';
      retryAfterMs?: number;
      reason: string;
    }>;

/**
 * Registro sanitizado de cada intento para observabilidad y evidencia (`retry-metrics.json`).
 * Nunca expone tokens, actores personales ni coordenadas; se pasa por `redactForTelemetry`.
 */
export type SanitizedAttemptMetric = Readonly<{
  attempt: number;
  status: number | 'timeout';
  durationMs: number;
  decision: PlanRetryDecision;
  duplicate: boolean;
}>;

export type ResilientExecutionResult<T> =
  | Readonly<{
      ok: true;
      value: T;
      attempts: number;
      duplicate: boolean;
      metrics: readonly SanitizedAttemptMetric[];
      telemetry: unknown;
    }>
  | Readonly<{
      ok: false;
      reason: string;
      lastStatus: number | 'timeout';
      attempts: number;
      requiresStableIdempotencyKey: boolean;
      metrics: readonly SanitizedAttemptMetric[];
      telemetry: unknown;
    }>;

export type ExecuteWithRetryOptions<T> = Readonly<{
  method: 'GET' | 'POST';
  idempotencyKey?: string;
  correlationId?: string;
  incidentId?: string;
  actorId?: string;
  policy?: RetryPolicyConfig;
  sleepImpl?: (ms: number) => Promise<void>;
  nowImpl?: () => number;
  executeAttempt: (attempt: number) => Promise<AttemptOutcome<T>>;
}>;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Ejecuta una operación remota aplicando `planRetry` entre intentos.
 * - Corta inmediatamente si `POST` carece de `idempotencyKey` estable.
 * - Respeta `Retry-After` y el límite `stopAtAttempt` (no reintenta desde el intento 4).
 * - Conserva la misma identidad de operación en cada reintento para recuperar respuestas
 *   perdidas (`timeout_after_commit`) sin duplicar efectos en el servidor.
 */
export async function executeWithRetry<T>(
  options: ExecuteWithRetryOptions<T>,
): Promise<ResilientExecutionResult<T>> {
  const sleep = options.sleepImpl ?? defaultSleep;
  const now = options.nowImpl ?? Date.now;
  const stopAtAttempt =
    options.policy?.stopAtAttempt ?? DEFAULT_RETRY_POLICY.stopAtAttempt;

  const metrics: SanitizedAttemptMetric[] = [];

  if (options.method === 'POST') {
    const preflight = planRetry(
      {
        method: 'POST',
        status: 503,
        attempt: 1,
        ...(options.idempotencyKey !== undefined
          ? { idempotencyKey: options.idempotencyKey }
          : {}),
      },
      options.policy,
    );
    if (preflight.requiresStableIdempotencyKey) {
      const telemetry = redactForTelemetry({
        incidentId: options.incidentId ?? 'unknown',
        correlationId: options.correlationId ?? 'missing-key',
        actorId: options.actorId,
        status: 'rejected_missing_idempotency_key',
        attempt: 0,
        durationMs: 0,
      });
      return {
        ok: false,
        reason: 'idempotency_key_required',
        lastStatus: 400,
        attempts: 0,
        requiresStableIdempotencyKey: true,
        metrics,
        telemetry,
      };
    }
  }

  for (let attempt = 1; attempt <= stopAtAttempt; attempt += 1) {
    const startedAt = now();
    const outcome = await options.executeAttempt(attempt);
    const durationMs = Math.max(0, now() - startedAt);

    if (outcome.kind === 'ok') {
      const decision: PlanRetryDecision = {
        retry: false,
        delayMs: 0,
        requiresStableIdempotencyKey: false,
      };
      const duplicate = outcome.duplicate === true;
      metrics.push({
        attempt,
        status: outcome.status,
        durationMs,
        decision,
        duplicate,
      });

      const telemetry = redactForTelemetry({
        incidentId: options.incidentId ?? 'n/a',
        correlationId: options.correlationId ?? options.idempotencyKey ?? 'ok',
        actorId: options.actorId,
        status: outcome.status,
        attempt,
        durationMs,
      });

      return {
        ok: true,
        value: outcome.value,
        attempts: attempt,
        duplicate,
        metrics,
        telemetry,
      };
    }

    const decision = planRetry(
      {
        method: options.method,
        status: outcome.status,
        attempt,
        ...(outcome.retryAfterMs !== undefined
          ? { retryAfterMs: outcome.retryAfterMs }
          : {}),
        ...(options.idempotencyKey !== undefined
          ? { idempotencyKey: options.idempotencyKey }
          : {}),
      },
      options.policy,
    );

    metrics.push({
      attempt,
      status: outcome.status,
      durationMs,
      decision,
      duplicate: false,
    });

    if (!decision.retry) {
      const telemetry = redactForTelemetry({
        incidentId: options.incidentId ?? 'n/a',
        correlationId: options.correlationId ?? options.idempotencyKey ?? 'failed',
        actorId: options.actorId,
        status: outcome.status,
        attempt,
        durationMs,
      });

      return {
        ok: false,
        reason: outcome.reason,
        lastStatus: outcome.status,
        attempts: attempt,
        requiresStableIdempotencyKey: decision.requiresStableIdempotencyKey,
        metrics,
        telemetry,
      };
    }

    await sleep(decision.delayMs);
  }

  const lastMetric = metrics[metrics.length - 1];
  const lastStatus = lastMetric?.status ?? 'timeout';
  const telemetry = redactForTelemetry({
    incidentId: options.incidentId ?? 'n/a',
    correlationId: options.correlationId ?? options.idempotencyKey ?? 'exhausted',
    actorId: options.actorId,
    status: lastStatus,
    attempt: metrics.length,
    durationMs: lastMetric?.durationMs ?? 0,
  });

  return {
    ok: false,
    reason: 'max_retries_exceeded',
    lastStatus,
    attempts: metrics.length,
    requiresStableIdempotencyKey: false,
    metrics,
    telemetry,
  };
}
