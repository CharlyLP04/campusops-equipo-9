import { DatabaseSync } from 'node:sqlite';

import {
  migrateSchemaV1ToV2,
  type MigrationDatabase,
} from '../src/infrastructure/storage/migrations/schema-migration';

function createAdapter(database: DatabaseSync): MigrationDatabase {
  return {
    async execAsync(source: string): Promise<void> {
      database.exec(source);
    },

    async getAllAsync<T>(
      source: string,
      ...params: (string | number | null)[]
    ): Promise<T[]> {
      return database.prepare(source).all(...params) as T[];
    },
  };
}

function prepareVersionOne(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE incidents (
      id TEXT PRIMARY KEY NOT NULL,
      status TEXT NOT NULL,
      assigned_technician_id TEXT,
      description TEXT NOT NULL
    );

    CREATE TABLE pending_operations (
      operation_id TEXT PRIMARY KEY NOT NULL,
      incident_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      action TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      base_version INTEGER NOT NULL,
      base_fields_json TEXT NOT NULL,
      local_fields_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      attempts INTEGER NOT NULL,
      status TEXT NOT NULL,
      last_error TEXT,
      conflict_fields_json TEXT
    );

    INSERT INTO incidents (
      id,
      status,
      assigned_technician_id,
      description
    ) VALUES (
      'campus-inc-001',
      'assigned',
      'technician-1',
      'Falla eléctrica de prueba'
    );

    INSERT INTO pending_operations (
      operation_id,
      incident_id,
      author_id,
      action,
      payload_json,
      base_version,
      base_fields_json,
      local_fields_json,
      created_at,
      attempts,
      status,
      last_error,
      conflict_fields_json
    ) VALUES (
      'operation-stable-001',
      'campus-inc-001',
      'technician-1',
      'start',
      '{"note":"Inicio sin conexión","photoReference":"local://photo-001"}',
      1,
      '{"status":"assigned"}',
      '{"status":"in_progress"}',
      '2026-10-27T03:30:00.000Z',
      0,
      'pending',
      NULL,
      NULL
    );

    PRAGMA user_version = 1;
  `);
}

function schemaVersion(database: DatabaseSync): number {
  return (
    database.prepare('PRAGMA user_version').get() as {
      user_version: number;
    }
  ).user_version;
}

function columns(
  database: DatabaseSync,
  table: string,
): string[] {
  return (
    database.prepare(`PRAGMA table_info(${table})`).all() as {
      name: string;
    }[]
  ).map((column) => column.name);
}

function incidents(database: DatabaseSync): unknown[] {
  return database
    .prepare('SELECT * FROM incidents ORDER BY id')
    .all();
}

function operations(database: DatabaseSync): unknown[] {
  return database
    .prepare(
      'SELECT * FROM pending_operations ORDER BY operation_id',
    )
    .all();
}

describe('Migración atómica del esquema v1 a v2', () => {
  let database: DatabaseSync;

  beforeEach(() => {
    database = new DatabaseSync(':memory:');
    prepareVersionOne(database);
  });

  afterEach(() => {
    database.close();
  });

  test('registra antes, rollback tras falla y recuperación completa', async () => {
    const adapter = createAdapter(database);

    const before = {
      version: schemaVersion(database),
      incidents: incidents(database),
      operations: operations(database),
      incidentColumns: columns(database, 'incidents'),
    };

    expect(before.version).toBe(1);
    expect(before.incidents).toHaveLength(1);
    expect(before.operations).toHaveLength(1);
    expect(before.incidentColumns).not.toContain('sync_state');

    await expect(
      migrateSchemaV1ToV2(adapter, { failAfterStep: 2 }),
    ).rejects.toThrow('Falla controlada después del paso 2.');

    const afterFailure = {
      version: schemaVersion(database),
      incidents: incidents(database),
      operations: operations(database),
      incidentColumns: columns(database, 'incidents'),
    };

    expect(afterFailure).toEqual(before);

    const result = await migrateSchemaV1ToV2(adapter);

    expect(result).toEqual({
      fromVersion: 1,
      toVersion: 2,
      applied: true,
    });

    const afterRecovery = {
      version: schemaVersion(database),
      incidents: incidents(database),
      operations: operations(database),
      incidentColumns: columns(database, 'incidents'),
    };

    expect(afterRecovery.version).toBe(2);
    expect(afterRecovery.incidentColumns).toContain('sync_state');
    expect(afterRecovery.incidents).toEqual([
      {
        id: 'campus-inc-001',
        status: 'assigned',
        assigned_technician_id: 'technician-1',
        description: 'Falla eléctrica de prueba',
        sync_state: 'pending',
      },
    ]);

    expect(afterRecovery.operations).toEqual(before.operations);
    expect(
      (
        afterRecovery.operations[0] as {
          operation_id: string;
        }
      ).operation_id,
    ).toBe('operation-stable-001');
  });

  test('volver a ejecutar v2 no duplica ni modifica datos', async () => {
    const adapter = createAdapter(database);

    await migrateSchemaV1ToV2(adapter);
    const beforeSecondRun = {
      incidents: incidents(database),
      operations: operations(database),
    };

    await expect(migrateSchemaV1ToV2(adapter)).resolves.toEqual({
      fromVersion: 2,
      toVersion: 2,
      applied: false,
    });

    expect({
      incidents: incidents(database),
      operations: operations(database),
    }).toEqual(beforeSecondRun);
  });
});