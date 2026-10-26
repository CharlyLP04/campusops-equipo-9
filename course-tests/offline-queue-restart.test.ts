import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { PendingOperation } from '../src/domain/sync/pending-operation';
import type {
  SqliteQueueDatabase,
} from '../src/infrastructure/sync/sqlite-offline-queue';
import { SqliteOfflineQueue } from '../src/infrastructure/sync/sqlite-offline-queue';

class DiskSqliteConnection implements SqliteQueueDatabase {
  private readonly database: Database.Database;

  constructor(path: string) {
    this.database = new Database(path);
  }

  async execAsync(source: string): Promise<void> {
    this.database.exec(source);
  }

  async runAsync(source: string, ...params: readonly (string | number | null)[]) {
    const result = this.database.prepare(source).run(...params);
    return { changes: result.changes };
  }

  async getAllAsync<T>(source: string, ...params: readonly (string | number | null)[]): Promise<T[]> {
    return this.database.prepare(source).all(...params) as T[];
  }

  async withExclusiveTransactionAsync(
    task: (transaction: Pick<SqliteQueueDatabase, 'runAsync'>) => Promise<void>,
  ): Promise<void> {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      await task(this);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  async closeAsync(): Promise<void> {
    this.database.close();
  }
}

function operation(overrides: Partial<PendingOperation> = {}): PendingOperation {
  return {
    operationId: 'offline-op-0001',
    incidentId: 'campus-inc-001',
    authorId: 'technician-1',
    action: 'start',
    payload: {
      note: 'Atención iniciada sin conexión.',
      photoReference: 'photo-ref-local-001',
    },
    baseVersion: 1,
    baseFields: {
      work: { assignedTechnicianId: 'technician-1', status: 'assigned' },
    },
    localFields: {
      work: { assignedTechnicianId: 'technician-1', status: 'in_progress' },
    },
    createdAt: '2026-10-25T12:00:00.000Z',
    attempts: 0,
    status: 'pending',
    ...overrides,
  };
}

describe('SqliteOfflineQueue reinicia sobre una base SQLite real', () => {
  const directory = mkdtempSync(join(tmpdir(), 'campusops-offline-queue-'));
  const databasePath = join(directory, 'queue.db');

  const openDatabase = async (): Promise<SqliteQueueDatabase> =>
    new DiskSqliteConnection(databasePath);

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('conserva contenido, identidad, reemplazos y eliminación tras reabrir el archivo', async () => {
    const original = operation();
    const originalCopy = JSON.parse(JSON.stringify(original)) as PendingOperation;

    const first = new SqliteOfflineQueue({
      databaseName: 'queue.db',
      openDatabase,
    });
    try {
      await first.enqueue(original);
      await first.enqueue(operation({ payload: { note: 'No debe reemplazar la primera operación.' } }));

      expect(await first.list()).toEqual([originalCopy]);
      expect(original).toEqual(originalCopy);

      const replaced = operation({
        attempts: 1,
        status: 'conflict',
        lastError: 'version_conflict',
        conflictFields: ['work'],
      });
      await first.replace(replaced);
      await first.close();

      const second = new SqliteOfflineQueue({
        databaseName: 'queue.db',
        openDatabase,
      });
      try {
        expect(await second.list()).toEqual([replaced]);
        expect((await second.list())[0]?.operationId).toBe(original.operationId);
        await second.remove(original.operationId);
      } finally {
        await second.close();
      }

      const third = new SqliteOfflineQueue({
        databaseName: 'queue.db',
        openDatabase,
      });
      try {
        expect(await third.list()).toEqual([]);
      } finally {
        await third.close();
      }
    } finally {
      await first.close();
    }
  });
});
