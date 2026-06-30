/**
 * QueryCacheBlobStore — the data plane. Stores gzipped-JSONL result blobs in
 * the object store (S3 hosted / local-file open-source) behind a stream-first
 * interface.
 *
 * The interface is stream-first so connector-level streaming can drop in later
 * without touching callers. v1 gzips into a bounded buffer before handing it to
 * the underlying `ObjectStore.put` (results are row-capped, so the compressed
 * buffer is small); swapping in an `ObjectStore.putStream` later is transparent
 * to everything above this file.
 */
import 'server-only';
import { Readable } from 'stream';
import { createGzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { createObjectStore, type ObjectStore } from '@/lib/object-store';
import type { QueryCacheBlobStore } from './types';
import { decodeJsonl } from './jsonl';
import { gunzipToString } from './jsonl-stream.server';
import type { QueryResult } from '@/lib/connections/base';

const CONTENT_TYPE = 'application/gzip';

class ObjectStoreBlobStore implements QueryCacheBlobStore {
  constructor(private readonly store: ObjectStore) {}

  async putStream(ref: string, body: Readable): Promise<{ byteSize: number }> {
    // Compress the JSONL stream, collecting the (bounded) gzipped output, then
    // hand the buffer to the object store. Backpressure flows through the gzip
    // transform; only the compressed bytes are held, never the raw rows twice.
    const gzip = createGzip();
    const chunks: Buffer[] = [];
    gzip.on('data', (c: Buffer) => chunks.push(c));
    await pipeline(body, gzip);
    const buf = Buffer.concat(chunks);
    await this.store.put(ref, buf, CONTENT_TYPE);
    return { byteSize: buf.length };
  }

  async getStream(ref: string): Promise<Readable | null> {
    const buf = await this.store.get(ref);
    if (!buf) return null;
    const text = await gunzipToString(buf);
    return Readable.from([text]);
  }

  async getResult(ref: string): Promise<QueryResult | null> {
    const buf = await this.store.get(ref);
    if (!buf) return null;
    return decodeJsonl(await gunzipToString(buf));
  }

  async delete(ref: string): Promise<void> {
    await this.store.delete(ref);
  }
}

/** Object-store key for a cache blob. Flat namespace keyed by the cache key hash. */
export function blobRefForKey(cacheKey: string): string {
  // cacheKey can contain ':' and '/'; encode to a safe single path segment.
  const safe = Buffer.from(cacheKey).toString('hex');
  return `query-cache/${safe}.jsonl.gz`;
}

export function createQueryCacheBlobStore(store: ObjectStore = createObjectStore()): QueryCacheBlobStore {
  return new ObjectStoreBlobStore(store);
}
