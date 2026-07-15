import 'server-only';
import { EffectiveUser } from '@/lib/auth/auth-helpers';
import { ISharesDataLayer } from './shares.interface';
import { ShareRecord, CreateShareResult } from './types';
import { DocumentDB } from '@/lib/database/documents-db';
import { DbFile } from '@/lib/types';
import { canAccessFile } from '@/lib/data/helpers/permissions';
import { resolveAccessPredicateWithGroups } from '@/lib/auth/access-resolver';
import { checkAccess } from '@/lib/auth/access-predicate';
import { createShareLink, decodeShareLink, isLiveShareNonce } from '@/lib/auth/share-tokens';
import { UserFacingError, AccessPermissionError, FileNotFoundError } from '@/lib/errors';
import { isAdmin } from '@/lib/auth/role-helpers';
import { getConfigs } from '@/lib/data/configs.server';
import type { AccessRulesOverride } from '@/lib/branding/whitelabel';

/**
 * Server-side implementation of the shares data layer.
 * Direct database access with admin + story-type guards.
 */
class SharesDataLayerServer implements ISharesDataLayer {
  /**
   * Load access rules overrides from org config (cached per-org by configs layer)
   */
  private async _getOverrides(user: EffectiveUser): Promise<AccessRulesOverride | undefined> {
    try {
      const { config } = await getConfigs(user);
      return config.accessRules;
    } catch {
      return undefined;
    }
  }

  /**
   * Load the file behind a share-management operation and enforce the share guards:
   * admin role, regular access, and `story` type (shares are story-only in v1).
   */
  private async _loadStoryForShareAdmin(fileId: number, user: EffectiveUser): Promise<DbFile> {
    const file = await DocumentDB.getById(fileId);
    if (!file) throw new FileNotFoundError(fileId);
    if (!isAdmin(user.role)) {
      throw new AccessPermissionError('Only admins can manage share links');
    }
    const overrides = await this._getOverrides(user);
    if (!canAccessFile(file, user, overrides)) {
      throw new AccessPermissionError('You do not have permission to access this file');
    }
    if (file.type !== 'story') {
      throw new UserFacingError('Only stories can be shared publicly');
    }
    return file;
  }

  private _readShares(file: DbFile): ShareRecord[] {
    const shares = (file.meta as { shares?: ShareRecord[] } | null)?.shares;
    return Array.isArray(shares) ? shares : [];
  }

  private async _writeShares(file: DbFile, shares: ShareRecord[]): Promise<void> {
    await DocumentDB.updateMeta(file.id, { ...(file.meta ?? {}), shares });
  }

  /** List the share records for a story (admin-only). */
  async listShares(fileId: number, user: EffectiveUser): Promise<ShareRecord[]> {
    const file = await this._loadStoryForShareAdmin(fileId, user);
    return this._readShares(file);
  }

  /** Mint a new public share link for a story and persist its record (admin-only). */
  async createShare(fileId: number, user: EffectiveUser, label?: string): Promise<CreateShareResult> {
    const file = await this._loadStoryForShareAdmin(fileId, user);
    const { shareableId, record } = createShareLink(file.name, user.userId, label);
    await this._writeShares(file, [...this._readShares(file), record]);
    return { shareableId, path: `/l/${shareableId}`, record };
  }

  /** Soft-revoke a share link by nonce (admin-only). Returns true if a live link was revoked. */
  async revokeShare(fileId: number, nonce: string, user: EffectiveUser): Promise<boolean> {
    const file = await this._loadStoryForShareAdmin(fileId, user);
    const shares = this._readShares(file);
    let revoked = false;
    const next = shares.map((s) => {
      if (s.nonce === nonce && !s.revoked) {
        revoked = true;
        return { ...s, revoked: true };
      }
      return s;
    });
    if (revoked) await this._writeShares(file, next);
    return revoked;
  }

  /**
   * Resolve a public `shareableId` to its story file, acting as the share authority
   * (no user — the signed token + live nonce ARE the authorization). Returns null for
   * any invalid / tampered / revoked / non-story share. Used by the guest-session mint
   * route and the public `/l/<id>` page.
   *
   * Server-only capability — deliberately not part of `ISharesDataLayer`: it's never called
   * from the browser (no route exposes a raw file lookup by share token), only from other
   * server-side code that already imports this module directly.
   */
  async resolveShare(shareableId: string): Promise<{ file: DbFile; nonce: string } | null> {
    const decoded = decodeShareLink(shareableId);
    if (!decoded) return null;
    const file = await DocumentDB.findByShareNonce(decoded.nonce);
    if (!file || file.type !== 'story') return null;
    if (!isLiveShareNonce(decoded.nonce, this._readShares(file))) return null;
    return { file, nonce: decoded.nonce };
  }

  /**
   * Persist the object-store KEY of a story's composed OG share card on `meta.preview`
   * (a derived artifact, like `meta.shares` — kept out of the agent-authored content). The
   * public `/l/<id>/opengraph-image` route reads the bytes back by this key. Any user who
   * can access the story may set it (it's a render of what they already see).
   *
   * Server-only capability — deliberately not part of `ISharesDataLayer`: the client never
   * calls this directly, it POSTs a screenshot to `/api/files/[id]/preview`, which composes
   * the image (unrelated image-generation concerns) and then calls this to persist the key.
   */
  async setStoryPreview(fileId: number, user: EffectiveUser, key: string): Promise<void> {
    const file = await DocumentDB.getById(fileId);
    if (!file) throw new FileNotFoundError(fileId);
    const overrides = await this._getOverrides(user);
    // Group-aware: a user who can open a story via a group grant can also
    // persist its preview image.
    const predicate = await resolveAccessPredicateWithGroups(user, overrides);
    if (!checkAccess(file, predicate, 'access')) {
      throw new AccessPermissionError('You do not have permission to access this file');
    }
    if (file.type !== 'story') throw new UserFacingError('Only stories have preview images');
    await DocumentDB.updateMeta(fileId, { ...(file.meta ?? {}), preview: { key, version: file.updated_at } });
  }
}

/**
 * Singleton instance for server-side shares
 */
export const SharesAPI = new SharesDataLayerServer();
