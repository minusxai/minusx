// Shared result-entry shape for V1 + V2 query tools.
//
// Three V2 tool files (`execute-query.ts`, `explore.ts`, `search-db-schema.ts`)
// each used to declare a local `interface QueryResultEntry` with the same
// fields; the V1 port adds two more tools that want the same shape.
// Centralised here so the structural contract is named in one place.
//
// One `ResultEntry` covers all three result states:
//   - **Success**: `preview`, `handle`, `stats` set; `error` / `handle_error`
//     undefined.
//   - **Per-query exec error**: `error` set with the engine's message;
//     `preview` / `handle` / `stats` undefined.
//   - **Handle-registration error**: `preview`, `stats` set but `handle`
//     omitted; `handle_error` carries the DuckDB message (e.g. duplicate
//     column names from the source query). The agent still gets the data.
//
// V1's new chained-pipeline ExecuteQuery returns a single `ResultEntry` (the
// final query's output) — not wrapped.

import type { ResultStats } from './v2/result-stats';

export interface ResultEntry {
  preview?: string;
  handle?: string;
  stats?: ResultStats;
  /** Per-query execution error — engine or validation failure. */
  error?: string;
  /**
   * Set when the source result couldn't be registered as a queryable
   * DuckDB handle table (most often: source query returned duplicate
   * column names). When present, `handle` is omitted but `preview` and
   * `stats` are still populated.
   */
  handle_error?: string;
}
