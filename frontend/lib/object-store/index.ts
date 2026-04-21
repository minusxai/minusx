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
import { LocalFsAdapter } from './local-fs-adapter';
import { ensureLocalMxfoodSeeds } from './local-seed';
import {
  OBJECT_STORE_ACCESS_KEY_ID,
  OBJECT_STORE_BUCKET,
} from '@/lib/config';

export interface UploadUrlResult {
  /** Presigned PUT URL the client uploads to directly. */
  uploadUrl: string;
  /** Publicly accessible URL of the object after equal. */
  publicUrl: string;
}

export interface ObjectStore {
  getUploadUrl(params: { key: string; contentType: string }): Promise<UploadUrlResult>;
  /** Server-side direct upload — returns publicUrl. */
  put(key: string, body: Buffer, contentType: string): Promise<string>;
  delete(key: string): Promise<void>;
  /** Server-side S3 copy — no data transfer through Node.js. */
  copyObject(sourceKey: string, destKey: string): Promise<void>;
}

/** True when S3 credentials are absent — local filesystem is used instead. */
export function isLocalObjectStore(): boolean {
  return !OBJECT_STORE_ACCESS_KEY_ID || !OBJECT_STORE_BUCKET;
}

export function createObjectStore(): ObjectStore {
  return isLocalObjectStore() ? new LocalFsAdapter() : new S3Adapter();
}

/**
 * Key path structure:
 *   Uploads/charts:  {type}/{userId}/{mode}/{YYYY-MM-DD}/{uuid}{ext}
 *   CSV files:       csvs/{mode}/{connectionName}/{uuid}{ext}
 *   Seed files:      seeds/mxfood/{table}.parquet  (shared, read-only)
 *
 * - type: 'uploads' | 'charts' | 'csvs'
 */
export function generateUploadKey(params: {
  userId: number;
  mode: string;
  type: 'uploads' | 'charts';
  ext: string; // e.g. '.jpg', '.png', '.pdf'
}): string {
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `${params.type}/${params.userId}/${params.mode}/${day}/${randomUUID()}${params.ext}`;
}

/**
 * Generate an S3 key for a CSV file upload.
 * Scoped to mode for isolation.
 *
 * Key path: csvs/{mode}/{connectionName}/{uuid}.{ext}
 * The original file extension is preserved so parquet files keep their .parquet suffix in S3.
 */
export function generateCsvUploadKey(params: {
  mode: string;
  connectionName: string;
  filename: string;
}): string {
  const ext = params.filename.split('.').pop()?.toLowerCase() || 'csv';
  return `csvs/${params.mode}/${params.connectionName}/${randomUUID()}.${ext}`;
}

/** Shared S3 seed path for a single mxfood table. */
export function getMxfoodSeedKey(tableName: string): string {
  return `seeds/mxfood/${tableName}.parquet`;
}

/** Destination key for a mxfood tutorial table. */
export function getMxfoodTutorialKey(mode: string, tableName: string): string {
  return `csvs/${mode}/mxfood/${tableName}.parquet`;
}

/**
 * Copy all mxfood seed Parquet files from the shared `seeds/mxfood/` prefix
 * to the mode-specific `csvs/{mode}/mxfood/` prefix using
 * server-side S3 CopyObject (no data transfer through Node.js).
 *
 * Returns the list of table names that were copied successfully.
 * Failures are logged but do not throw — call is best-effort.
 */
export async function copySeedMxfoodForMode(
  mode: string,
  tableNames: string[],
): Promise<string[]> {
  if (isLocalObjectStore()) {
    await ensureLocalMxfoodSeeds(tableNames);
  }

  const store = createObjectStore();
  const copied: string[] = [];

  await Promise.all(tableNames.map(async (table) => {
    try {
      await store.copyObject(
        getMxfoodSeedKey(table),
        getMxfoodTutorialKey(mode, table),
      );
      copied.push(table);
    } catch (err) {
      console.warn(`[copySeedMxfoodForMode] Failed to copy ${table}:`, err);
    }
  }));

  return copied;
}

export { S3Adapter };
export { LocalFsAdapter };
