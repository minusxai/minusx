/**
 * Shared DuckDB streaming helper. Turns an already-open DuckDB connection +
 * positional SQL into a {@link QueryStream} that reads the result chunk-by-chunk
 * (`conn.stream()` + `fetchChunk()`), yielding rows as DuckDB produces them. The
 * connection is held open across the lazy iteration and closed via `onClose` in
 * the generator's `finally`. Reused by the DuckDB, SQLite-via-DuckDB, and CSV
 * (parquet-via-DuckDB) connectors.
 *
 * Per-chunk `convertRows(JSDuckDBValueConverter)` produces the SAME JS values as
 * the materialized `getRowObjectsJS()` (DECIMAL/DATE/TIMESTAMP/etc.).
 */
import 'server-only';
import { JSDuckDBValueConverter } from '@duckdb/node-api';
import type { DuckDBConnection } from '@duckdb/node-api';
import type { QueryStream } from './base';
import { normalizeDuckDbTimeout } from './duckdb-query';

function jsonSafeReplacer(_: string, v: unknown): unknown {
  if (typeof v === 'bigint') {
    return v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(v) : v.toString();
  }
  return v;
}

/** Per-row JSON-safe normalization — same semantics as the connectors' makeJsonSafe. */
export function jsonSafeRow(row: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(row, jsonSafeReplacer));
}

export async function duckDbStreamFromConn(opts: {
  conn: DuckDBConnection;
  positionalSql: string;
  values: unknown[];
  finalQuery: string;
  timeoutMs?: number;
  /** Release the connection — called exactly once when the stream finishes or errors. */
  onClose: () => void;
}): Promise<QueryStream> {
  const { conn, positionalSql, values, finalQuery, timeoutMs, onClose } = opts;
  let closed = false;
  const close = () => { if (!closed) { closed = true; try { onClose(); } catch { /* ignore */ } } };

  try {
    // Best-effort interrupt-based timeout (DuckDB has no statement_timeout GUC).
    let settled = false;
    const timer = timeoutMs && timeoutMs > 0
      ? setTimeout(() => { if (!settled) conn.interrupt(); }, timeoutMs)
      : undefined;

    let result: Awaited<ReturnType<typeof conn.stream>>;
    try {
      result = await conn.stream(positionalSql, values as never);
    } catch (err) {
      settled = true; if (timer) clearTimeout(timer);
      close();
      throw normalizeDuckDbTimeout(err, timeoutMs);
    }

    const colCount = result.columnCount;
    const columns: string[] = [];
    const types: string[] = [];
    for (let i = 0; i < colCount; i++) {
      columns.push(result.columnName(i));
      types.push(result.columnType(i).toString());
    }

    async function* rows(): AsyncGenerator<Record<string, unknown>> {
      try {
        let chunk = await result.fetchChunk();
        while (chunk && chunk.rowCount > 0) {
          const converted = chunk.convertRows(JSDuckDBValueConverter) as unknown[][];
          for (const arr of converted) {
            const row: Record<string, unknown> = {};
            for (let i = 0; i < columns.length; i++) row[columns[i]] = arr[i];
            yield jsonSafeRow(row);
          }
          chunk = await result.fetchChunk();
        }
      } catch (err) {
        throw normalizeDuckDbTimeout(err, timeoutMs);
      } finally {
        settled = true; if (timer) clearTimeout(timer);
        close();
      }
    }

    return { columns, types, finalQuery, rows: rows() };
  } catch (err) {
    close();
    throw err;
  }
}
