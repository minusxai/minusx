import { EffectiveUser } from '@/lib/auth/auth-helpers';
import { ISharesDataLayer } from './shares.interface';
import { ShareRecord, CreateShareResult } from './types';

const API_BASE = '';  // Same origin

async function unwrap<T>(res: Response): Promise<T> {
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || json?.error || `Request failed: ${res.status}`);
  return json.data as T;
}

/**
 * Client-side implementation of the shares data layer.
 * HTTP calls to `/api/files/[id]/share` — all authorization (admin + story-only) is
 * enforced server-side.
 *
 * Note: user parameter is ignored on client - auth is handled by API routes
 */
class SharesDataLayerClient implements ISharesDataLayer {
  async listShares(fileId: number, user?: EffectiveUser): Promise<ShareRecord[]> {
    const res = await fetch(`${API_BASE}/api/files/${fileId}/share`);
    return (await unwrap<{ shares: ShareRecord[] }>(res)).shares;
  }

  async createShare(fileId: number, user?: EffectiveUser, label?: string): Promise<CreateShareResult> {
    const res = await fetch(`${API_BASE}/api/files/${fileId}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label }),
    });
    return unwrap<CreateShareResult>(res);
  }

  async revokeShare(fileId: number, nonce: string, user?: EffectiveUser): Promise<boolean> {
    const res = await fetch(`${API_BASE}/api/files/${fileId}/share?nonce=${encodeURIComponent(nonce)}`, {
      method: 'DELETE',
    });
    return (await unwrap<{ revoked: boolean }>(res)).revoked;
  }
}

/**
 * Singleton instance for client-side shares
 */
export const SharesAPI = new SharesDataLayerClient();
