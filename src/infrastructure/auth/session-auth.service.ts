import type { SecureStoragePort } from '../../domain/security/secure-storage.port';
import type {
  AuthenticatedIdentity,
  SessionIdentityPort,
} from '../../domain/auth/session-identity.port';
import {
  roleForActor,
  type CampusOpsActorId,
  type CampusOpsRole,
} from '../../domain/auth/role-authorization';
import type {
  AuthSessionRecord,
  SessionClock,
  SessionSnapshot,
} from '../../domain/auth/session.types';
import {
  CAMPUSOPS_SESSION_STORAGE_KEY,
  ExpoSecureStorageAdapter,
} from './expo-secure-storage.adapter';

type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

type SessionAuthOptions = Readonly<{
  baseUrl?: string;
  storage?: SecureStoragePort;
  fetchImpl?: FetchLike;
  clock?: SessionClock;
}>;

const DEFAULT_URL =
  process.env.EXPO_PUBLIC_COURSE_BACKEND_URL ?? 'http://127.0.0.1:4310';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export class SessionAuthService implements SessionIdentityPort {
  private readonly baseUrl: string;
  private readonly storage: SecureStoragePort;
  private readonly fetchImpl: FetchLike;
  private readonly clock: SessionClock;

  private session: AuthSessionRecord | null = null;
  private state: SessionSnapshot = { status: 'anonymous' };

  constructor(options: SessionAuthOptions = {}) {
    this.baseUrl = (
      options.baseUrl ??
      DEFAULT_URL
    ).replace(/\/+$/, '');

    this.storage =
      options.storage ?? new ExpoSecureStorageAdapter();

    this.fetchImpl =
      options.fetchImpl ??
      ((input, init) => fetch(input, init));

    this.clock = options.clock ?? { now: () => Date.now() };
  }

  /**
   * Recupera una sesión persistida. Una sesión vencida conserva
   * temporalmente las credenciales privadas para intentar renovarla.
   */
  async initialize(): Promise<SessionSnapshot> {
    let raw: string | null;

    try {
      raw = await this.storage.getItem(CAMPUSOPS_SESSION_STORAGE_KEY);
    } catch {
      this.session = null;
      this.state = { status: 'anonymous' };
      throw new Error(
        '[Auth] No se pudo recuperar la sesión del almacenamiento seguro.',
      );
    }

    if (!raw) {
      this.session = null;
      this.state = { status: 'anonymous' };
      return this.state;
    }

    const restored = this.parseStoredSession(raw);

    if (!restored) {
      this.session = null;
      this.state = { status: 'anonymous' };

      try {
        await this.storage.removeItem(CAMPUSOPS_SESSION_STORAGE_KEY);
      } catch {
        throw new Error(
          '[Auth] No se pudo eliminar una sesión persistida inválida.',
        );
      }

      return this.state;
    }

    this.session = restored;
    this.state = this.snapshotFor(restored);
    return this.getState();
  }

  /**
   * Inicia sesión con una identidad sintética admitida por el backend
   * del curso. El rol esperado se obtiene de la identidad conocida.
   */
  async login(actorId: string): Promise<SessionSnapshot> {
    const expectedRole = roleForActor(actorId);

    if (!expectedRole) {
      throw new Error('[Auth] La identidad de prueba no está permitida.');
    }

    await this.logout();

    try {
      const payload = await this.post('/v1/session/login', { actorId });
      const tokens = this.parseTokenResponse(payload);

      if (
        !isRecord(payload) ||
        payload.actorId !== actorId ||
        payload.role !== expectedRole
      ) {
        throw new Error('invalid_login_contract');
      }

      const next: AuthSessionRecord = {
        actorId: actorId as CampusOpsActorId,
        role: expectedRole,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: this.clock.now() + tokens.expiresIn * 1000,
        generation: 0,
      };

      await this.storage.setItem(
        CAMPUSOPS_SESSION_STORAGE_KEY,
        JSON.stringify(next),
      );

      this.session = next;
      this.state = this.snapshotFor(next);
      return this.getState();
    } catch {
      this.session = null;
      this.state = { status: 'anonymous' };

      try {
        await this.storage.removeItem(CAMPUSOPS_SESSION_STORAGE_KEY);
      } catch {
        throw new Error(
          '[Auth] No se pudieron eliminar las credenciales tras el fallo de inicio.',
        );
      }

      throw new Error(
        '[Auth] No se pudo iniciar sesión. Revisa la identidad de prueba y el servicio.',
      );
    }
  }

  /**
   * Devuelve un estado público sin incluir accessToken ni refreshToken.
   * La expiración se evalúa con el reloj inyectado, sin esperas artificiales.
   */
  getState(): SessionSnapshot {
    if (
      this.session &&
      this.state.status !== 'refreshing' &&
      this.clock.now() >= this.session.expiresAt
    ) {
      this.state = {
        status: 'expired',
        actorId: this.session.actorId,
        role: this.session.role,
        expiresAt: this.session.expiresAt,
        generation: this.session.generation,
      };
    }

    return this.state;
  }

  /**
   * Solo entrega el token de acceso mientras la sesión está vigente.
   * El consumidor es responsable de no imprimir el valor en logs.
   */
  getAccessToken(): string | null {
    return this.getState().status === 'authenticated'
      ? this.session?.accessToken ?? null
      : null;
  }

  getActorId(): CampusOpsActorId | null {
    const state = this.getState();
    return state.status === 'anonymous' ? null : state.actorId;
  }

  getRequestCredentials(): Readonly<{
    actorId: CampusOpsActorId;
    accessToken: string;
  }> | null {
    const state = this.getState();

    if (state.status !== 'authenticated' || !this.session) {
      return null;
    }

    return {
      actorId: this.session.actorId,
      accessToken: this.session.accessToken,
    };
  }

  /**
   * Proporciona identidad únicamente cuando la sesión está vigente.
   * La identidad pública nunca incluye tokens.
   */
  getAuthenticatedIdentity(): AuthenticatedIdentity | null {
    const state = this.getState();

    if (state.status !== 'authenticated') {
      return null;
    }

    return {
      actorId: state.actorId,
      role: state.role,
    };
  }

  /**
   * Renueva la sesión actual. Cualquier fallo invalida el estado en
   * memoria y elimina la credencial persistida para evitar reutilizarla.
   * La coordinación entre solicitudes simultáneas corresponde al
   * componente de concurrencia de Semana 6.
   */
  async refresh(): Promise<SessionSnapshot> {
    const previous = this.session;

    if (!previous) {
      await this.logout();
      return this.state;
    }

    this.state = {
      status: 'refreshing',
      actorId: previous.actorId,
      role: previous.role,
      expiresAt: previous.expiresAt,
      generation: previous.generation,
    };

    try {
      const payload = await this.post('/v1/session/refresh', {
        refreshToken: previous.refreshToken,
      });

      const tokens = this.parseTokenResponse(payload);

      const next: AuthSessionRecord = {
        ...previous,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: this.clock.now() + tokens.expiresIn * 1000,
        generation: previous.generation + 1,
      };

      await this.storage.setItem(
        CAMPUSOPS_SESSION_STORAGE_KEY,
        JSON.stringify(next),
      );

      this.session = next;
      this.state = this.snapshotFor(next);
      return this.getState();
    } catch {
      this.session = null;
      this.state = { status: 'anonymous' };

      try {
        await this.storage.removeItem(CAMPUSOPS_SESSION_STORAGE_KEY);
      } catch {
        throw new Error(
          '[Auth] Falló la renovación y no se pudo limpiar el almacenamiento de sesión.',
        );
      }

      throw new Error(
        '[Auth] La sesión no pudo renovarse. Inicia sesión de nuevo.',
      );
    }
  }

  /**
   * Invalida primero el estado en memoria y luego elimina el registro
   * persistido. Nunca registra credenciales ni incluye secretos en errores.
   */
  async logout(): Promise<void> {
    this.session = null;
    this.state = { status: 'anonymous' };

    try {
      await this.storage.removeItem(CAMPUSOPS_SESSION_STORAGE_KEY);
    } catch {
      throw new Error(
        '[Auth] No se pudo eliminar la sesión del almacenamiento seguro.',
      );
    }
  }

  private async post(
    path: string,
    body: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    let response: Response;

    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error('[Auth] El servicio de autenticación no está disponible.');
    }

    if (!response.ok) {
      throw new Error('[Auth] El servicio rechazó la solicitud.');
    }

    try {
      return await response.json();
    } catch {
      throw new Error('[Auth] El servicio devolvió una respuesta inválida.');
    }
  }

  private parseTokenResponse(
    payload: unknown,
  ): Readonly<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }> {
    if (!isRecord(payload)) {
      throw new Error('invalid_token_response');
    }

    const { accessToken, refreshToken, expiresIn } = payload;

    if (
      !isNonEmptyString(accessToken) ||
      !isNonEmptyString(refreshToken) ||
      typeof expiresIn !== 'number' ||
      !Number.isFinite(expiresIn) ||
      expiresIn <= 0
    ) {
      throw new Error('invalid_token_response');
    }

    return { accessToken, refreshToken, expiresIn };
  }

  private parseStoredSession(raw: string): AuthSessionRecord | null {
    try {
      const value: unknown = JSON.parse(raw);

      if (!isRecord(value)) return null;

      const {
        actorId,
        role,
        accessToken,
        refreshToken,
        expiresAt,
        generation,
      } = value;

      const resolvedRole =
        typeof actorId === 'string' ? roleForActor(actorId) : null;

      if (
        !resolvedRole ||
        role !== resolvedRole ||
        !isNonEmptyString(accessToken) ||
        !isNonEmptyString(refreshToken) ||
        typeof expiresAt !== 'number' ||
        !Number.isFinite(expiresAt) ||
        typeof generation !== 'number' ||
        !Number.isInteger(generation) ||
        generation < 0
      ) {
        return null;
      }

      return {
        actorId: actorId as CampusOpsActorId,
        role: resolvedRole as CampusOpsRole,
        accessToken,
        refreshToken,
        expiresAt,
        generation,
      };
    } catch {
      return null;
    }
  }

  private snapshotFor(session: AuthSessionRecord): SessionSnapshot {
    if (this.clock.now() >= session.expiresAt) {
      return {
        status: 'expired',
        actorId: session.actorId,
        role: session.role,
        expiresAt: session.expiresAt,
        generation: session.generation,
      };
    }

    return {
      status: 'authenticated',
      actorId: session.actorId,
      role: session.role,
      expiresAt: session.expiresAt,
      generation: session.generation,
    };
  }
}


