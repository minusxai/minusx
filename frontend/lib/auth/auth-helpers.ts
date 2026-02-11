import { auth } from '@/auth';
import { UserDB } from '../database/user-db';
import { CompanyDB } from '../database/company-db';
import { AccessTokenDB } from '../database/documents-db';
import { cache } from 'react';
import { headers } from 'next/headers';
import { UserRole } from '../types';
import { isAdmin } from './role-helpers';
import { CURRENT_TOKEN_VERSION, TOKEN_REFRESH_THRESHOLD } from './auth-constants';
import { Mode, DEFAULT_MODE, isValidMode } from '@/lib/mode/mode-types';

/**
 * Check if a token should be refreshed based on age
 * Future: Can be used to trigger token refresh in middleware
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
 * Matches the structure returned by getEffectiveUser()
 */
export interface EffectiveUser {
  userId: number;  // Required - every authenticated user has an ID
  email: string;
  name: string;
  role: UserRole;
  home_folder: string;
  companyId: number;  // Required - enforced by withAuth middleware
  companyName?: string;
  mode: Mode;  // Current mode for file system isolation
}

/**
 * Get the current mode from request headers
 * Returns mode from x-mode header (set by middleware), or default
 * Wrapped with React cache() for request-level memoization
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
 * Use this in Server Components and API routes
 */
export async function getServerSession() {
  return await auth();
}

/**
 * Get the effective company ID from the session
 * Returns the company ID for data isolation
 */
export async function getEffectiveCompanyId(): Promise<number | null> {
  const session = await auth();

  if (!session?.user) {
    return null;
  }

  return session.user.companyId || null;
}

/**
 * Get effective user from a public access token
 * Used for unauthenticated file access via /t/{token} routes
 *
 * @param tokenString - The access token UUID
 * @returns EffectiveUser or null if token is invalid
 */
export async function getEffectiveUserFromToken(tokenString: string): Promise<EffectiveUser | null> {
  // Load token from database
  const token = await AccessTokenDB.getByToken(tokenString);

  if (!token) {
    return null;
  }

  // Validate token (active and not expired)
  const validation = AccessTokenDB.validateToken(token);
  if (!validation.isValid) {
    return null;
  }

  // Get current mode
  const mode = await getMode();

  // Load the view_as_user
  try {
    const user = await UserDB.getById(token.view_as_user_id, token.company_id);
    if (!user) {
      return null;
    }

    // Load company name
    const company = await CompanyDB.getById(token.company_id);

    return {
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      home_folder: user.home_folder,
      companyId: token.company_id,
      companyName: company?.name,
      mode,
    };
  } catch (error) {
    console.error('[Auth] Error loading user from token:', error);
    return null;
  }
}

/**
 * Get the effective user (token-based, impersonated, or actual)
 * Returns the user that should be used for access control
 *
 * Order of precedence:
 * 1. Public access token (x-public-access-token header)
 * 2. Admin impersonation (x-impersonate-user header)
 * 3. Authenticated session user
 *
 * Wrapped with React cache() for request-level memoization
 * - Multiple calls in same request return cached result
 * - All data comes from JWT session (no database queries!) except for impersonation/tokens
 */
export const getEffectiveUser = cache(async (): Promise<EffectiveUser | null> => {
  const headersList = await headers();

  // Get current mode (needed for all user types)
  const mode = await getMode();

  // PRIORITY 1: Check for public access token (no authentication required)
  const publicAccessToken = headersList.get('x-public-access-token');
  if (publicAccessToken) {
    return getEffectiveUserFromToken(publicAccessToken);
  }

  // PRIORITY 2 & 3: Session-based authentication
  const session = await auth();

  if (!session?.user) {
    return null;
  }

  // Read impersonation from header (set by middleware based on URL parameter)
  const asUserEmail = headersList.get('x-impersonate-user');

  if (asUserEmail) {
    // Validate admin status (double-check, middleware already validated)
    if (!isAdmin(session.user.role || 'viewer')) {
      console.warn('[Auth] Non-admin attempted impersonation:', {
        actualUser: session.user.email,
        attemptedAsUser: asUserEmail
      });
      // Fall through to return actual user
    } else if (session.user.companyId) {
      // Admin is impersonating - fetch the impersonated user's details
      // NOTE: This is the ONLY case that requires a database query
      try {
        const impersonatedUser = await UserDB.getByEmailAndCompany(
          asUserEmail,
          session.user.companyId
        );

        if (impersonatedUser) {
          // Admin can only impersonate users in their own company (enforced by query above)
          // Therefore impersonatedUser.company_id === session.user.companyId
          // Use admin's companyName from JWT token (already in memory, zero DB cost)
          return {
            userId: impersonatedUser.id,
            email: impersonatedUser.email,
            name: impersonatedUser.name,
            role: impersonatedUser.role,
            home_folder: impersonatedUser.home_folder,
            companyId: impersonatedUser.company_id,
            companyName: session.user.companyName,  // From JWT - no DB query needed!
            mode,
          };
        } else {
          console.warn('[Auth] Impersonated user not found:', asUserEmail);
        }
      } catch (error) {
        console.error('[Auth] Error fetching impersonated user:', error);
      }
    }
  }

  // Return actual user - all data from JWT session (fast!)

  // Token version validation - force logout if outdated
  if (isTokenOutdated(session.user.tokenVersion)) {
    console.warn('[Auth] Old token version detected - forcing re-login:', {
      tokenVersion: session.user.tokenVersion,
      currentVersion: CURRENT_TOKEN_VERSION,
      email: session.user.email
    });
    return null;  // Force logout - user must re-authenticate with new token schema
  }

  return {
    userId: session.user.userId,
    email: session.user.email as string,
    name: session.user.name as string,
    role: session.user.role || 'viewer',
    home_folder: session.user.home_folder,
    companyId: session.user.companyId,
    companyName: session.user.companyName,
    mode,
  };
});
