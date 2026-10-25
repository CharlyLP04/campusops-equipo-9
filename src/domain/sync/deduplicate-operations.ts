/**
 * Conserva la primera operación de cada `operationId` y descarta las
 * repeticiones posteriores. Devuelve un arreglo nuevo; la entrada y sus
 * elementos no se modifican.
 */
export function deduplicateOperations<T extends Readonly<{ operationId: string }>>(
  operations: readonly T[],
): readonly T[] {
  const seen = new Set<string>();
  const unique: T[] = [];

  for (const operation of operations) {
    if (seen.has(operation.operationId)) {
      continue;
    }
    seen.add(operation.operationId);
    unique.push(operation);
  }

  return unique;
}
