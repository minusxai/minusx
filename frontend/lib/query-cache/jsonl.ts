/**
 * JSONL codec for query results — the single wire + at-rest format.
 *
 * Layout: one JSON object per line. The FIRST line is a {@link JsonlHeader}
 * (columns/types/finalQuery/rowCount); every subsequent line is one row object.
 * This is trivially streamable (no trailing footer like Parquet/Arrow) and
 * DuckDB-readable (`read_ndjson`). At rest the whole thing is gzipped.
 *
 * Peak memory for the streaming helpers is one row at a time. The buffered
 * helpers (encode/decode/bounded) operate on the row-capped result and are used
 * for cache writes and the agent's bounded-slice reads.
 */
import { Readable } from 'stream';
import { gzip, gunzip } from 'zlib';
import { promisify } from 'util';
import type { QueryResult } from '@/lib/connections/base';
import type { JsonlHeader } from './types';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/** Serialize a result to a JSONL string (header line + one line per row). */
export function encodeResultToJsonl(result: QueryResult): string {
  const header: JsonlHeader = {
    columns: result.columns,
    types: result.types,
    finalQuery: result.finalQuery,
    rowCount: result.rows.length,
  };
  const lines = [JSON.stringify(header)];
  for (const row of result.rows) lines.push(JSON.stringify(row));
  return lines.join('\n') + '\n';
}

/** Parse a full JSONL string back into a QueryResult. */
export function decodeJsonl(text: string): QueryResult {
  const lines = splitLines(text);
  if (lines.length === 0) throw new Error('decodeJsonl: empty input (no header line)');
  const header = JSON.parse(lines[0]) as JsonlHeader;
  const rows = lines.slice(1).map((l) => JSON.parse(l) as Record<string, unknown>);
  return { columns: header.columns, types: header.types, finalQuery: header.finalQuery, rows };
}

export interface BoundedDecode {
  columns: string[];
  types: string[];
  finalQuery: string;
  rows: Record<string, unknown>[];
  /** Total rows present in the source (from the header), regardless of the cap. */
  totalRows: number;
  /** True when the source had more rows than `maxRows`. */
  truncated: boolean;
}

/**
 * Decode at most `maxRows` rows. Used by the agent's text path: it never needs
 * the full set, only enough rows to fill a char budget. `totalRows`/`truncated`
 * come from the header, so the agent can tell the LLM the result was clipped.
 */
export function decodeJsonlBounded(text: string, maxRows: number): BoundedDecode {
  const lines = splitLines(text);
  if (lines.length === 0) throw new Error('decodeJsonlBounded: empty input (no header line)');
  const header = JSON.parse(lines[0]) as JsonlHeader;
  const rowLines = lines.slice(1);
  const rows = rowLines.slice(0, Math.max(0, maxRows)).map((l) => JSON.parse(l) as Record<string, unknown>);
  return {
    columns: header.columns,
    types: header.types,
    finalQuery: header.finalQuery,
    rows,
    totalRows: header.rowCount,
    truncated: header.rowCount > rows.length,
  };
}

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

function splitLines(text: string): string[] {
  return text.split('\n').filter((l) => l.length > 0);
}
