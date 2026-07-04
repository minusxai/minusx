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
import type { JsonlHeader } from './types';
import type { QueryResult, BoundedDrainOptions, BoundedQueryResult } from '@/lib/connections/base';
import { createInterface } from 'readline';

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

  async getResultBounded(ref: string, opts: BoundedDrainOptions = {}): Promise<BoundedQueryResult | null> {
    const stream = await this.getStream(ref);
    if (!stream) return null;
    return decodeGunzippedJsonlBounded(stream, opts);
  }

  async delete(ref: string): Promise<void> {
    await this.store.delete(ref);
  }
}

/**
 * Decode a gunzipped-JSONL stream line-by-line, stopping once a row/byte budget is hit — so a cache
 * HIT is bounded in RAM exactly like a bounded fresh drain (no `Buffer.concat` of the whole blob).
 * The header (line 1) carries the authoritative full rowCount, so `truncated` is exact here.
 */
async function decodeGunzippedJsonlBounded(
  stream: Readable,
  { maxRows = Infinity, maxBytes = Infinity }: BoundedDrainOptions,
): Promise<BoundedQueryResult> {
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let header: JsonlHeader | null = null;
  const rows: Record<string, unknown>[] = [];
  let bytes = 0;
  let sourceRowLines = 0;
  try {
    for await (const line of rl) {
      if (!line) continue;
      if (header === null) { header = JSON.parse(line) as JsonlHeader; continue; }
      sourceRowLines++;
      if (rows.length >= maxRows || bytes >= maxBytes) continue; // keep counting source rows, stop collecting
      bytes += Buffer.byteLength(line, 'utf8');
      rows.push(JSON.parse(line) as Record<string, unknown>);
    }
  } finally {
    rl.close();
    stream.destroy(); // stop pulling the object-store body once we've read enough
  }
  if (!header) throw new Error('decodeGunzippedJsonlBounded: empty blob (no header line)');
  const total = header.rowCount ?? sourceRowLines;
  return {
    columns: header.columns, types: header.types, finalQuery: header.finalQuery,
    rows, truncated: total > rows.length,
  };
}

/** Object-store key for a cache blob. Flat namespace keyed by the cache key hash. */
export function blobRefForKey(cacheKey: string): string {
  // cacheKey can contain ':' and '/'; encode to a safe single path segment.
  const safe = Buffer.from(cacheKey).toString('hex');
  return `query-cache/${safe}.jsonl.gz`;
}

// Overridable object-store factory for the blob plane. Defaults to the shared object
// store; a deployment can inject a wrapper that applies a request-scoped key namespace
// (e.g. namespacing blobs by an ambient request context).
let objectStoreFactory: () => ObjectStore = createObjectStore;

/** Override the object store backing the query-cache blob plane. */
export function setQueryCacheObjectStoreFactory(factory: () => ObjectStore): void {
  objectStoreFactory = factory;
}

export function createQueryCacheBlobStore(store: ObjectStore = objectStoreFactory()): QueryCacheBlobStore {
  return new ObjectStoreBlobStore(store);
}
