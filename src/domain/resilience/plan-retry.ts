/**
 * Política de reintentos acotados y verificación de identidad estable (Semana 9).
 *
 * Reglas del contrato público (`docs/CAMPUSOPS_API.md` y `docs/assignments/week-09.md`):
 * 1. Límite de intentos: no se reintenta desde el intento 4 (`maxAttempts = 4`, es decir,
 *    sólo los intentos 1, 2 y 3 pueden programar un reintento).
 * 2. Seguridad en mutaciones (`POST`): nunca se repite un `POST` sin una clave de
 *    idempotencia estable (`idempotencyKey` no vacío de al menos 8 caracteres).
 * 3. Respeto a `Retry-After`: si el servidor o adaptador provee `retryAfterMs` finito y
 *    positivo, se utiliza como espera (acotada a `maxDelayMs`).
 * 4. Espera progresiva (backoff exponencial): cuando no hay `Retry-After`, la demora
 *    crece progresivamente (`baseDelayMs * 2^(attempt - 1)`) y siempre es finita.
 * 5. Clasificación de fallos: sólo se reintentan fallos transitorios (`'timeout'`, `408`,
 *    `429`, `500`, `502`, `503`, `504`). Errores de validación, autorización o conflicto
 *    (`400`, `401`, `403`, `404`, `409`, `422`) no se reintentan ciegamente.
 */

export type PlanRetryInput = Readonly<{
  method: 'GET' | 'POST';
  status: number | 'timeout';
  attempt: number;
  retryAfterMs?: number;
  idempotencyKey?: string;
}>;

export type PlanRetryDecision = Readonly<{
  retry: boolean;
  delayMs: number;
  requiresStableIdempotencyKey: boolean;
}>;

export type RetryPolicyConfig = Readonly<{
  /** Número de intento a partir del cual ya NO se reintenta (por defecto 4). */
  stopAtAttempt?: number;
  /** Espera base para el intento 1 cuando no hay Retry-After (por defecto 200 ms). */
  baseDelayMs?: number;
  /** Cota superior finita para cualquier espera de reintento (por defecto 10 000 ms). */
  maxDelayMs?: number;
  /** Longitud mínima exigida por el backend para Idempotency-Key (por defecto 8). */
  minIdempotencyKeyLength?: number;
}>;

export const DEFAULT_RETRY_POLICY: Required<RetryPolicyConfig> = {
  stopAtAttempt: 4,
  baseDelayMs: 200,
  maxDelayMs: 10_000,
  minIdempotencyKeyLength: 8,
};

const RETRYABLE_HTTP_STATUSES: ReadonlySet<number> = new Set([
  408, // Request Timeout
  429, // Too Many Requests
  500, // Internal Server Error
  502, // Bad Gateway
  503, // Service Unavailable
  504, // Gateway Timeout
]);

export function hasStableIdempotencyKey(
  key: string | undefined,
  minLength: number = DEFAULT_RETRY_POLICY.minIdempotencyKeyLength,
): boolean {
  return typeof key === 'string' && key.trim().length >= minLength;
}

export function isRetryableStatus(status: number | 'timeout'): boolean {
  if (status === 'timeout') {
    return true;
  }
  return typeof status === 'number' && Number.isInteger(status) && RETRYABLE_HTTP_STATUSES.has(status);
}

/**
 * Convierte un encabezado HTTP `Retry-After` (segundos enteros/decimales) en
 * milisegundos finitos. Devuelve `undefined` si el valor no es válido.
 */
export function parseRetryAfterHeader(headerValue: string | null | undefined): number | undefined {
  if (typeof headerValue !== 'string') {
    return undefined;
  }
  const trimmed = headerValue.trim();
  if (!trimmed) {
    return undefined;
  }
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.round(seconds * 1000);
  }
  return undefined;
}

export function planRetry(
  input: PlanRetryInput,
  config: RetryPolicyConfig = {},
): PlanRetryDecision {
  const stopAtAttempt = config.stopAtAttempt ?? DEFAULT_RETRY_POLICY.stopAtAttempt;
  const baseDelayMs = config.baseDelayMs ?? DEFAULT_RETRY_POLICY.baseDelayMs;
  const maxDelayMs = config.maxDelayMs ?? DEFAULT_RETRY_POLICY.maxDelayMs;
  const minKeyLength =
    config.minIdempotencyKeyLength ?? DEFAULT_RETRY_POLICY.minIdempotencyKeyLength;

  if (input.method === 'POST' && !hasStableIdempotencyKey(input.idempotencyKey, minKeyLength)) {
    return {
      retry: false,
      delayMs: 0,
      requiresStableIdempotencyKey: true,
    };
  }

  if (
    !Number.isInteger(input.attempt) ||
    input.attempt < 1 ||
    input.attempt >= stopAtAttempt ||
    !isRetryableStatus(input.status)
  ) {
    return {
      retry: false,
      delayMs: 0,
      requiresStableIdempotencyKey: false,
    };
  }

  let rawDelayMs: number;
  if (
    typeof input.retryAfterMs === 'number' &&
    Number.isFinite(input.retryAfterMs) &&
    input.retryAfterMs > 0
  ) {
    rawDelayMs = Math.round(input.retryAfterMs);
  } else {
    rawDelayMs = baseDelayMs * Math.pow(2, input.attempt - 1);
  }

  const boundedDelayMs = Math.max(1, Math.min(rawDelayMs, maxDelayMs));

  return {
    retry: true,
    delayMs: boundedDelayMs,
    requiresStableIdempotencyKey: false,
  };
}
