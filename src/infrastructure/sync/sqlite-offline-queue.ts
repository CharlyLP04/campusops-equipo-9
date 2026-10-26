import * as SQLite from 'expo-sqlite';

import type { OfflineQueuePort } from '../../domain/sync/offline-queue.port';
import type {
  PendingOperation,
  PendingOperationAction,
  PendingOperationStatus,
} from '../../domain/sync/pending-operation';
import type { SyncFields } from '../../domain/sync/sync.types';

type SqlValue = string | number | null;

type SqliteExecutor = Readonly<{
  runAsync(source: string, ...params: SqlValue[]): Promise<Readonly<{ changes: number }>>;
}>;

export type SqliteQueueDatabase = SqliteExecutor & Readonly<{
  execAsync(source: string): Promise<void>;
  getAllAsync<T>(source: string, ...params: SqlValue[]): Promise<T[]>;
  closeAsync(): Promise<void>;
  withExclusiveTransactionAsync(task: (transaction: SqliteExecutor) => Promise<void>): Promise<void>;
}>;

export type SqliteOfflineQueueOptions = Readonly<{
  databaseName?: string;
  openDatabase?: (databaseName: string) => Promise<SqliteQueueDatabase>;
}>;

type QueueRow = Readonly<{
  operationId: string;
  incidentId: string;
  authorId: string;
  action: string;
  payloadJson: string;
  baseVersion: number;
  baseFieldsJson: string;
  localFieldsJson: string;
  createdAt: string;
  attempts: number;
  status: string;
  lastError: string | null;
  conflictFieldsJson: string | null;
}>;

const DEFAULT_DATABASE_NAME = 'campusops-offline-queue.db';

const CREATE_SCHEMA = `
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS pending_operations (
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
  CREATE INDEX IF NOT EXISTS pending_operations_created_at_idx
    ON pending_operations(created_at, operation_id);
`;

const OPERATION_COLUMNS = `
  operation_id AS operationId,
  incident_id AS incidentId,
  author_id AS authorId,
  action,
  payload_json AS payloadJson,
  base_version AS baseVersion,
  base_fields_json AS baseFieldsJson,
  local_fields_json AS localFieldsJson,
  created_at AS createdAt,
  attempts,
  status,
  last_error AS lastError,
  conflict_fields_json AS conflictFieldsJson
`;

const INSERT_OPERATION = `
  INSERT OR IGNORE INTO pending_operations (
    operation_id, incident_id, author_id, action, payload_json, base_version,
    base_fields_json, local_fields_json, created_at, attempts, status,
    last_error, conflict_fields_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

const UPDATE_OPERATION = `
  UPDATE pending_operations SET
    incident_id = ?, author_id = ?, action = ?, payload_json = ?,
    base_version = ?, base_fields_json = ?, local_fields_json = ?,
    created_at = ?, attempts = ?, status = ?, last_error = ?,
    conflict_fields_json = ?
  WHERE operation_id = ?
`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function serializeFields(value: SyncFields, column: string): string {
  try {
    const serialized = JSON.stringify(value);
    if (!serialized) {
      throw new Error('not_json');
    }
    return serialized;
  } catch {
    throw new Error(`No se pudo serializar ${column} para la cola offline.`);
  }
}

function parseFields(value: string, column: string): SyncFields {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) {
      throw new Error('invalid_json_object');
    }
    return parsed;
  } catch {
    throw new Error(`La cola offline contiene ${column} inválido.`);
  }
}

function parseConflictFields(value: string | null): readonly string[] | undefined {
  if (value === null) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
      throw new Error('invalid_conflict_fields');
    }
    return parsed;
  } catch {
    throw new Error('La cola offline contiene conflictFields inválido.');
  }
}

function isAction(value: string): value is PendingOperationAction {
  return value === 'start' || value === 'resolve' || value === 'comment' || value === 'add_evidence';
}

function isStatus(value: string): value is PendingOperationStatus {
  return value === 'pending' || value === 'conflict' || value === 'failed';
}

function operationValues(operation: PendingOperation): readonly SqlValue[] {
  return [
    operation.operationId,
    operation.incidentId,
    operation.authorId,
    operation.action,
    serializeFields(operation.payload, 'payload'),
    operation.baseVersion,
    serializeFields(operation.baseFields, 'baseFields'),
    serializeFields(operation.localFields, 'localFields'),
    operation.createdAt,
    operation.attempts,
    operation.status,
    operation.lastError ?? null,
    operation.conflictFields ? JSON.stringify(operation.conflictFields) : null,
  ];
}

function toOperation(row: QueueRow): PendingOperation {
  if (!isAction(row.action) || !isStatus(row.status)) {
    throw new Error('La cola offline contiene un estado o acción inválidos.');
  }
  if (!Number.isInteger(row.baseVersion) || row.baseVersion < 0 || !Number.isInteger(row.attempts) || row.attempts < 0) {
    throw new Error('La cola offline contiene contadores inválidos.');
  }

  const conflictFields = parseConflictFields(row.conflictFieldsJson);
  return {
    operationId: row.operationId,
    incidentId: row.incidentId,
    authorId: row.authorId,
    action: row.action,
    payload: parseFields(row.payloadJson, 'payload'),
    baseVersion: row.baseVersion,
    baseFields: parseFields(row.baseFieldsJson, 'baseFields'),
    localFields: parseFields(row.localFieldsJson, 'localFields'),
    createdAt: row.createdAt,
    attempts: row.attempts,
    status: row.status,
    ...(row.lastError === null ? {} : { lastError: row.lastError }),
    ...(conflictFields === undefined ? {} : { conflictFields }),
  };
}

/**
 * Cola de producción respaldada por SQLite. La exclusión por instancia y las
 * transacciones exclusivas evitan que dos escrituras locales se sobrescriban.
 */
export class SqliteOfflineQueue implements OfflineQueuePort {
  private readonly databaseName: string;
  private readonly openDatabase: (databaseName: string) => Promise<SqliteQueueDatabase>;
  private databasePromise: Promise<SqliteQueueDatabase> | null = null;
  private writeTail: Promise<void> = Promise.resolve();

  constructor(options: SqliteOfflineQueueOptions = {}) {
    this.databaseName = options.databaseName ?? DEFAULT_DATABASE_NAME;
    this.openDatabase = options.openDatabase ?? ((name) =>
      SQLite.openDatabaseAsync(name, { useNewConnection: true }) as Promise<SqliteQueueDatabase>);
  }

  async enqueue(operation: PendingOperation): Promise<void> {
    const values = operationValues(operation);
    await this.withWriteLock(async () => {
      const database = await this.database();
      await database.withExclusiveTransactionAsync(async (transaction) => {
        await transaction.runAsync(INSERT_OPERATION, ...values);
      });
    });
  }

  async list(): Promise<readonly PendingOperation[]> {
    const database = await this.database();
    const rows = await database.getAllAsync<QueueRow>(
      `SELECT ${OPERATION_COLUMNS} FROM pending_operations ORDER BY created_at ASC, operation_id ASC`,
    );
    return rows.map(toOperation);
  }

  async replace(operation: PendingOperation): Promise<void> {
    const values = operationValues(operation).slice(1);
    await this.withWriteLock(async () => {
      const database = await this.database();
      await database.withExclusiveTransactionAsync(async (transaction) => {
        const result = await transaction.runAsync(UPDATE_OPERATION, ...values, operation.operationId);
        if (result.changes !== 1) {
          throw new Error(`No existe la operación ${operation.operationId} para reemplazar.`);
        }
      });
    });
  }

  async remove(operationId: string): Promise<void> {
    await this.withWriteLock(async () => {
      const database = await this.database();
      await database.withExclusiveTransactionAsync(async (transaction) => {
        await transaction.runAsync('DELETE FROM pending_operations WHERE operation_id = ?', operationId);
      });
    });
  }

  /** Libera la conexión; la siguiente operación puede abrir la misma base de nuevo. */
  async close(): Promise<void> {
    await this.withWriteLock(async () => {
      const current = this.databasePromise;
      if (!current) {
        return;
      }
      const database = await current;
      await database.closeAsync();
      this.databasePromise = null;
    });
  }

  private database(): Promise<SqliteQueueDatabase> {
    if (!this.databasePromise) {
      this.databasePromise = this.openDatabase(this.databaseName)
        .then(async (database) => {
          await database.execAsync(CREATE_SCHEMA);
          return database;
        })
        .catch((error: unknown) => {
          this.databasePromise = null;
          throw error;
        });
    }
    return this.databasePromise;
  }

  private withWriteLock<T>(work: () => Promise<T>): Promise<T> {
    const result = this.writeTail.then(work, work);
    this.writeTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
