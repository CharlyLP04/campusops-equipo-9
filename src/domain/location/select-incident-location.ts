
import type { IncidentLocation } from '../../campusops/contracts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

export function selectIncidentLocation(
  provider: unknown,
  manualLabel: string,
): IncidentLocation {
  const fallbackLabel = manualLabel.trim() || 'Ubicación manual';

  if (!isRecord(provider)) {
    return {
      source: 'manual',
      label: fallbackLabel,
    };
  }

  const label = provider.label;
  const latitude = provider.latitude;
  const longitude = provider.longitude;

  const isValid =
    typeof label === 'string' &&
    label.trim().length > 0 &&
    typeof latitude === 'number' &&
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    typeof longitude === 'number' &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180;

  if (!isValid) {
    return {
      source: 'manual',
      label: fallbackLabel,
    };
  }

  return {
    source: 'provider',
    label: label.trim(),
    latitude,
    longitude,
  };
}
