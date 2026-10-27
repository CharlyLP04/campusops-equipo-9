type SqlValue = string | number | null;

export type MigrationDatabase = Readonly<{
  execAsync(source: string): Promise<void>;
  getAllAsync<T>(source: string, ...params: SqlValue[]): Promise<T[]>;
}>;

export type MigrationOptions = Readonly<{
  failAfterStep?: number;
}>;

export type MigrationResult = Readonly<{
  fromVersion: number;
  toVersion: number;
  applied: boolean;
}>;

export const SCHEMA_VERSION_V1 = 1;
export const SCHEMA_VERSION_V2 = 2;

async function readSchemaVersion(
  database: MigrationDatabase,
): Promise<number> {
  const rows = await database.getAllAsync<{ user_version: number }>(
    'PRAGMA user_version',
  );

  const version = rows[0]?.user_version;

  if (
  typeof version !== 'number' ||
  !Number.isInteger(version)
) {
  throw new Error('No fue posible determinar la versión del esquema.');
}

return version;
}

function injectFailure(
  completedStep: number,
  options: MigrationOptions,
): void {
  if (options.failAfterStep === completedStep) {
    throw new Error(
      `Falla controlada después del paso ${completedStep}.`,
    );
  }
}

/**
 * Migra el almacenamiento local de v1 a v2 dentro de una sola transacción.
 *
 * v2 agrega sync_state a las incidencias. Las incidencias que tienen una
 * operación pendiente quedan marcadas como pending; las demás como synced.
 * La tabla pending_operations no se reconstruye, por lo que conserva
 * operationId y todo el contenido serializado.
 */
export async function migrateSchemaV1ToV2(
  database: MigrationDatabase,
  options: MigrationOptions = {},
): Promise<MigrationResult> {
  const currentVersion = await readSchemaVersion(database);

  if (currentVersion === SCHEMA_VERSION_V2) {
    return {
      fromVersion: SCHEMA_VERSION_V2,
      toVersion: SCHEMA_VERSION_V2,
      applied: false,
    };
  }

  if (currentVersion !== SCHEMA_VERSION_V1) {
    throw new Error(
      `Versión de esquema no compatible: ${currentVersion}.`,
    );
  }

  await database.execAsync('BEGIN IMMEDIATE TRANSACTION');

  try {
    await database.execAsync(`
      ALTER TABLE incidents
      ADD COLUMN sync_state TEXT NOT NULL DEFAULT 'synced'
      CHECK (sync_state IN ('synced', 'pending', 'conflict'));
    `);
    injectFailure(1, options);

    await database.execAsync(`
      UPDATE incidents
      SET sync_state = 'pending'
      WHERE EXISTS (
        SELECT 1
        FROM pending_operations
        WHERE pending_operations.incident_id = incidents.id
      );
    `);
    injectFailure(2, options);

    await database.execAsync(
      `PRAGMA user_version = ${SCHEMA_VERSION_V2}`,
    );
    injectFailure(3, options);

    await database.execAsync('COMMIT');

    return {
      fromVersion: SCHEMA_VERSION_V1,
      toVersion: SCHEMA_VERSION_V2,
      applied: true,
    };
  } catch (error) {
    await database.execAsync('ROLLBACK');
    throw error;
  }
}