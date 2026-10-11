/**
 * Tipos de dominio para autenticación, autorización y ciclo de vida de sesión en CampusOps.
 */

export type CampusOpsRole = 'reporter' | 'technician' | 'coordinator';

export type SessionStatus = 'anonymous' | 'authenticated';

export interface AuthSession {
  readonly actorId: string;
  readonly role: CampusOpsRole;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
  readonly generation: number;
}

export type IncidentAction =
  | 'assign'
  | 'prioritize'
  | 'start'
  | 'resolve'
  | 'close'
  | 'reopen'
  | 'comment'
  | 'add_evidence';

export interface SessionCoordinatorSummary {
  readonly status: SessionStatus;
  readonly activeGeneration: number | null;
  readonly refreshCalls: number;
  readonly retriedRequestIds: readonly string[];
  readonly persistedToken: string | null;
}
