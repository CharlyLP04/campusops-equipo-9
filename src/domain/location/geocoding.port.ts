
export type GeocodingProviderLocation = Readonly<{
    label: string;
    latitude: number;
    longitude: number;
  }>;

  export type GeocodingFailureReason =
  | 'timeout'
  | 'rate_limited'
  | 'server_error'
  | 'malformed'
  | 'incomplete'
  | 'invalid_coordinates'
  | 'network'
  | 'http_error';


  export type GeocodingLookupResult =
    | Readonly<{
        kind: 'success';
        location: GeocodingProviderLocation;
        cacheHit: boolean;
      }>
    | Readonly<{
        kind: 'unavailable';
        reason: GeocodingFailureReason;
        retryAfterMs?: number;
        cacheHit: boolean;
      }>;

  export interface GeocodingPort {
    geocode(query: string): Promise<GeocodingLookupResult>;
  }
