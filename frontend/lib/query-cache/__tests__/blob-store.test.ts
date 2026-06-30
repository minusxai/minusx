import { describe, it, expect } from 'vitest';
import { Readable } from 'stream';
import { createQueryCacheBlobStore } from '../blob-store';
import { resultToJsonlStream } from '../jsonl-stream.server';
import type { ObjectStore } from '@/lib/object-store';
import type { QueryResult } from '@/lib/connections/base';

/** Minimal in-memory ObjectStore for unit tests. */
function fakeObjectStore(): ObjectStore & { map: Map<string, Buffer> } {
  const map = new Map<string, Buffer>();
  return {
    map,
    async put(key, body) { map.set(key, Buffer.from(body)); return `mem://${key}`; },
    async get(key) { return map.get(key) ?? null; },
    async delete(key) { map.delete(key); },
    async exists(key) { return map.has(key); },
    publicUrl(key) { return `mem://${key}`; },
    async getUploadUrl({ key }) { return { uploadUrl: `mem://${key}`, publicUrl: `mem://${key}` }; },
    async copyObject(src, dest) { const b = map.get(src); if (b) map.set(dest, b); },
  };
}

const RESULT: QueryResult = {
  columns: ['id', 'name'],
  types: ['number', 'text'],
  rows: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }],
  finalQuery: 'SELECT * FROM t',
};

async function streamToString(s: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of s) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}

describe('QueryCacheBlobStore', () => {
  it('putStream stores compressed bytes and reports byteSize', async () => {
    const os = fakeObjectStore();
    const store = createQueryCacheBlobStore(os);
    const { byteSize } = await store.putStream('q/1.jsonl.gz', resultToJsonlStream(RESULT));
    expect(byteSize).toBeGreaterThan(0);
    expect(os.map.has('q/1.jsonl.gz')).toBe(true);
    // Stored bytes are gzip (magic 0x1f 0x8b), i.e. compressed, not raw JSONL.
    const stored = os.map.get('q/1.jsonl.gz')!;
    expect(stored[0]).toBe(0x1f);
    expect(stored[1]).toBe(0x8b);
  });

  it('getStream returns the decompressed JSONL stream', async () => {
    const os = fakeObjectStore();
    const store = createQueryCacheBlobStore(os);
    await store.putStream('q/1.jsonl.gz', resultToJsonlStream(RESULT));
    const out = await store.getStream('q/1.jsonl.gz');
    expect(out).not.toBeNull();
    const text = await streamToString(out!);
    expect(text.split('\n').filter(Boolean)).toHaveLength(3); // header + 2 rows
  });

  it('getResult round-trips the QueryResult', async () => {
    const os = fakeObjectStore();
    const store = createQueryCacheBlobStore(os);
    await store.putStream('q/1.jsonl.gz', resultToJsonlStream(RESULT));
    expect(await store.getResult('q/1.jsonl.gz')).toEqual(RESULT);
  });

  it('getStream / getResult return null for a missing ref', async () => {
    const store = createQueryCacheBlobStore(fakeObjectStore());
    expect(await store.getStream('nope')).toBeNull();
    expect(await store.getResult('nope')).toBeNull();
  });

  it('delete removes the blob', async () => {
    const os = fakeObjectStore();
    const store = createQueryCacheBlobStore(os);
    await store.putStream('q/1.jsonl.gz', resultToJsonlStream(RESULT));
    await store.delete('q/1.jsonl.gz');
    expect(os.map.has('q/1.jsonl.gz')).toBe(false);
  });
});
