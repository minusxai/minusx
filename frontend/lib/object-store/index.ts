import 'server-only';

/**
 * ObjectStore — S3-compatible file storage.
 *
 * Requires env vars:
 *   OBJECT_STORE_BUCKET            S3 bucket name
 *   OBJECT_STORE_REGION            AWS region (default: us-east-1)
 *   OBJECT_STORE_ACCESS_KEY_ID     Access key
 *   OBJECT_STORE_SECRET_ACCESS_KEY Secret key
 *
 * Optional:
 *   OBJECT_STORE_ENDPOINT    Custom endpoint for S3-compatible stores (MinIO, R2, etc.)
 *   OBJECT_STORE_PUBLIC_URL  Public URL prefix for objects (e.g. CDN). Defaults to bucket URL.
 *
 * Upload flow (client-side):
 *   1. Server calls getUploadUrl() → presigned PUT URL + final public URL
 *   2. Client PUTs file directly to uploadUrl (bypasses server)
 *   3. Client stores publicUrl in attachment / markdown
 *
 * Upload flow (server-side, e.g. chart rendering):
 *   1. Server renders content to Buffer
 *   2. Server calls put() directly — no presigned URL needed
 *   3. Returns publicUrl
 */

import { randomUUID } from 'crypto';
import { S3Adapter } from './s3-adapter';

export interface UploadUrlResult {
  /** Presigned PUT URL the client uploads to directly. */
  uploadUrl: string;
  /** Publicly accessible URL of the object after upload. */
  publicUrl: string;
}

export interface ObjectStore {
  getUploadUrl(params: { key: string; contentType: string }): Promise<UploadUrlResult>;
  /** Server-side direct upload — returns publicUrl. */
  put(key: string, body: Buffer, contentType: string): Promise<string>;
  delete(key: string): Promise<void>;
}

export function createObjectStore(): ObjectStore {
  return new S3Adapter();
}

/**
 * Key path structure:
 *   {companyId}/{type}/{userId}/{mode}/{YYYY-MM-DD}/{uuid}{ext}
 *
 * - type: 'uploads' (user-attached files) | 'charts' (LLM vision renders)
 *   Allows independent S3 lifecycle rules per type.
 * - userId/mode: audit trail and per-user isolation
 * - YYYY-MM-DD: date-based lifecycle policies (e.g. delete charts after 30 days)
 * - uuid: uniqueness within the same day/user/mode
 */
export function generateUploadKey(params: {
  companyId: number;
  userId: number;
  mode: string;
  type: 'uploads' | 'charts';
  ext: string; // e.g. '.jpg', '.png', '.pdf'
}): string {
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `${params.companyId}/${params.type}/${params.userId}/${params.mode}/${day}/${randomUUID()}${params.ext}`;
}

export { S3Adapter };
