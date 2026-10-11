import type { CampusOpsActorId, CampusOpsRole } from './role-authorization';

export type SessionStatus =
  | 'anonymous'
  | 'authenticated'
  | 'refreshing'
  | 'expired';

export type SessionSnapshot =
  | Readonly<{ status: 'anonymous' }>
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
