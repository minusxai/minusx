import 'server-only';

import type { ColumnMeta, NodeConnector } from '@/lib/connections/base';
import type { CatalogTables } from '../catalog';
import { flattenCatalogColumns, type FlatColumn } from './schema';
import { fetchTableSample } from './samples';
import { truncateRow } from './truncate';

/** Aggregated per-table data passed to the agent as its userMessage. */
export interface CatalogSummaryTable {
  connection: string;
  schema: string;
  table: string;
  rowCount?: number;
  columns: Array<{ name: string; type: string; meta?: ColumnMeta }>;
  samples: Record<string, unknown>[];
}

export interface CatalogSummary {
  tables: CatalogSummaryTable[];
}

/** Project the cached catalog into stats + row counts the summary needs. */
export function buildStatsMap(catalog: CatalogTables): Map<string, ColumnMeta> {
  const out = new Map<string, ColumnMeta>();
  for (const r of catalog.column_stats.rows) {
    const key = `${r.connection_name}.${r.schema_name}.${r.table_name}.${r.column_name}`;
    const meta: ColumnMeta = {};
    if (typeof r.category === 'string') meta.category = r.category as ColumnMeta['category'];
    if (typeof r.n_distinct === 'number' || typeof r.n_distinct === 'bigint') meta.nDistinct = Number(r.n_distinct);
    if (typeof r.null_count === 'number' || typeof r.null_count === 'bigint') meta.nullCount = Number(r.null_count);
    if (r.min_value != null) meta.min = r.min_value as number | string;
    if (r.max_value != null) meta.max = r.max_value as number | string;
    if (typeof r.avg_value === 'number') meta.avg = r.avg_value;
    if (typeof r.min_date === 'string') meta.minDate = r.min_date;
    if (typeof r.max_date === 'string') meta.maxDate = r.max_date;
    if (typeof r.top_values === 'string') {
      try { meta.topValues = JSON.parse(r.top_values); } catch { /* ignore */ }
    }
    out.set(key, meta);
  }
  return out;
}

export function buildRowCountMap(catalog: CatalogTables): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of catalog.tables.rows) {
    const id = `${r.connection_name}.${r.schema_name}.${r.table_name}`;
    if (typeof r.row_count === 'number' || typeof r.row_count === 'bigint') {
      out.set(id, Number(r.row_count));
    }
  }
  return out;
}

function colKey(c: FlatColumn): string {
  return `${c.connection}.${c.schema}.${c.table}.${c.column}`;
}
function tableId(c: { connection: string; schema: string; table: string }): string {
  return `${c.connection}.${c.schema}.${c.table}`;
}

/**
 * Build the per-table summary objects from the catalog + sample fetcher.
 * Pure-ish: takes the catalog projection + a callback that produces samples
 * (so the unit test can pass a stub).
 */
export async function buildCatalogSummary(
  schema: FlatColumn[],
  statsByCol: Map<string, ColumnMeta>,
  rowCountByTable: Map<string, number>,
  fetchSample: (t: { connection: string; schema: string; table: string }) => Promise<Record<string, unknown>[]>,
): Promise<CatalogSummary> {
  // Group columns by table preserving catalog order.
  const byTable = new Map<string, CatalogSummaryTable>();
  for (const c of schema) {
    const id = tableId(c);
    let entry = byTable.get(id);
    if (!entry) {
      entry = {
        connection: c.connection,
        schema: c.schema,
        table: c.table,
        rowCount: rowCountByTable.get(id),
        columns: [],
        samples: [],
      };
      byTable.set(id, entry);
    }
    entry.columns.push({ name: c.column, type: c.type, meta: statsByCol.get(colKey(c)) });
  }

  await Promise.all(
    [...byTable.values()].map(async (t) => {
      t.samples = await fetchSample({ connection: t.connection, schema: t.schema, table: t.table });
    }),
  );

  return { tables: [...byTable.values()] };
}

/** Real fetcher: pulls a diverse sample of rows per table via the connector. */
export function makeFetchTableSample(
  schema: FlatColumn[],
  statsByCol: Map<string, ColumnMeta>,
  connectorsByName: Map<string, NodeConnector>,
  dialectsByName: Map<string, string>,
): (t: { connection: string; schema: string; table: string }) => Promise<Record<string, unknown>[]> {
  return async (t) => {
    const conn = connectorsByName.get(t.connection);
    if (!conn) return [];
    const dialect = dialectsByName.get(t.connection) ?? 'duckdb';
    const highCardTextCols: string[] = [];
    for (const c of schema) {
      if (c.connection !== t.connection || c.schema !== t.schema || c.table !== t.table) continue;
      const meta = statsByCol.get(`${t.connection}.${t.schema}.${t.table}.${c.column}`);
      if (meta?.category === 'text' && (meta.nDistinct ?? 0) > 50) highCardTextCols.push(c.column);
    }
    return fetchTableSample(conn, t.schema, t.table, dialect, highCardTextCols);
  };
}

// ─── Markdown serialisation (what the agent reads as its userMessage) ────────

function metaCell(m: ColumnMeta | undefined): string {
  if (!m) return '';
  const bits: string[] = [];
  if (m.nDistinct !== undefined) bits.push(`nDistinct=${m.nDistinct}`);
  if (m.nullCount !== undefined && m.nullCount > 0) bits.push(`nullCount=${m.nullCount}`);
  if (m.min !== undefined && m.max !== undefined) bits.push(`min=${m.min}, max=${m.max}`);
  if (m.topValues && m.topValues.length > 0) {
    const top = m.topValues.slice(0, 3).map((t) => JSON.stringify(t.value)).join(', ');
    bits.push(`top=[${top}]`);
  }
  return bits.join('; ');
}

/**
 * Render the catalog summary as a single markdown blob the agent will see
 * as its userMessage. Escape pipes + newlines so the table layout stays
 * intact when a column has surprising values.
 */
export function renderCatalogSummary(summary: CatalogSummary): string {
  const lines: string[] = [];
  const mdEscape = (s: string): string =>
    s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  for (const t of summary.tables) {
    lines.push(
      `## ${t.connection}.${t.schema}.${t.table}${t.rowCount !== undefined ? ` (${t.rowCount} rows)` : ''}`,
      '',
      '| column | type | stats |',
      '|---|---|---|',
    );
    for (const c of t.columns) {
      lines.push(`| ${c.name} | ${c.type} | ${mdEscape(metaCell(c.meta))} |`);
    }
    if (t.samples.length > 0) {
      lines.push('', 'Sample rows:');
      for (const r of t.samples) lines.push(`- ${JSON.stringify(truncateRow(r))}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** Convenience: catalog → flat schema + stats + rowCounts (no fetch). */
export function catalogProjection(catalog: CatalogTables): {
  schema: FlatColumn[];
  statsByCol: Map<string, ColumnMeta>;
  rowCountByTable: Map<string, number>;
} {
  return {
    schema: flattenCatalogColumns(catalog),
    statsByCol: buildStatsMap(catalog),
    rowCountByTable: buildRowCountMap(catalog),
  };
}
