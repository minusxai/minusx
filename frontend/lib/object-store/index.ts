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
 * Upload flow:
 *   1. Server calls getUploadUrl() → presigned PUT URL + final public URL
 *   2. Client PUTs file directly to uploadUrl (bypasses server)
 *   3. Client stores publicUrl in attachment / markdown
 */

import { randomUUID } from 'crypto';
import { extname } from 'path';
import { S3Adapter } from './s3-adapter';

export interface UploadUrlResult {
  /** Presigned PUT URL the client uploads to directly. */
  uploadUrl: string;
  /** Publicly accessible URL of the object after upload. */
  publicUrl: string;
}

export interface ObjectStore {
  getUploadUrl(params: { key: string; contentType: string }): Promise<UploadUrlResult>;
  delete(key: string): Promise<void>;
}

export function createObjectStore(): ObjectStore {
  return new S3Adapter();
}

/**
 * Generate a unique storage key for an uploaded file.
 * Format: `{companyId}/{uuid}{ext}`
 */
export function generateUploadKey(companyId: number, filename: string): string {
  const ext = extname(filename).toLowerCase();
  return `${companyId}/${randomUUID()}${ext}`;
}

export { S3Adapter };
