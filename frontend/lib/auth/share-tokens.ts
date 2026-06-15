/**
 * Shareable-link ids for public file shares.
 *
 * A share id is `<slug>-<nonce>` (e.g. `marigold-demo-story-3k2j9x7qm4p8w1n5t2`), where
 * `slug` is a cosmetic, human-readable prefix from the file name and `nonce` is a random,
 * unguessable, URL-safe key. The nonce is the ONLY secret: it is stored on the target file's
 * `meta.shares[]` and resolved by lookup (DocumentDB.findByShareNonce) — so there is no need
 * for a self-contained signed token. Validation already loads the file and checks the nonce
 * is present and not revoked, which is what authorizes the link (and enables revocation).
 *
 * `nonce` is base36 (chars 0-9a-z only) so it never contains the `-` separator — the id
 * splits unambiguously on its LAST `-`, regardless of how many hyphens the slug has.
 */
import 'server-only';
import crypto from 'crypto';
import { slugify } from '@/lib/slug-utils';

const NONCE_BYTES = 12; // 96 bits — unguessable + collision-free as a global lookup key
const NONCE_RE = /^[0-9a-z]{8,40}$/;

/** Per-link record persisted on `file.meta.shares[]`. */
export interface ShareRecord {
  nonce: string;
  slug: string;
  /** Full `<slug>-<nonce>` id, stored so admins can re-copy the link later. */
  shareableId: string;
  label?: string;
  createdAt: string;
  createdBy: number;
  revoked?: boolean;
}

function generateNonce(): string {
  // base36 of the random bytes → compact, lowercase-alphanumeric, no `-`/`_`.
  return BigInt('0x' + crypto.randomBytes(NONCE_BYTES).toString('hex')).toString(36);
}

/**
 * Create a new share link.
 * Returns the URL-safe `shareableId` (`<slug>-<nonce>`) and the `ShareRecord` to persist.
 */
export function createShareLink(
  name: string,
  createdBy: number,
  label?: string,
): { shareableId: string; record: ShareRecord } {
  const nonce = generateNonce();
  const slug = slugify(name);
  const shareableId = slug ? `${slug}-${nonce}` : nonce;
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
 * Extract the nonce from a `shareableId` (`<slug>-<nonce>`). The nonce is the final segment;
 * the slug is cosmetic and ignored. Returns null for anything that isn't a plausible nonce.
 * NOTE: this does NOT prove the nonce is valid — callers must still resolve it to a live,
 * non-revoked share (DocumentDB.findByShareNonce + isLiveShareNonce).
 */
export function decodeShareLink(shareableId: string): { nonce: string } | null {
  if (!shareableId) return null;
  const i = shareableId.lastIndexOf('-');
  const nonce = i >= 0 ? shareableId.slice(i + 1) : shareableId;
  if (!NONCE_RE.test(nonce)) return null;
  return { nonce };
}

/** True if `nonce` corresponds to a live (non-revoked) share in the given records. */
export function isLiveShareNonce(nonce: string, shares: ShareRecord[] | undefined): boolean {
  if (!shares) return false;
  return shares.some((s) => s.nonce === nonce && !s.revoked);
}
