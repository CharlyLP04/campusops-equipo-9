import {
  DEFAULT_RETRY_POLICY,
  hasStableIdempotencyKey,
  parseRetryAfterHeader,
  planRetry,
} from '../src/domain/resilience/plan-retry';
import { executeWithRetry } from '../src/application/resilience/resilient-operation-runner';
import { planRetry as planRetryCourseEval } from '../src/course-evaluation';

describe('Semana 9 — planRetry y corredor resiliente con idempotencia', () => {
  describe('planRetry (contrato público y límites)', () => {
    it('permite reintentar un POST tras timeout cuando incluye una clave de idempotencia estable', () => {
      const decision = planRetryCourseEval({
        method: 'POST',
        status: 'timeout',
        attempt: 1,
        idempotencyKey: 'resolve-campus-inc-001-op-1',
      });

      expect(decision).toEqual({
        retry: true,
        delayMs: DEFAULT_RETRY_POLICY.baseDelayMs,
        requiresStableIdempotencyKey: false,
      });
    });

    it('rechaza reintentar cualquier POST sin idempotencyKey estable o con clave demasiado corta', () => {
      expect(
        planRetryCourseEval({
          method: 'POST',
          status: 503,
          attempt: 1,
        }),
      ).toEqual({
        retry: false,
        delayMs: 0,
        requiresStableIdempotencyKey: true,
      });

      expect(
        planRetry({
          method: 'POST',
          status: 'timeout',
          attempt: 1,
          idempotencyKey: '   ',
        }),
      ).toEqual({
        retry: false,
        delayMs: 0,
        requiresStableIdempotencyKey: true,
      });

      expect(
        planRetry({
          method: 'POST',
          status: 500,
          attempt: 1,
          idempotencyKey: 'short',
        }),
      ).toEqual({
        retry: false,
        delayMs: 0,
        requiresStableIdempotencyKey: true,
      });
    });

    it('respeta Retry-After válido en respuestas 429 o 503', () => {
      expect(
        planRetryCourseEval({
          method: 'GET',
          status: 429,
          attempt: 1,
          retryAfterMs: 800,
        }),
      ).toEqual({
        retry: true,
        delayMs: 800,
        requiresStableIdempotencyKey: false,
      });

      expect(
        planRetry({
          method: 'POST',
          status: 429,
          attempt: 2,
          retryAfterMs: 1200,
          idempotencyKey: 'close-campus-inc-001-op-2',
        }),
      ).toEqual({
        retry: true,
        delayMs: 1200,
        requiresStableIdempotencyKey: false,
      });
    });

    it('aplica espera progresiva (backoff exponencial finito) en intentos 1, 2 y 3 cuando no hay Retry-After', () => {
      const d1 = planRetry({ method: 'GET', status: 503, attempt: 1 });
      const d2 = planRetry({ method: 'GET', status: 503, attempt: 2 });
      const d3 = planRetry({ method: 'GET', status: 503, attempt: 3 });

      expect(d1).toEqual({ retry: true, delayMs: 200, requiresStableIdempotencyKey: false });
      expect(d2).toEqual({ retry: true, delayMs: 400, requiresStableIdempotencyKey: false });
      expect(d3).toEqual({ retry: true, delayMs: 800, requiresStableIdempotencyKey: false });
      expect(d1.delayMs).toBeLessThan(d2.delayMs);
      expect(d2.delayMs).toBeLessThan(d3.delayMs);
    });

    it('corta los reintentos a partir del intento 4 (sin reintentos infinitos)', () => {
      expect(planRetryCourseEval({ method: 'GET', status: 'timeout', attempt: 4 })).toEqual({
        retry: false,
        delayMs: 0,
        requiresStableIdempotencyKey: false,
      });

      expect(
        planRetry({
          method: 'POST',
          status: 'timeout',
          attempt: 4,
          idempotencyKey: 'resolve-campus-inc-001-op-1',
        }),
      ).toEqual({
        retry: false,
        delayMs: 0,
        requiresStableIdempotencyKey: false,
      });

      expect(planRetry({ method: 'GET', status: 429, attempt: 5, retryAfterMs: 500 })).toEqual({
        retry: false,
        delayMs: 0,
        requiresStableIdempotencyKey: false,
      });
    });

    it('no reintenta códigos HTTP de error definitivo (400, 401, 403, 404, 409, 422)', () => {
      for (const status of [400, 401, 403, 404, 409, 422]) {
        expect(
          planRetry({
            method: 'POST',
            status,
            attempt: 1,
            idempotencyKey: 'resolve-campus-inc-001-op-1',
          }),
        ).toEqual({
          retry: false,
          delayMs: 0,
          requiresStableIdempotencyKey: false,
        });
      }
    });

    it('acota Retry-After excesivo a maxDelayMs configurable', () => {
      const decision = planRetry(
        { method: 'GET', status: 429, attempt: 1, retryAfterMs: 999_999 },
        { maxDelayMs: 5000 },
      );
      expect(decision).toEqual({
        retry: true,
        delayMs: 5000,
        requiresStableIdempotencyKey: false,
      });
    });

    it('parsea correctamente el header Retry-After en segundos y valida claves de idempotencia', () => {
      expect(parseRetryAfterHeader('1')).toBe(1000);
      expect(parseRetryAfterHeader(' 0.8 ')).toBe(800);
      expect(parseRetryAfterHeader('invalid')).toBeUndefined();
      expect(parseRetryAfterHeader('-2')).toBeUndefined();
      expect(parseRetryAfterHeader(null)).toBeUndefined();

      expect(hasStableIdempotencyKey('resolve-campus-inc-001-op-1')).toBe(true);
      expect(hasStableIdempotencyKey('1234567')).toBe(false);
    });
  });

  describe('executeWithRetry (respuesta perdida, métricas y sanitización)', () => {
    it('recupera una resolución cuya respuesta se perdió tras guardar (timeout -> 200 duplicate) con la misma clave', async () => {
      const delays: number[] = [];
      let clock = 1000;

      const result = await executeWithRetry({
        method: 'POST',
        idempotencyKey: 'resolve-campus-inc-001-op-1',
        incidentId: 'campus-inc-001',
        actorId: 'technician-1',
        sleepImpl: async (ms) => {
          delays.push(ms);
        },
        nowImpl: () => {
          clock += 45;
          return clock;
        },
        executeAttempt: async (attempt) => {
          if (attempt === 1) {
            return {
              kind: 'fail',
              status: 'timeout',
              reason: 'timeout',
            };
          }
          return {
            kind: 'ok',
            status: 200,
            duplicate: true,
            value: { version: 3, status: 'resolved' },
          };
        },
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.attempts).toBe(2);
        expect(result.duplicate).toBe(true);
        expect(result.value).toEqual({ version: 3, status: 'resolved' });
      }
      expect(delays).toEqual([200]);
      expect(result.metrics).toHaveLength(2);
      expect(result.metrics[0]?.decision).toEqual({
        retry: true,
        delayMs: 200,
        requiresStableIdempotencyKey: false,
      });
      expect(result.metrics[1]?.duplicate).toBe(true);
    });

    it('se detiene en el intento 4 cuando la falla persiste y no entra en bucle infinito', async () => {
      const delays: number[] = [];
      let calls = 0;

      const result = await executeWithRetry({
        method: 'GET',
        incidentId: 'campus-inc-001',
        sleepImpl: async (ms) => {
          delays.push(ms);
        },
        executeAttempt: async () => {
          calls += 1;
          return {
            kind: 'fail',
            status: 503,
            reason: 'service_unavailable',
          };
        },
      });

      expect(calls).toBe(4);
      expect(delays).toEqual([200, 400, 800]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.attempts).toBe(4);
        expect(result.lastStatus).toBe(503);
      }
    });
  });
});
