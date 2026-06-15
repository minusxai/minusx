/**
 * Anonymous guest sessions for public story shares.
 *
 * A guest session is a signed `mx-guest` JWT cookie that lets an unauthenticated
 * visitor of a public `/l/<shareId>` page act as a `viewer` EffectiveUser pinned to
 * the shared story's folder — so the existing file/query/chat stack works unchanged,
 * confined by `canAccessFile` to exactly that folder (see lib/data/helpers/permissions.ts).
 *
 * The token is the ONLY source of scope: `getEffectiveUser` builds the guest user purely
 * from it and ignores `x-mode` / `x-impersonate-user`, so there is no privilege-escalation
 * path. Viewing always works; chatting is gated by `canChat` (server-enforced in the chat
 * routes) which only flips true once a name/email is captured or `?skip_lead` is used.
 */
import 'server-only';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { NEXTAUTH_SECRET } from '@/lib/config';
import { Mode } from '@/lib/mode/mode-types';
import { extractLogicalPath } from '@/lib/mode/path-resolver';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

export const GUEST_COOKIE = 'mx-guest';
/** Short TTL: a leaked link grants at most a day of access. */
export const GUEST_TTL_SECONDS = 24 * 60 * 60;

/**
 * Paths on which the anonymous guest cookie is honored. A share guest may only:
 *  - load the `/l/<id>` share page itself, and
 *  - call the data/chat APIs that page needs (all further confined by canAccessFile /
 *    role / canChat downstream).
 * On every other route (the main app pages — `/`, `/home`, `/explore`, `/f/...`, etc.)
 * the guest cookie is ignored, so a share link never logs the visitor into the app UI.
 */
export function isShareGuestPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return pathname.startsWith('/l/') || pathname.startsWith('/api/');
}

export interface GuestSessionPayload {
  scope: 'share';
  fileId: number;
  nonce: string;
  /** Relative home folder (e.g. 'demos/acme'), resolved with `mode` at access time. */
  home_folder: string;
  mode: Mode;
  /** Stable negative synthetic user id — isolates the guest's conversation folder. */
  uid: number;
  name: string;
  email: string;
  canChat: boolean;
  exp: number;
}

/**
 * Derive a stable negative synthetic user id from the share nonce + guest email.
 * Negative + nonce-scoped so different shares (and different guests of one share)
 * get isolated `/logs/conversations/{uid}` folders and never collide with real
 * positive ids or the cron `-1` user.
 */
export function deriveGuestUid(nonce: string, email: string): number {
  const hash = crypto.createHash('sha256').update(`${nonce}:${email}`).digest();
  // 6 bytes → up to ~2.8e14, comfortably inside JS safe-integer range.
  const n = hash.readUIntBE(0, 6);
  return -(1_000_000 + n);
}

/**
 * Convert a story's physical path + mode into the relative `home_folder` a guest is
 * pinned to (the story's containing folder). e.g. ('/org/demos/acme/story', 'org')
 * → 'demos/acme'.
 */
export function storyHomeFolder(physicalPath: string, mode: Mode): string {
  const logical = extractLogicalPath(physicalPath); // '/demos/acme/story'
  const parent = logical.slice(0, logical.lastIndexOf('/')); // '/demos/acme'
  return parent.replace(/^\/+/, ''); // 'demos/acme'
}

export function createGuestToken(payload: Omit<GuestSessionPayload, 'exp' | 'scope'>): string {
  const exp = Math.floor(Date.now() / 1000) + GUEST_TTL_SECONDS;
  return jwt.sign({ ...payload, scope: 'share', exp } satisfies GuestSessionPayload, NEXTAUTH_SECRET);
}

export function verifyGuestToken(token: string | undefined | null): GuestSessionPayload | null {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, NEXTAUTH_SECRET) as GuestSessionPayload;
    if (payload.scope !== 'share') return null;
    if (typeof payload.fileId !== 'number' || typeof payload.uid !== 'number') return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Reason a guest may NOT chat, or null if allowed. Non-guests are always allowed (null).
 * Enforced server-side by both chat routes so the name/email gate isn't just client-side.
 */
export function guestChatDenialReason(
  user: EffectiveUser,
  chatEnabled: boolean,
): string | null {
  if (!user.guest) return null;
  if (!chatEnabled) return 'Chat is not available for shared links.';
  if (!user.guest.canChat) return 'Enter your name and email to ask questions.';
  return null;
}

/** Build the EffectiveUser for a guest session — a viewer pinned to the share's folder. */
export function guestToEffectiveUser(payload: GuestSessionPayload): EffectiveUser {
  return {
    userId: payload.uid,
    email: payload.email,
    name: payload.name,
    role: 'viewer',
    home_folder: payload.home_folder,
    mode: payload.mode,
    guest: { canChat: payload.canChat, shareFileId: payload.fileId, nonce: payload.nonce },
  };
}
