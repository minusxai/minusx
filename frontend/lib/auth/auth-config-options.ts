import type { JWT } from 'next-auth/jwt';

export interface AuthUserRow {
  id: number;
  email: string;
  name: string;
  role: string;
  home_folder: string;
  password_hash: string | null;
}

export interface AuthConfigOptions {
  /** Override user lookup at login time. Defaults to UserDB.getByEmail. */
  lookupUserByEmail?: (email: string) => Promise<AuthUserRow | null>;
  /** Return extra fields to merge into the authorize() result (propagated to JWT). */
  mapAuthorizeResult?: (row: AuthUserRow) => Record<string, unknown>;
  /** Override token refresh. Return { home_folder, role } or null to skip. */
  refreshUserToken?: (token: JWT) => Promise<{ home_folder: string; role: string } | null>;
  /** Return extra fields to merge into session.user from the JWT. */
  extraSessionFields?: (token: JWT) => Record<string, unknown>;
}
