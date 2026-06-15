/**
 * Shareable-link tokens for public file shares.
 *
 * A share link encodes `{ fileId, nonce }` in a signed JWT (same secret + lib as
 * `lib/auth/otp-utils.ts`). The `nonce` is the per-link revocation key, stored on the
 * file's `meta.shares[]` — decoding only recovers the fileId/nonce; a link is only valid
 * if its nonce is still present (and not revoked) on the target file.
 *
 * URL shape: `<slug>--<jwt>` where `slug` is a cosmetic, human-readable prefix derived
 * from the file name (e.g. `acme-demo-story--<token>`). `slugify` collapses runs of
 * non-alphanumerics to a single hyphen, so it can never emit the `--` sentinel — making
 * the split between slug and token unambiguous.
 */
import 'server-only';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { NEXTAUTH_SECRET } from '@/lib/config';
import { slugify } from '@/lib/slug-utils';

const SHARE_TOKEN_TYPE = 'share' as const;
const SENTINEL = '--';

/** JWT payload for a share link. No `exp` — links live until the nonce is revoked. */
export interface SharePayload {
  fileId: number;
  nonce: string;
  type: typeof SHARE_TOKEN_TYPE;
}

/** Per-link record persisted on `file.meta.shares[]`. */
export interface ShareRecord {
  nonce: string;
  slug: string;
  /** Full `<slug>--<jwt>` id, stored so admins can re-copy the link later. */
  shareableId: string;
  label?: string;
  createdAt: string;
  createdBy: number;
  revoked?: boolean;
}

/**
 * Create a new share link for a file.
 * Returns the URL-safe `shareableId` (`<slug>--<jwt>`) and the `ShareRecord` to persist.
 */
export function createShareLink(
  fileId: number,
  name: string,
  createdBy: number,
  label?: string,
): { shareableId: string; record: ShareRecord } {
  const nonce = crypto.randomBytes(12).toString('base64url');
  const slug = slugify(name);
  const token = jwt.sign(
    { fileId, nonce, type: SHARE_TOKEN_TYPE } satisfies SharePayload,
    NEXTAUTH_SECRET,
  );
  const shareableId = `${slug}${SENTINEL}${token}`;
  const record: ShareRecord = {
    nonce,
    slug,
    shareableId,
    ...(label ? { label } : {}),
    createdAt: new Date().toISOString(),
    createdBy,
  };
  return { shareableId, record };
}

/**
 * Decode a `shareableId` back to `{ fileId, nonce }`.
 * Returns null for any malformed / tampered / wrong-type token.
 * NOTE: this does NOT check the nonce against the file — callers must still validate
 * the nonce is present and not revoked on `file.meta.shares`.
 */
export function decodeShareLink(shareableId: string): { fileId: number; nonce: string } | null {
  const sep = shareableId.indexOf(SENTINEL);
  if (sep < 0) return null;
  const token = shareableId.slice(sep + SENTINEL.length);
  if (!token) return null;
  try {
    const payload = jwt.verify(token, NEXTAUTH_SECRET) as SharePayload;
    if (payload.type !== SHARE_TOKEN_TYPE) return null;
    if (typeof payload.fileId !== 'number' || typeof payload.nonce !== 'string') return null;
    return { fileId: payload.fileId, nonce: payload.nonce };
  } catch {
    return null;
  }
}

/** True if `nonce` corresponds to a live (non-revoked) share in the given records. */
export function isLiveShareNonce(nonce: string, shares: ShareRecord[] | undefined): boolean {
  if (!shares) return false;
  return shares.some((s) => s.nonce === nonce && !s.revoked);
}
