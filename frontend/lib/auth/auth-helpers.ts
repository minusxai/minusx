import { auth } from '@/auth';
import { UserDB } from '../database/user-db';
import { cache } from 'react';
import { headers } from 'next/headers';
import { UserRole } from '../types';
import { isAdmin } from './role-helpers';
import { CURRENT_TOKEN_VERSION, TOKEN_REFRESH_THRESHOLD } from './auth-constants';
import { Mode, DEFAULT_MODE, isValidMode } from '@/lib/mode/mode-types';

/**
 * Check if a token should be refreshed based on age
 */
export function shouldRefreshToken(createdAt?: number): boolean {
  if (!createdAt) return false;
  const age = Math.floor(Date.now() / 1000) - createdAt;
  return age > TOKEN_REFRESH_THRESHOLD;
}

/**
 * Check if token version is outdated
 */
export function isTokenOutdated(tokenVersion?: number): boolean {
  return !tokenVersion || tokenVersion < CURRENT_TOKEN_VERSION;
}

/**
 * Effective user type - represents the authenticated user for API routes
 */
export interface EffectiveUser {
  userId: number;
  email: string;
  name: string;
  role: UserRole;
  home_folder: string;
  mode: Mode;
}

/**
 * Get the current mode from request headers
 */
export const getMode = cache(async (): Promise<Mode> => {
  const headersList = await headers();
  const modeHeader = headersList.get('x-mode');
  if (modeHeader && isValidMode(modeHeader)) {
    return modeHeader as Mode;
  }
  return DEFAULT_MODE;
});

/**
 * Get the current session (wrapper around auth())
 */
export async function getServerSession() {
  return await auth();
}

/**
 * Get the effective user (impersonated or actual session user).
 * Wrapped with React cache() for request-level memoization.
 */
export const getEffectiveUser = cache(async (): Promise<EffectiveUser | null> => {
  const headersList = await headers();
  const mode = await getMode();
  const session = await auth();

  if (!session?.user) return null;

  const asUserEmail = headersList.get('x-impersonate-user');
  if (asUserEmail && isAdmin(session.user.role || 'viewer')) {
    try {
      const impersonatedUser = await UserDB.getByEmail(asUserEmail);
      if (impersonatedUser) {
        return {
          userId: impersonatedUser.id,
          email: impersonatedUser.email,
          name: impersonatedUser.name,
          role: impersonatedUser.role,
          home_folder: impersonatedUser.home_folder,
          mode,
        };
      }
    } catch (error) {
      console.error('[Auth] Error fetching impersonated user:', error);
    }
  }

  if (isTokenOutdated(session.user.tokenVersion)) {
    console.warn('[Auth] Old token version detected - forcing re-login');
    return null;
  }

  return {
    userId: session.user.userId,
    email: session.user.email as string,
    name: session.user.name as string,
    role: session.user.role || 'viewer',
    home_folder: session.user.home_folder,
    mode,
  };
});

/**
 * Look up a user by email and build an EffectiveUser.
 * Used by background integrations (e.g. Slack bot) that have no HTTP session.
 */
export async function getUserEffectiveUser(
  email: string,
  mode: Mode,
): Promise<EffectiveUser | null> {
  const user = await UserDB.getByEmail(email);
  if (!user) return null;
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    home_folder: user.home_folder,
    mode,
  };
}
