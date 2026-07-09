/**
 * Agentic Google Sheets import — shared contracts.
 *
 * The import pipeline has three stages:
 *  1. RAW GRIDS — every sheet tab is stored as an untyped positional grid (Parquet): columns
 *     named like the spreadsheet (`A`, `B`, …) plus a 1-based `row_num`, cell values as
 *     canonical strings. The agent (and the transform SQL) addresses cells exactly like the
 *     sheet the user sees: `SELECT B, C FROM raw.l1_consol WHERE row_num BETWEEN 3 AND 29`.
 *  2. TRANSFORMS — one DuckDB SQL statement per output table, written by the agent over the
 *     raw grids: table detection (row/col slicing), crosstab unpivot (UNPIVOT), value cleaning
 *     (regexp_replace / TRY_CAST). Deterministic → re-runnable on sheet resync.
 *  3. MATERIALIZATION — each transform's result is written to Parquet and registered as a
 *     table on the static connection (same RegisteredFile shape as the plain CSV path).
 */

/** One sheet tab stored as a raw positional grid. */
export interface RawGridFile {
  /** Original tab name as it appears in the spreadsheet (e.g. "L1 Consol"). */
  tab_name: string;
  /** Sanitized table name the grid is mounted under in the `raw` schema (e.g. "l1_consol"). */
  table_name: string;
  /** Object-store key of the grid Parquet. */
  s3_key: string;
  /** Grid dimensions (rows = last non-empty sheet row; cols = last non-empty column). */
  n_rows: number;
  n_cols: number;
}

/** One agent-authored transform: raw grid(s) → one clean output table. */
export interface SheetTransform {
  /** Sanitized output table name (unique within the import). */
  output_table: string;
  schema_name: string;
  /** Raw grid table names this SQL reads (subset of RawGridFile.table_name). */
  source_tables: string[];
  /** A single DuckDB SELECT over `raw.<table>` views producing the clean table. */
  sql: string;
  /** Human-readable summary of what the transform does — shown in the review UI. */
  description: string;
}

/** Preview of a transform's output (bounded) for agent validation + the review UI. */
export interface TransformPreview {
  columns: Array<{ name: string; type: string }>;
  rows: Array<Record<string, unknown>>;
  /** Total rows the transform produces (not just the previewed subset). */
  row_count: number;
}
