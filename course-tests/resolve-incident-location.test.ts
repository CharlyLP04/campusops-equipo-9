
import {
    createResolveIncidentLocationUseCase,
  } from '../src/application/location/resolve-incident-location.usecase';

  import type {
    GeocodingPort,
    GeocodingLookupResult,
    GeocodingFailureReason,
  } from '../src/domain/location/geocoding.port';

  const validLocation = {
    label: 'Edificio Central',
    latitude: 18.462,
    longitude: -97.395,
  };

  function success(): GeocodingLookupResult {
    return {
      kind: 'success',
      location: validLocation,
      cacheHit: false,
    };
  }

  function unavailable(
    reason: GeocodingFailureReason,
    retryAfterMs?: number,
  ): GeocodingLookupResult {
    return retryAfterMs === undefined
      ? {
          kind: 'unavailable',
          reason,
          cacheHit: false,
        }
      : {
          kind: 'unavailable',
          reason,
          retryAfterMs,
          cacheHit: false,
        };
  }

  function createFakeGeocoder(
    results: readonly GeocodingLookupResult[],
  ) {
    let calls = 0;

    const geocoding: GeocodingPort = {
      geocode: async () => {
        const result = results[calls];
        calls += 1;

        if (!result) {
          throw new Error('No hay más respuestas configuradas');
        }

        return result;
      },
    };

    return {
      geocoding,
      getCalls: () => calls,
    };
  }

  describe('ResolveIncidentLocationUseCase', () => {
    test('returns provider location when geocoding succeeds', async () => {
      const fake = createFakeGeocoder([success()]);

      const useCase = createResolveIncidentLocationUseCase({
        geocoding: fake.geocoding,
      });

      const result = await useCase(
        'Edificio Central',
        'Ubicación manual',
      );

      expect(result).toEqual({
        source: 'provider',
        label: 'Edificio Central',
        latitude: 18.462,
        longitude: -97.395,
      });

      expect(fake.getCalls()).toBe(1);
    });

    test('respects Retry-After when the provider returns 429', async () => {
      const fake = createFakeGeocoder([
        unavailable('rate_limited', 1250),
        success(),
      ]);

      const delays: number[] = [];

      const useCase = createResolveIncidentLocationUseCase({
        geocoding: fake.geocoding,
        sleep: async (milliseconds) => {
          delays.push(milliseconds);
        },
      });

      const result = await useCase(
        'Edificio Central',
        'Ubicación manual',
      );

      expect(result.source).toBe('provider');
      expect(delays).toEqual([1250]);
      expect(fake.getCalls()).toBe(2);
    });

    test('uses exponential backoff for transient server errors', async () => {
      const fake = createFakeGeocoder([
        unavailable('server_error'),
        unavailable('server_error'),
        success(),
      ]);

      const delays: number[] = [];

      const useCase = createResolveIncidentLocationUseCase({
        geocoding: fake.geocoding,
        sleep: async (milliseconds) => {
          delays.push(milliseconds);
        },
      });

      const result = await useCase(
        'Edificio Central',
        'Ubicación manual',
      );

      expect(result.source).toBe('provider');
      expect(delays).toEqual([200, 400]);
      expect(fake.getCalls()).toBe(3);
    });

    test('stops after four requests and uses manual fallback', async () => {
      const fake = createFakeGeocoder([
        unavailable('timeout'),
        unavailable('timeout'),
        unavailable('timeout'),
        unavailable('timeout'),
      ]);

      const delays: number[] = [];

      const useCase = createResolveIncidentLocationUseCase({
        geocoding: fake.geocoding,
        sleep: async (milliseconds) => {
          delays.push(milliseconds);
        },
      });

      const result = await useCase(
        'Edificio Central',
        'Mi ubicación manual',
      );

      expect(result).toEqual({
        source: 'manual',
        label: 'Mi ubicación manual',
      });

      expect(fake.getCalls()).toBe(4);
      expect(delays).toEqual([200, 400, 800]);
      expect(result).not.toHaveProperty('latitude');
      expect(result).not.toHaveProperty('longitude');
    });

    test('does not retry malformed provider responses', async () => {
      const fake = createFakeGeocoder([
        unavailable('malformed'),
      ]);

      const delays: number[] = [];

      const useCase = createResolveIncidentLocationUseCase({
        geocoding: fake.geocoding,
        sleep: async (milliseconds) => {
          delays.push(milliseconds);
        },
      });

      const result = await useCase(
        'Edificio Central',
        'Ubicación manual',
      );

      expect(result.source).toBe('manual');
      expect(fake.getCalls()).toBe(1);
      expect(delays).toEqual([]);
    });

    test('does not query provider when search is empty', async () => {
      const fake = createFakeGeocoder([]);

      const useCase = createResolveIncidentLocationUseCase({
        geocoding: fake.geocoding,
      });

      const result = await useCase(
        '   ',
        'Ubicación alternativa',
      );

      expect(result).toEqual({
        source: 'manual',
        label: 'Ubicación alternativa',
      });

      expect(fake.getCalls()).toBe(0);
    });

    test('uses manual fallback when provider throws an exception', async () => {
      const geocoding: GeocodingPort = {
        geocode: async () => {
          throw new Error('Connection failed');
        },
      };

      const useCase = createResolveIncidentLocationUseCase({
        geocoding,
      });

      const result = await useCase(
        'Edificio Central',
        'Ubicación manual',
      );

      expect(result).toEqual({
        source: 'manual',
        label: 'Ubicación manual',
      });
    });
  });
