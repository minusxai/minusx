import { EffectiveUser } from '@/lib/auth/auth-helpers';
import { ShareRecord, CreateShareResult } from './types';

/**
 * Shared interface for the shares data layer (public share links for stories).
 * Both server and client implementations must conform to this interface.
 *
 * Server: Direct database access, enforcing admin + story-type guards.
 * Client: HTTP calls to `/api/files/[id]/share`.
 */
export interface ISharesDataLayer {
  /**
   * List the share records for a story (admin-only).
   */
  listShares(fileId: number, user: EffectiveUser): Promise<ShareRecord[]>;

  /**
   * Mint a new public share link for a story and persist its record (admin-only).
   */
  createShare(fileId: number, user: EffectiveUser, label?: string): Promise<CreateShareResult>;

  /**
   * Soft-revoke a share link by nonce (admin-only).
   * Returns true if a live link was revoked.
   */
  revokeShare(fileId: number, nonce: string, user: EffectiveUser): Promise<boolean>;
}
