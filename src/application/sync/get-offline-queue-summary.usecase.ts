import type { OfflineQueuePort } from '../../domain/sync/offline-queue.port';

export type OfflineQueueSummary = Readonly<{
  pending: number;
  conflicts: number;
}>;

/** Consulta el estado real persistido; no mantiene un contador paralelo. */
export class GetOfflineQueueSummaryUseCase {
  constructor(private readonly queue: OfflineQueuePort) {}

  async execute(): Promise<OfflineQueueSummary> {
    const operations = await this.queue.list();
    return {
      pending: operations.filter((operation) => operation.status === 'pending').length,
      conflicts: operations.filter((operation) => operation.status === 'conflict').length,
    };
  }
}
