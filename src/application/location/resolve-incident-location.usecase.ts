import type { IncidentLocation } from '../../campusops/contracts';

import {
  selectIncidentLocation,
} from '../../domain/location/select-incident-location';

import type {
  GeocodingPort,
  GeocodingLookupResult,
  GeocodingFailureReason,
} from '../../domain/location/geocoding.port';

import {
  planRetry,
} from '../../domain/resilience/plan-retry';

type SleepFunction = (milliseconds: number) => Promise<void>;

type ResolveIncidentLocationOptions = Readonly<{
  geocoding: GeocodingPort;
  sleep?: SleepFunction;
}>;

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function getRetryStatus(
  reason: GeocodingFailureReason,
): number | 'timeout' {
  switch (reason) {
    case 'timeout':
      return 'timeout';

    case 'rate_limited':
      return 429;

    case 'server_error':
      return 500;

    default:
      return 0;
  }
}

export function createResolveIncidentLocationUseCase(
  options: ResolveIncidentLocationOptions,
): (
  query: string,
  manualLabel: string,
) => Promise<IncidentLocation> {
  const sleep = options.sleep ?? defaultSleep;

  return async function resolveIncidentLocation(
    query: string,
    manualLabel: string,
  ): Promise<IncidentLocation> {
    const normalizedQuery = query.trim();

    const manualFallback = (): IncidentLocation =>
      selectIncidentLocation(null, manualLabel);

    if (!normalizedQuery) {
      return manualFallback();
    }

    let attempt = 1;

    while (true) {
      let result: GeocodingLookupResult;

      try {
        result = await options.geocoding.geocode(normalizedQuery);
      } catch {
        return manualFallback();
      }

      if (result.kind === 'success') {
        return selectIncidentLocation(
          result.location,
          manualLabel,
        );
      }

      const status = getRetryStatus(result.reason);

      const decision = planRetry({
        method: 'GET',
        status,
        attempt,
        ...(result.retryAfterMs === undefined
          ? {}
          : { retryAfterMs: result.retryAfterMs }),
      });

      if (!decision.retry) {
        return manualFallback();
      }

      try {
        await sleep(decision.delayMs);
      } catch {
        return manualFallback();
      }

      attempt += 1;
    }
  };
}