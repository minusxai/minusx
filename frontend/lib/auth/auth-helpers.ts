import { auth } from '@/auth';
import { UserDB } from '../database/user-db';
import { cache } from 'react';
import { headers, cookies } from 'next/headers';
import { GUEST_COOKIE, verifyGuestToken, guestToEffectiveUser, isShareGuestPath } from './guest-session';
import { UserRole } from '../types';
import { isAdmin } from './role-helpers';
import { CURRENT_TOKEN_VERSION, TOKEN_REFRESH_THRESHOLD } from './auth-constants';
import { Mode, DEFAULT_MODE, isValidMode } from '@/lib/mode/mode-types';
import { View, DEFAULT_VIEW, isValidView } from '@/lib/view/view-types';

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
  // Optional: only the HTTP request builders populate it (from the x-view header);
  // background builders (MCP/Slack) and tests omit it → treated as 'full'.
  view?: View;
  // Present only for anonymous public-share guests (no NextAuth session). Downstream
  // file/query access treats a guest as a normal folder-scoped viewer; only the chat
  // routes special-case it (gate on `canChat` + SHARE_GUEST_CHAT_ENABLED).
  guest?: { canChat: boolean; shareFileId: number; nonce: string };
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
 * Get the current view from request headers (chrome-stripping for embedding).
 */
export const getView = cache(async (): Promise<View> => {
  const headersList = await headers();
  const viewHeader = headersList.get('x-view');
  if (viewHeader && isValidView(viewHeader)) {
    return viewHeader as View;
  }
  return DEFAULT_VIEW;
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
  const view = await getView();
  const session = await auth();

  if (!session?.user) {
    // No NextAuth session: fall back to an anonymous public-share guest, but ONLY on the
    // share pages + the APIs they call (isShareGuestPath). The guest's scope (folder + mode
    // + role) comes ONLY from the verified cookie — x-mode / x-impersonate-user are ignored,
    // so there is no escalation path, and the cookie never authorizes the main app UI.
    if (!isShareGuestPath(headersList.get('x-request-path'))) return null;
    const guestToken = (await cookies()).get(GUEST_COOKIE)?.value;
    const guest = verifyGuestToken(guestToken);
    return guest ? guestToEffectiveUser(guest) : null;
  }

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
          view,
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
    view,
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
    view: DEFAULT_VIEW,
  };
}
