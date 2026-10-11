import type { SecureStoragePort } from '../src/domain/security/secure-storage.port';
import { SessionAuthService } from '../src/infrastructure/auth/session-auth.service';
import { CAMPUSOPS_SESSION_STORAGE_KEY } from '../src/infrastructure/auth/expo-secure-storage.adapter';

class MemoryStorage implements SecureStoragePort {
  private readonly values = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.values.delete(key);
  }

  async clear(): Promise<void> {
    this.values.clear();
  }
}

function storedSession(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    actorId: 'reporter-1',
    role: 'reporter',
    accessToken: 'persisted-access-token',
    refreshToken: 'persisted-refresh-token',
    expiresAt: 61_000,
    generation: 2,
    ...overrides,
  });
}

describe('Restauración de sesión persistida', () => {
  it('restaura una sesión vigente sin exponer sus tokens en la identidad pública', async () => {
    const storage = new MemoryStorage();
    await storage.setItem(
      CAMPUSOPS_SESSION_STORAGE_KEY,
      storedSession(),
    );

    const service = new SessionAuthService({
      storage,
      clock: { now: () => 1_000 },
    });

    const state = await service.initialize();

    expect(state.status).toBe('authenticated');
    expect(service.getAuthenticatedIdentity()).toEqual({
      actorId: 'reporter-1',
      role: 'reporter',
    });

    expect(state).not.toHaveProperty('accessToken');
    expect(state).not.toHaveProperty('refreshToken');
    expect(service.getAccessToken()).toBe('persisted-access-token');
  });

  it('restaura una sesión vencida como expired y bloquea el token de acceso', async () => {
    const storage = new MemoryStorage();
    await storage.setItem(
      CAMPUSOPS_SESSION_STORAGE_KEY,
      storedSession({ expiresAt: 1_000 }),
    );

    const service = new SessionAuthService({
      storage,
      clock: { now: () => 1_000 },
    });

    const state = await service.initialize();

    expect(state.status).toBe('expired');
    expect(service.getAccessToken()).toBeNull();
    expect(service.getAuthenticatedIdentity()).toBeNull();
  });

  it('elimina del almacenamiento una sesión con rol inconsistente', async () => {
    const storage = new MemoryStorage();

    await storage.setItem(
      CAMPUSOPS_SESSION_STORAGE_KEY,
      storedSession({ role: 'coordinator' }),
    );

    const service = new SessionAuthService({
      storage,
      clock: { now: () => 1_000 },
    });

    const state = await service.initialize();

    expect(state).toEqual({ status: 'anonymous' });
    expect(
      await storage.getItem(CAMPUSOPS_SESSION_STORAGE_KEY),
    ).toBeNull();
  });

  it('limpia un documento persistido malformado', async () => {
    const storage = new MemoryStorage();
    await storage.setItem(CAMPUSOPS_SESSION_STORAGE_KEY, '{invalid-json');

    const service = new SessionAuthService({
      storage,
      clock: { now: () => 1_000 },
    });

    const state = await service.initialize();

    expect(state).toEqual({ status: 'anonymous' });
    expect(
      await storage.getItem(CAMPUSOPS_SESSION_STORAGE_KEY),
    ).toBeNull();
  });
});
