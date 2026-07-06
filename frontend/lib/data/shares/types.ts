/**
 * Shared types for the shares module (public share links for stories).
 * Used by both server and client implementations.
 */

import type { ShareRecord } from '@/lib/auth/share-tokens';

export type { ShareRecord };

/**
 * Result of minting a new share link.
 */
export interface CreateShareResult {
  shareableId: string;
  /** Relative path; compose the absolute URL with the current origin. */
  path: string;
  record: ShareRecord;
}
