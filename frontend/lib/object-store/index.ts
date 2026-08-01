import 'server-only';

/**
 * ObjectStore — S3-compatible file storage.
 *
 * S3 backend env vars — when the bucket or access key is absent the local
 * filesystem is used instead (see isLocalObjectStore / LocalFsAdapter):
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
import type { Readable } from 'stream';
import { S3Adapter } from './s3-adapter';
import { LocalFsAdapter } from './local-fs-adapter';
import { NamespacedObjectStore } from './namespaced';
import { getModules } from '@/lib/modules/registry';
import { namespaced } from '@/lib/namespace/types';
import {
  OBJECT_STORE_ACCESS_KEY_ID,
  OBJECT_STORE_BUCKET,
} from '@/lib/config';

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
  /** Stream bytes IN without buffering the whole object (S3 multipart / local write-stream). */
  putStream(key: string, body: Readable, contentType?: string): Promise<void>;
  /** Stream bytes OUT without buffering, or null if the object is missing. */
  getStream(key: string): Promise<Readable | null>;
  delete(key: string): Promise<void>;
  /** Server-side S3 copy — no data transfer through Node.js. */
  copyObject(sourceKey: string, destKey: string): Promise<void>;
  /** True if an object exists at `key`. */
  exists(key: string): Promise<boolean>;
  /** Read an object's bytes, or null if missing. */
  get(key: string): Promise<Buffer | null>;
  /** Public URL an object at `key` is served from (no network call). */
  publicUrl(key: string): string;
}

/** True when S3 credentials are absent — local filesystem is used instead. */
export function isLocalObjectStore(): boolean {
  return !OBJECT_STORE_ACCESS_KEY_ID || !OBJECT_STORE_BUCKET;
}

/** The bare backend, with no namespace prefixing. Internal — see createObjectStore. */
function createBackingStore(): ObjectStore {
  return isLocalObjectStore() ? new LocalFsAdapter() : new S3Adapter();
}

/**
 * The physical key a logical key resolves to.
 *
 * Some readers cannot go through the store — DuckDB is handed an `s3://` URL or a
 * filesystem path and reads it itself. Those paths must apply the SAME prefix the store
 * applies, or a write through the store becomes unreadable by the reader that follows
 * it. Logical keys stay namespace-free wherever they are persisted; the prefix is
 * applied at access time, here.
 */
export async function resolveObjectKey(logicalKey: string): Promise<string> {
  return namespaced(await getModules().namespace.isolation(), logicalKey);
}

/**
 * The object store, scoped to the caller's namespace.
 *
 * Async because resolving the namespace is: the prefix is applied HERE rather than at
 * each call site, so no caller can forget it, and a deployment that isolates workspaces
 * gets it without any call site knowing. Every key written or read through this is
 * inside the caller's namespace — there are deliberately no shared keys.
 */
export async function createObjectStore(): Promise<ObjectStore> {
  const namespace = getModules().namespace;
  return new NamespacedObjectStore(createBackingStore(), () => namespace.isolation());
}

/**
 * Key path structure:
 *   Uploads/charts:  {type}/{userId}/{mode}/{YYYY-MM-DD}/{uuid}{ext}
 *   CSV files:       csvs/{mode}/{connectionName}/{uuid}{ext}  (generateCsvUploadKey)
 *
 * - type: 'uploads' | 'charts'
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
