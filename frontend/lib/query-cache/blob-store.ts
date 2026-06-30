/**
 * QueryCacheBlobStore — the data plane. Stores gzipped-JSONL result blobs in
 * the object store (S3 hosted / local-file open-source) and streams them in/out
 * without ever buffering the whole object: a JSONL row stream is piped through
 * gzip straight to the object store, and read back through gunzip. Peak memory
 * is one chunk, regardless of result size.
 */
import 'server-only';
import { Readable, Transform } from 'stream';
import { createGzip, createGunzip } from 'zlib';
import { createObjectStore, type ObjectStore } from '@/lib/object-store';
import type { QueryCacheBlobStore } from './types';
import { decodeJsonl } from './jsonl';
import type { QueryResult } from '@/lib/connections/base';

const CONTENT_TYPE = 'application/gzip';

class ObjectStoreBlobStore implements QueryCacheBlobStore {
  constructor(private readonly store: ObjectStore) {}

  async putStream(ref: string, body: Readable): Promise<{ byteSize: number }> {
    // body (plain JSONL) → gzip → counter → object store. Errors anywhere in the
    // chain are forwarded downstream so the object-store write rejects.
    const gzip = createGzip();
    let byteSize = 0;
    const counter = new Transform({
      transform(chunk, _enc, cb) { byteSize += chunk.length; cb(null, chunk); },
    });
    body.on('error', (e) => gzip.destroy(e));
    gzip.on('error', (e) => counter.destroy(e));
    body.pipe(gzip).pipe(counter);
    await this.store.putStream(ref, counter, CONTENT_TYPE);
    return { byteSize };
  }

  async getStream(ref: string): Promise<Readable | null> {
    const gz = await this.store.getStream(ref);
    if (!gz) return null;
    const gunzip = createGunzip();
    gz.on('error', (e) => gunzip.destroy(e));
    return gz.pipe(gunzip);
  }

  async getResult(ref: string): Promise<QueryResult | null> {
    const stream = await this.getStream(ref);
    if (!stream) return null;
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(Buffer.from(c));
    return decodeJsonl(Buffer.concat(chunks).toString('utf8'));
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
