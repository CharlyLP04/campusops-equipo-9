
import type {
    GeocodingPort,
    GeocodingLookupResult,
    GeocodingProviderLocation,
    GeocodingFailureReason,
  } from '../../domain/location/geocoding.port';

  import { selectIncidentLocation } from '../../domain/location/select-incident-location';
  import { parseRetryAfterHeader } from '../../domain/resilience/plan-retry';

  type FetchLike = typeof fetch;

  type GeocodingCredentials = Readonly<{
    actorId: string;
    accessToken: string;
  }>;

  export type CachedGeocodingOptions = Readonly<{
    baseUrl?: string;
    timeoutMs?: number;
    cacheTtlMs?: number;
    fetchImpl?: FetchLike;
    credentialsProvider?: () => GeocodingCredentials | null;
    scenario?: string;
    nowImpl?: () => number;
  }>;

  type CacheEntry = Readonly<{
    location: GeocodingProviderLocation;
    expiresAt: number;
  }>;

  const DEFAULT_URL = 'http://127.0.0.1:4310';
  const DEFAULT_TIMEOUT_MS = 3000;
  const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

  function isRecord(value: unknown): value is Record<string, unknown> {
    return (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value)
    );
  }

  function normalizeQuery(query: string): string {
    return query.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function positiveFiniteOrDefault(
    value: number | undefined,
    fallback: number,
  ): number {
    return typeof value === 'number' &&
      Number.isFinite(value) &&
      value > 0
      ? value
      : fallback;
  }

  function getProviderFailureReason(
    payload: unknown,
  ): GeocodingFailureReason | null {
    if (!isRecord(payload)) {
      return 'malformed';
    }

    const { label, latitude, longitude } = payload;

    if (
      typeof label !== 'string' ||
      label.trim().length === 0 ||
      !Object.hasOwn(payload, 'latitude') ||
      !Object.hasOwn(payload, 'longitude')
    ) {
      return 'incomplete';
    }

    if (
      typeof latitude !== 'number' ||
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      typeof longitude !== 'number' ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    ) {
      return 'invalid_coordinates';
    }

    return null;
  }

  export class CachedGeocodingService implements GeocodingPort {
    private readonly baseUrl: string;
    private readonly timeoutMs: number;
    private readonly cacheTtlMs: number;
    private readonly fetchImpl: FetchLike;
    private readonly credentialsProvider:
      | (() => GeocodingCredentials | null)
      | undefined;
    private readonly scenario: string | undefined;
    private readonly nowImpl: () => number;

    private readonly cache = new Map<string, CacheEntry>();

    constructor(options: CachedGeocodingOptions = {}) {
      this.baseUrl = (
        options.baseUrl ??
        process.env.EXPO_PUBLIC_COURSE_BACKEND_URL ??
        DEFAULT_URL
      ).replace(/\/$/, '');

      this.timeoutMs = positiveFiniteOrDefault(
        options.timeoutMs,
        DEFAULT_TIMEOUT_MS,
      );

      this.cacheTtlMs = positiveFiniteOrDefault(
        options.cacheTtlMs,
        DEFAULT_CACHE_TTL_MS,
      );

      this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
      this.credentialsProvider = options.credentialsProvider;
      this.scenario = options.scenario;
      this.nowImpl = options.nowImpl ?? Date.now;
    }

    async geocode(query: string): Promise<GeocodingLookupResult> {
      const trimmedQuery =
        typeof query === 'string' ? query.trim() : '';

      const cacheKey = normalizeQuery(trimmedQuery);

      if (!cacheKey) {
        return {
          kind: 'unavailable',
          reason: 'incomplete',
          cacheHit: false,
        };
      }

      // 1. Consultar primero la caché.
      const cached = this.cache.get(cacheKey);

      if (cached && cached.expiresAt > this.nowImpl()) {
        return {
          kind: 'success',
          location: cached.location,
          cacheHit: true,
        };
      }

      if (cached) {
        this.cache.delete(cacheKey);
      }

      // 2. Obtener credenciales de la sesión.
      const credentials = this.credentialsProvider?.() ?? null;

      if (!credentials) {
        return {
          kind: 'unavailable',
          reason: 'network',
          cacheHit: false,
        };
      }

      const controller = new AbortController();

      const timeoutId = setTimeout(
        () => controller.abort(),
        this.timeoutMs,
      );

      try {
        // 3. Consultar el backend controlado.
        const url =
          `${this.baseUrl}/v1/geocoding?q=${encodeURIComponent(trimmedQuery)}`;

        const headers: Record<string, string> = {
          Accept: 'application/json',
          Authorization: `Bearer ${credentials.accessToken}`,
          'X-Course-Actor': credentials.actorId,
        };

        if (this.scenario) {
          headers['X-Course-Scenario'] = this.scenario;
        }

        const response = await this.fetchImpl(url, {
          method: 'GET',
          headers,
          signal: controller.signal,
        });

        // 4. Clasificar errores HTTP.
        if (response.status === 429) {
            const retryAfterMs = parseRetryAfterHeader(
              response.headers.get('Retry-After')
            );

            return retryAfterMs === undefined
              ? {
                  kind: 'unavailable',
                  reason: 'rate_limited',
                  cacheHit: false,
                }
              : {
                  kind: 'unavailable',
                  reason: 'rate_limited',
                  retryAfterMs,
                  cacheHit: false,
                };
          }

        if (response.status >= 500) {
          return {
            kind: 'unavailable',
            reason: 'server_error',
            cacheHit: false,
          };
        }

        if (!response.ok) {
          return {
            kind: 'unavailable',
            reason: 'http_error',
            cacheHit: false,
          };
        }

        // 5. Validar el JSON recibido.
        let payload: unknown;

        try {
          payload = await response.json();
        } catch {
          return {
            kind: 'unavailable',
            reason: controller.signal.aborted
              ? 'timeout'
              : 'malformed',
            cacheHit: false,
          };
        }

        const failureReason = getProviderFailureReason(payload);

        if (failureReason) {
          return {
            kind: 'unavailable',
            reason: failureReason,
            cacheHit: false,
          };
        }

        // 6. Validar nuevamente mediante la lógica del dominio.
        const selected = selectIncidentLocation(payload, trimmedQuery);

        if (
          selected.source !== 'provider' ||
          typeof selected.latitude !== 'number' ||
          typeof selected.longitude !== 'number'
        ) {
          return {
            kind: 'unavailable',
            reason: 'invalid_coordinates',
            cacheHit: false,
          };
        }

        const location: GeocodingProviderLocation = {
          label: selected.label,
          latitude: selected.latitude,
          longitude: selected.longitude,
        };

        // 7. Almacenar exclusivamente ubicaciones válidas.
        this.cache.set(cacheKey, {
          location,
          expiresAt: this.nowImpl() + this.cacheTtlMs,
        });

        return {
          kind: 'success',
          location,
          cacheHit: false,
        };
      } catch {
        return {
          kind: 'unavailable',
          reason: controller.signal.aborted
            ? 'timeout'
            : 'network',
          cacheHit: false,
        };
      } finally {
        clearTimeout(timeoutId);
      }
    }

    clearCache(): void {
      this.cache.clear();
    }
  }
