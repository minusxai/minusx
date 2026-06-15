/**
 * Client wrappers for the admin share-link API (`/api/files/[id]/share`).
 * Thin fetch helpers — all authorization (admin + story-only) is enforced server-side.
 */
import type { ShareRecord } from '@/lib/auth/share-tokens';

async function unwrap<T>(res: Response): Promise<T> {
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || json?.error || `Request failed: ${res.status}`);
  return json.data as T;
}

export interface CreatedShareLink {
  shareableId: string;
  /** Relative path; compose the absolute URL with the current origin. */
  path: string;
  record: ShareRecord;
}

export async function createShareLink(fileId: number, label?: string): Promise<CreatedShareLink> {
  const res = await fetch(`/api/files/${fileId}/share`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label }),
  });
  return unwrap<CreatedShareLink>(res);
}

export async function listShareLinks(fileId: number): Promise<ShareRecord[]> {
  const res = await fetch(`/api/files/${fileId}/share`);
  return (await unwrap<{ shares: ShareRecord[] }>(res)).shares;
}

export async function revokeShareLink(fileId: number, nonce: string): Promise<boolean> {
  const res = await fetch(`/api/files/${fileId}/share?nonce=${encodeURIComponent(nonce)}`, {
    method: 'DELETE',
  });
  return (await unwrap<{ revoked: boolean }>(res)).revoked;
}
