import type { SyncFields, SyncResolution, SyncSnapshot } from './sync.types';

const ABSENT = '\u0000absent';

/**
 * Serialización JSON canónica: ordena las claves de los objetos para que dos
 * valores con el mismo contenido produzcan la misma cadena aunque sus claves
 * se hayan escrito en distinto orden o sean objetos distintos en memoria.
 */
export function canonicalJson(value: unknown): string {
  if (value === undefined) {
    return ABSENT;
  }
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      const source = item as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(source)
          .sort()
          .map((key) => [key, source[key]]),
      );
    }
    return item;
  });
}

function fieldValue(fields: SyncFields, name: string): string {
  return Object.prototype.hasOwnProperty.call(fields, name)
    ? canonicalJson(fields[name])
    : ABSENT;
}

/**
 * Combinación de tres vías campo por campo.
 *
 * - Si sólo un lado cambió un campo respecto de la base, se toma ese lado.
 * - Si ambos lo cambiaron al mismo contenido, no hay conflicto.
 * - Si ambos lo cambiaron a contenidos distintos, el campo es incompatible.
 *
 * Los campos incompatibles se devuelven ordenados por nombre. La función es
 * pura: no muta `base`, `local` ni `remote`.
 */
export function resolveSync(
  base: SyncSnapshot,
  local: SyncSnapshot,
  remote: SyncSnapshot,
): SyncResolution {
  const names = Array.from(
    new Set([
      ...Object.keys(base.fields),
      ...Object.keys(local.fields),
      ...Object.keys(remote.fields),
    ]),
  ).sort();

  const merged: Record<string, unknown> = {};
  const conflicts: string[] = [];

  for (const name of names) {
    const baseValue = fieldValue(base.fields, name);
    const localValue = fieldValue(local.fields, name);
    const remoteValue = fieldValue(remote.fields, name);
    const localChanged = localValue !== baseValue;
    const remoteChanged = remoteValue !== baseValue;

    if (localChanged && remoteChanged && localValue !== remoteValue) {
      conflicts.push(name);
      continue;
    }

    const source = localChanged ? local.fields : remote.fields;
    if (Object.prototype.hasOwnProperty.call(source, name)) {
      merged[name] = source[name];
    }
  }

  if (conflicts.length > 0) {
    return { kind: 'conflict', fields: conflicts };
  }

  return { kind: 'merged', fields: merged };
}
