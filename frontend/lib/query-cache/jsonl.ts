/**
 * JSONL codec for query results — the single wire + at-rest format (PURE).
 *
 * Layout: one JSON object per line. The FIRST line is a {@link JsonlHeader}
 * (columns/types/finalQuery/rowCount); every subsequent line is one row object.
 * Trivially streamable (no trailing footer like Parquet/Arrow) and DuckDB-readable
 * (`read_ndjson`).
 *
 * This module is CLIENT-SAFE — pure string ops, no Node builtins — so the browser
 * can decode `/api/query`'s JSONL body. Stream + gzip helpers (Node-only) live in
 * `jsonl-stream.server.ts`.
 */
import type { QueryResult } from '@/lib/connections/base';
import type { JsonlHeader } from './types';

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
  // Streamed blobs omit rowCount from the header — fall back to the actual line count.
  const totalRows = header.rowCount ?? rowLines.length;
  return {
    columns: header.columns,
    types: header.types,
    finalQuery: header.finalQuery,
    rows,
    totalRows,
    truncated: totalRows > rows.length,
  };
}

function splitLines(text: string): string[] {
  return text.split('\n').filter((l) => l.length > 0);
}
