import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { UserDB } from '@/lib/database/user-db';
import { verifyPassword } from '@/lib/auth/password-utils';
import { verifyVerifiedToken } from '@/lib/auth/otp-utils';
import { IS_DEV } from '@/lib/constants';
import type { UserRole } from '@/lib/types';
import { isAdmin } from '@/lib/auth/role-helpers';
import { ADMIN_PWD } from '@/lib/config';
import { CURRENT_TOKEN_VERSION } from '@/lib/auth/auth-constants';
import { appEventRegistry } from '@/lib/app-event-registry/registry';
import { AppEvents } from '@/lib/app-event-registry/events';
import type { JWT } from 'next-auth/jwt';
import { immutableSet } from '@/lib/utils/immutable-collections';
import { isModulesRegistered, getModules } from '@/lib/modules/registry';
import type { AuthConfigOptions } from '@/lib/auth/auth-config-options';
export type { AuthUserRow, AuthConfigOptions } from '@/lib/auth/auth-config-options';

// Fields set explicitly on the JWT — extra fields from mapAuthorizeResult are copied automatically
const BASE_USER_KEYS = immutableSet(['id', 'userId', 'email', 'name', 'role', 'home_folder']);

const getModuleHooks = (): Partial<AuthConfigOptions> =>
  isModulesRegistered() ? (getModules().auth.getAuthHooks?.() ?? {}) : {};

export function createAuthConfig(options: AuthConfigOptions = {}) {
  const doLookup = (email: string) => {
    const fn = options.lookupUserByEmail ?? getModuleHooks().lookupUserByEmail;
    return fn ? fn(email) : UserDB.getByEmail(email);
  };

  const doRefresh = (token: JWT) => {
    const fn = options.refreshUserToken ?? getModuleHooks().refreshUserToken;
    if (fn) return fn(token);
    if (!token.userId) return Promise.resolve(null);
    return UserDB.getById(token.userId as number).then(u =>
      u ? { home_folder: u.home_folder, role: u.role as string } : null,
    );
  };

  return NextAuth({
    providers: [
      Credentials({
        credentials: {
          email: { label: 'Email', type: 'email' },
          password: { label: 'Password', type: 'password' },
          otp_verified_token: { label: 'OTP Verified Token', type: 'text' },
        },
        async authorize(credentials) {
          if (!credentials?.email) return null;
          try {
            const user = await doLookup(credentials.email as string);
            if (!user) {
              console.log('User not found:', credentials.email);
              return null;
            }
            if (credentials.otp_verified_token && !credentials.password) {
              const payload = verifyVerifiedToken(credentials.otp_verified_token as string);
              if (!payload || payload.email !== credentials.email) {
                console.log('Invalid or mismatched OTP verified token for:', credentials.email);
                return null;
              }
              console.log('User logged in via email OTP (passwordless):', credentials.email);
            } else {
              if (!credentials.password) return null;
              if (IS_DEV && credentials.password === user.email) {
                console.log('⚠️  Dev mode: User logged in using email as password');
              } else if (isAdmin(user.role as UserRole) && ADMIN_PWD && credentials.password === ADMIN_PWD) {
                console.log('⚠️  Prod mode: Admin logged in using ADMIN_PWD');
              } else if (!user.password_hash) {
                return null;
              } else {
                const isValid = await verifyPassword(credentials.password as string, user.password_hash);
                if (!isValid) {
                  console.log('Invalid password for user:', credentials.email);
                  return null;
                }
              }
            }
            return {
              id: user.email,
              userId: user.id,
              email: user.email,
              name: user.name,
              role: user.role as UserRole,
              home_folder: user.home_folder,
              ...((options.mapAuthorizeResult ?? getModuleHooks().mapAuthorizeResult)?.(user) ?? {}),
            };
          } catch (error) {
            console.error('Auth error:', error);
            return null;
          }
        },
      }),
    ],
    session: {
      strategy: 'jwt',
      maxAge: 7 * 24 * 60 * 60,
    },
    callbacks: {
      async jwt({ token, user, trigger, session }) {
        if (user) {
          token.userId = user.userId;
          token.email = user.email;
          token.name = user.name;
          token.role = user.role;
          token.home_folder = user.home_folder;
          token.tokenVersion = CURRENT_TOKEN_VERSION;
          token.createdAt = Math.floor(Date.now() / 1000);

          // Copy any extra fields from authorize() result to token
          for (const [k, v] of Object.entries(user as unknown as Record<string, unknown>)) {
            if (!BASE_USER_KEYS.has(k)) token[k] = v;
          }

          appEventRegistry.publish(AppEvents.USER_LOGGED_IN, {
            mode: 'org',
            userId: user.userId as number,
            userEmail: user.email as string,
            role: user.role as string,
          });
        }

        if (trigger === 'update' && session?.refreshToken && token.userId) {
          try {
            console.log('[Auth] Refreshing old token to latest version');
            const freshData = await doRefresh(token);
            if (freshData) {
              token.home_folder = freshData.home_folder;
              token.role = freshData.role as UserRole;
              token.tokenVersion = CURRENT_TOKEN_VERSION;
              token.createdAt = Math.floor(Date.now() / 1000);
              console.log('[Auth] Token refreshed successfully');
            }
          } catch (error) {
            console.error('[Auth] Failed to refresh token:', error);
          }
        }

        return token;
      },
      async session({ session, token }) {
        if (token && session.user) {
          session.user.userId = token.userId as number;
          session.user.email = token.email as string;
          session.user.name = token.name as string;
          session.user.role = token.role as UserRole | undefined;
          session.user.home_folder = token.home_folder as string;
          session.user.tokenVersion = token.tokenVersion as number | undefined;
          session.user.createdAt = token.createdAt as number | undefined;

          const doExtraSessionFields = options.extraSessionFields ?? getModuleHooks().extraSessionFields;
          if (doExtraSessionFields) {
            Object.assign(session.user as unknown as Record<string, unknown>, doExtraSessionFields(token));
          }
        }
        return session;
      },
    },
    pages: {
      signIn: '/login',
    },
    trustHost: true,
  });
}
