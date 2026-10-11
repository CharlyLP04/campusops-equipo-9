import type {
  CampusOpsActorId,
  CampusOpsRole,
  IncidentAction,
} from './role-authorization';

export type {
  CampusOpsActorId,
  CampusOpsRole,
  IncidentAction,
};

export type SessionStatus =
  | 'anonymous'
  | 'authenticated'
  | 'refreshing'
  | 'expired';

export type SessionSnapshot =
  | Readonly<{
      status: 'anonymous';
    }>
  | Readonly<{
      status: 'authenticated' | 'refreshing' | 'expired';
      actorId: CampusOpsActorId;
      role: CampusOpsRole;
      expiresAt: number;
      generation: number;
    }>;

export type AuthSessionRecord = Readonly<{
  actorId: CampusOpsActorId;
  role: CampusOpsRole;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  generation: number;
}>;

export type SessionClock = Readonly<{
  now: () => number;
}>;

export interface AuthSession {
  readonly actorId: string;
  readonly role: CampusOpsRole;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
  readonly generation: number;
}

export interface SessionCoordinatorSummary {
  readonly status: 'anonymous' | 'authenticated';
  readonly activeGeneration: number | null;
  readonly refreshCalls: number;
  readonly retriedRequestIds: readonly string[];
  readonly persistedToken: string | null;
}