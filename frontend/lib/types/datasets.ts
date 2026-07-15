/**
 * Datasets — static data (CSV / Excel / Google Sheets) as ordinary FILES.
 *
 * A dataset is a file doc living in any folder. One doc carries N tables (a
 * multi-CSV upload, an xlsx's sheets, a spreadsheet's tabs), each backed by an
 * S3 object and queryable through the single VIRTUAL connection
 * `FILES_CONNECTION` ('files', DuckDB dialect) — no per-file "connection"
 * ceremony, so editors can add data without an admin.
 *
 * The two invariants everything else builds on:
 *
 *  1. VISIBILITY — a dataset is queryable from its OWN folder and every folder
 *     beneath it; never above, never sideways. (Same downward flow as context
 *     grants: root datasets are org-wide, a team's uploads stay theirs.)
 *  2. GLOBAL NAMING — `schema.table` is unique per mode across ALL datasets
 *     (enforced at create/edit, like `_views` names). A table name means
 *     exactly one thing org-wide, which keeps the query-cache key
 *     (query, params, connection) collision-free with no folder salt, and the
 *     agent's vocabulary folder-independent.
 */

import type { BaseFileContent } from '@/lib/types/files';

/** The virtual connection every dataset table is queried through. */
export const FILES_CONNECTION = 'files';

/** Dialect of the virtual files connection (datasets execute in DuckDB). */
export const FILES_DIALECT = 'duckdb';

/**
 * How a table got here. Deliberately broader than the formats we accept today:
 *  - 'upload' — a file the user uploaded (CSV/XLSX now; parquet, JSON later)
 *  - 'link'   — imported from a URL and re-importable (Google Sheets now;
 *               other link sources later). `source_url` is where it came from.
 * (Migration maps the legacy CsvFileInfo source_type: csv→upload,
 * google_sheets→link, spreadsheet_url→source_url, spreadsheet_id→source_group.)
 */
export type DatasetSource = 'upload' | 'link';

/** One queryable table of a dataset, backed by an S3 object. */
export interface DatasetTable {
  filename: string;
  table_name: string;
  /** DuckDB schema, e.g. "public" or "mxfood" — user-chosen namespace. */
  schema_name: string;
  /** S3 object key, org-scoped. */
  s3_key: string;
  file_format: 'csv' | 'parquet';
  row_count: number;
  columns: { name: string; type: string }[];
  source: DatasetSource;
  /** link sources: the source URL (drives re-import). */
  source_url?: string;
  /** link sources: groups tables imported from one source (e.g. a spreadsheet's tabs). */
  source_group?: string;
}

/** Content of a `dataset` file doc. */
export interface DatasetContent extends BaseFileContent {
  description?: string | null;
  /** The tables this dataset exposes (each backed by an S3 object). */
  files: DatasetTable[];
  /**
   * Tables hidden from the query surface (schema.table keys). Mirrors View
   * column whitelisting: absence = exposed (auto-expose on upload), presence =
   * the table does not exist for the agent, the GUI or any query.
   */
  hiddenTables?: string[];
}

/** Canonical `schema.table` key for uniqueness checks and hide lists. */
export const tableKey = (t: Pick<DatasetTable, 'schema_name' | 'table_name'>): string =>
  `${t.schema_name}.${t.table_name}`;

/** The exposed (non-hidden) tables of a dataset. */
export function exposedTables(content: DatasetContent): DatasetTable[] {
  const hidden = new Set(content.hiddenTables ?? []);
  return (content.files ?? []).filter((t) => !hidden.has(tableKey(t)));
}

/** A dataset doc paired with where it lives (visibility is folder-derived). */
export interface ResolvedDataset {
  fileId: number;
  /** Folder the dataset doc lives in (its visibility root). */
  folder: string;
  content: DatasetContent;
}
