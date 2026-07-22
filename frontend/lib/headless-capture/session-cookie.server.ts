/**
 * Mint a short-lived NextAuth session cookie for the headless capture browser (Story_Design_V2 §6c).
 *
 * AUTH REQUIREMENT (documented per §6c): the story page (`/f/[id]`) is behind interactive login —
 * there is no anonymous story route (`/l/[shareId]` exists only for explicitly-shared stories).
 * Instead of driving the login form, the capture backend authenticates the way NextAuth itself
 * does: it encodes a session JWT with the same secret/salt NextAuth uses (`next-auth/jwt`
 * `encode`, salt = cookie name, secret = NEXTAUTH_SECRET — next-auth v5 resolves
 * `AUTH_SECRET ?? NEXTAUTH_SECRET`, and this repo configures NEXTAUTH_SECRET) and plants it as
 * the session cookie before navigation. The token carries the exact fields the `jwt` callback
 * sets at login (`lib/auth/auth-factory.ts`), including `tokenVersion` so
 * `getEffectiveUser`'s outdated-token guard passes. Server-only; the secret never leaves the
 * process — the cookie is handed straight to the same-container browser context.
 *
 * Cookie name: `authjs.session-token`, `__Secure-`-prefixed for https base URLs (matching
 * NextAuth's secure-cookie default; see `buildEmbedCookieConfig` for the same convention).
 */
import 'server-only';
import { encode } from 'next-auth/jwt';
import { NEXTAUTH_SECRET } from '@/lib/config';
import { CURRENT_TOKEN_VERSION } from '@/lib/auth/auth-constants';
import { UserDB } from '@/lib/database/user-db';

/** Short-lived: the cookie only needs to survive one page load. */
const SESSION_COOKIE_MAX_AGE_S = 5 * 60;

export interface MintedSessionCookie {
  name: string;
  value: string;
}

/** Session cookie for `userEmail`, or null when the user doesn't exist. */
export async function mintSessionCookie(
  userEmail: string,
  baseUrl: string,
): Promise<MintedSessionCookie | null> {
  const user = await UserDB.getByEmail(userEmail);
  if (!user) return null;
  const secure = baseUrl.startsWith('https://');
  const name = `${secure ? '__Secure-' : ''}authjs.session-token`;
  const value = await encode({
    token: {
      sub: user.email,
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      home_folder: user.home_folder,
      tokenVersion: CURRENT_TOKEN_VERSION,
      createdAt: Math.floor(Date.now() / 1000),
    },
    secret: NEXTAUTH_SECRET,
    salt: name,
    maxAge: SESSION_COOKIE_MAX_AGE_S,
  });
  return { name, value };
}
