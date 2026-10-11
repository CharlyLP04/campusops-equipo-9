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

function makeResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response;
}

const loginPayload = {
  actorId: 'reporter-1',
  role: 'reporter',
  accessToken: 'test-access-token',
  refreshToken: 'test-refresh-token',
  expiresIn: 60,
};

describe('SessionAuthService', () => {
  let storage: MemoryStorage;
  let fetchImpl: jest.Mock<
    Promise<Response>,
    [string, RequestInit | undefined]
  >;
  let service: SessionAuthService;
  let setNow: (time: number) => void;

  beforeEach(() => {
    let currentTime = 1_000;

    setNow = (time: number) => {
      currentTime = time;
    };

    storage = new MemoryStorage();

    fetchImpl = jest.fn<Promise<Response>, [string, RequestInit | undefined]>(
      async (_input: string, _init?: RequestInit): Promise<Response> =>
        makeResponse({}),
    );

    service = new SessionAuthService({
      baseUrl: 'http://127.0.0.1:4310',
      storage,
      fetchImpl,
      clock: { now: () => currentTime },
    });
  });

  it('inicia sesión y persiste las credenciales sin exponerlas en el estado público', async () => {
    fetchImpl.mockResolvedValueOnce(makeResponse(loginPayload));

    const state = await service.login('reporter-1');

    expect(state.status).toBe('authenticated');
    if (state.status !== 'authenticated') throw new Error('Expected an authenticated session');
    expect(state.actorId).toBe('reporter-1');

    expect(service.getAccessToken()).toBe('test-access-token');

    expect(state).not.toHaveProperty('accessToken');
    expect(state).not.toHaveProperty('refreshToken');

    const saved = await storage.getItem(CAMPUSOPS_SESSION_STORAGE_KEY);

    expect(saved).not.toBeNull();
    expect(JSON.parse(saved as string).refreshToken).toBe(
      'test-refresh-token',
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:4310/v1/session/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ actorId: 'reporter-1' }),
      }),
    );
  });

  it('detecta la expiración usando el reloj controlado, sin esperar', async () => {
    fetchImpl.mockResolvedValueOnce(makeResponse(loginPayload));

    await service.login('reporter-1');

    setNow(61_000);

    expect(service.getState().status).toBe('expired');
    expect(service.getAccessToken()).toBeNull();
  });

  it('renueva las credenciales y aumenta la generación de sesión', async () => {
    fetchImpl
      .mockResolvedValueOnce(makeResponse(loginPayload))
      .mockResolvedValueOnce(
        makeResponse({
          accessToken: 'renewed-access-token',
          refreshToken: 'renewed-refresh-token',
          expiresIn: 120,
        }),
      );

    await service.login('reporter-1');
    const state = await service.refresh();

    expect(state.status).toBe('authenticated');
    if (state.status !== 'authenticated') throw new Error('Expected an authenticated session');
    expect(state.generation).toBe(1);
    expect(service.getAccessToken()).toBe('renewed-access-token');

    const saved = JSON.parse(
      (await storage.getItem(CAMPUSOPS_SESSION_STORAGE_KEY)) as string,
    );

    expect(saved.refreshToken).toBe('renewed-refresh-token');
  });

  it('pasa a anónimo y elimina las credenciales cuando falla la renovación', async () => {
    fetchImpl
      .mockResolvedValueOnce(makeResponse(loginPayload))
      .mockResolvedValueOnce(
        makeResponse({ code: 'invalid_grant' }, 401),
      );

    await service.login('reporter-1');

    await expect(service.refresh()).rejects.toThrow(
      'La sesión no pudo renovarse',
    );

    expect(service.getState().status).toBe('anonymous');
    expect(service.getAccessToken()).toBeNull();
    expect(
      await storage.getItem(CAMPUSOPS_SESSION_STORAGE_KEY),
    ).toBeNull();
  });

  it('cierra la sesión y elimina las credenciales persistidas', async () => {
    fetchImpl.mockResolvedValueOnce(makeResponse(loginPayload));

    await service.login('reporter-1');
    await service.logout();

    expect(service.getState()).toEqual({ status: 'anonymous' });
    expect(service.getAccessToken()).toBeNull();
    expect(
      await storage.getItem(CAMPUSOPS_SESSION_STORAGE_KEY),
    ).toBeNull();
  });
});

