/**
 * Server-only stream + gzip helpers for the JSONL codec. Kept apart from the
 * pure `jsonl.ts` so the client never bundles `stream`/`zlib`.
 */
import 'server-only';
import { Readable } from 'stream';
import { gzip, gunzip } from 'zlib';
import { promisify } from 'util';
import type { QueryResult } from '@/lib/connections/base';
import type { JsonlHeader } from './types';
import { decodeJsonl } from './jsonl';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/** A Readable that emits the result as JSONL, one line per `read`, header first. */
export function resultToJsonlStream(result: QueryResult): Readable {
  function* gen(): Generator<string> {
    const header: JsonlHeader = {
      columns: result.columns,
      types: result.types,
      finalQuery: result.finalQuery,
      rowCount: result.rows.length,
    };
    yield JSON.stringify(header) + '\n';
    for (const row of result.rows) yield JSON.stringify(row) + '\n';
  }
  return Readable.from(gen());
}

/** Consume a JSONL Readable fully into a QueryResult. */
export async function jsonlStreamToResult(stream: Readable): Promise<QueryResult> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  return decodeJsonl(Buffer.concat(chunks).toString('utf8'));
}

export async function gzipString(text: string): Promise<Buffer> {
  return gzipAsync(Buffer.from(text, 'utf8'));
}

export async function gunzipToString(buf: Buffer): Promise<string> {
  return (await gunzipAsync(buf)).toString('utf8');
}
