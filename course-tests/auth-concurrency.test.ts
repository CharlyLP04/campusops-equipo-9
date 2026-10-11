import type { AuthEvent } from '../src/course-evaluation/contracts';
import { SessionCoordinator } from '../src/domain/auth/session-coordinator';
import type { SecureStoragePort } from '../src/domain/security/secure-storage.port';
import {
  CAMPUSOPS_SESSION_STORAGE_KEY,
} from '../src/infrastructure/auth/expo-secure-storage.adapter';
import { SessionAuthService } from '../src/infrastructure/auth/session-auth.service';

class MemorySecureStorage implements SecureStoragePort {
  private readonly values = new Map<string, string>();

  readonly removedKeys: string[] = [];

  async getItem(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.removedKeys.push(key);
    this.values.delete(key);
  }

  async clear(): Promise<void> {
    this.values.clear();
  }
}

describe('Concurrencia y resiliencia de sesión — Semana 6', () => {
  test('deduplica una ráfaga de 25 respuestas 401 en un solo refresh', () => {
    const coordinator = new SessionCoordinator();

    const requests: AuthEvent[] = Array.from(
      { length: 25 },
      (_, index) => ({
        type: 'request401',
        requestId: `request-${index + 1}`,
        generation: 0,
      }),
    );

    const summary = coordinator.processEvents([
      ...requests,
      {
        type: 'refreshSucceeded',
        generation: 1,
        token: 'synthetic-token-generation-1',
      },
    ]);

    expect(summary.refreshCalls).toBe(1);
    expect(summary.status).toBe('authenticated');
    expect(summary.activeGeneration).toBe(1);
    expect(summary.retriedRequestIds).toHaveLength(25);
    expect(new Set(summary.retriedRequestIds).size).toBe(25);
  });

  test('reintenta cada solicitud encolada exactamente una vez', () => {
    const coordinator = new SessionCoordinator();

    const summary = coordinator.processEvents([
      { type: 'request401', requestId: 'list', generation: 0 },
      { type: 'request401', requestId: 'detail', generation: 0 },
      { type: 'request401', requestId: 'create', generation: 0 },
      { type: 'request401', requestId: 'list', generation: 0 },
      {
        type: 'refreshSucceeded',
        generation: 1,
        token: 'synthetic-retry-token',
      },
    ]);

    expect(summary.refreshCalls).toBe(1);
    expect(summary.retriedRequestIds).toEqual([
      'list',
      'detail',
      'create',
    ]);

    expect(
      summary.retriedRequestIds.filter(
        requestId => requestId === 'list',
      ),
    ).toHaveLength(1);
  });

  test('un refresh fallido regresa a anonymous sin reintentos ni loops', () => {
    const coordinator = new SessionCoordinator();

    const requests: AuthEvent[] = Array.from(
      { length: 50 },
      (_, index) => ({
        type: 'request401',
        requestId: `failed-request-${index + 1}`,
        generation: 0,
      }),
    );

    const summary = coordinator.processEvents([
      ...requests,
      { type: 'refreshFailed' },
    ]);

    expect(summary.refreshCalls).toBe(1);
    expect(summary.status).toBe('anonymous');
    expect(summary.activeGeneration).toBeNull();
    expect(summary.persistedToken).toBeNull();
    expect(summary.retriedRequestIds).toEqual([]);
  });

  test('un 401 atrasado no provoca un refresh duplicado', () => {
    const coordinator = new SessionCoordinator();

    const summary = coordinator.processEvents([
      { type: 'request401', requestId: 'original', generation: 0 },
      {
        type: 'refreshSucceeded',
        generation: 1,
        token: 'synthetic-current-token',
      },
      {
        type: 'request401',
        requestId: 'late-response',
        generation: 0,
      },
    ]);

    expect(summary.refreshCalls).toBe(1);
    expect(summary.activeGeneration).toBe(1);
    expect(summary.retriedRequestIds).toEqual([
      'original',
      'late-response',
    ]);
  });

  test('logout elimina completamente la sesión del almacenamiento', async () => {
    const storage = new MemorySecureStorage();

    await storage.setItem(
      CAMPUSOPS_SESSION_STORAGE_KEY,
      JSON.stringify({
        actorId: 'reporter-1',
        role: 'reporter',
        accessToken: 'synthetic-access-token',
        refreshToken: 'synthetic-refresh-token',
        expiresAt: 9999999999999,
        generation: 1,
      }),
    );

    const service = new SessionAuthService({ storage });

    await service.initialize();
    expect(service.getState().status).toBe('authenticated');

    await service.logout();

    expect(service.getState()).toEqual({ status: 'anonymous' });
    expect(
      await storage.getItem(CAMPUSOPS_SESSION_STORAGE_KEY),
    ).toBeNull();

    expect(storage.removedKeys).toContain(
      CAMPUSOPS_SESSION_STORAGE_KEY,
    );
  });
});