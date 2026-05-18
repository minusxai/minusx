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

/** Soft cap on the rendered catalog summary handed to AutoContextAgent's
 *  LLM. Picked well under typical model context windows (incl. system
 *  prompt + tool definitions + response space) so we don't blow the
 *  context. The renderer degrades gracefully when the catalog wouldn't
 *  fit at full fidelity. */
export const DEFAULT_CATALOG_SUMMARY_MAX_CHARS = 80_000;

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

type MdEscape = (s: string) => string;

function renderTableSchemaAndStats(t: CatalogSummaryTable, mdEscape: MdEscape): string {
  const lines: string[] = [
    `## ${t.connection}.${t.schema}.${t.table}${t.rowCount !== undefined ? ` (${t.rowCount} rows)` : ''}`,
    '',
    '| column | type | stats |',
    '|---|---|---|',
  ];
  for (const c of t.columns) {
    lines.push(`| ${c.name} | ${c.type} | ${mdEscape(metaCell(c.meta))} |`);
  }
  return lines.join('\n');
}

function renderTableFull(t: CatalogSummaryTable, mdEscape: MdEscape): string {
  const head = renderTableSchemaAndStats(t, mdEscape);
  if (t.samples.length === 0) return head;
  const tail: string[] = ['', 'Sample rows:'];
  for (const r of t.samples) tail.push(`- ${JSON.stringify(truncateRow(r))}`);
  return `${head}\n${tail.join('\n')}`;
}

/**
 * Render the catalog summary as a single markdown blob the agent reads as
 * its userMessage. Bounded by `maxChars` with graceful degradation:
 *
 *   1. First pass: every table rendered with schema + stats + samples.
 *      Trailing tables are dropped if the running total would exceed the
 *      budget.
 *   2. If that didn't fit every table, re-pass dropping `Sample rows:`
 *      everywhere. Trailing tables still drop if needed.
 *
 * When degradation kicks in, a `> Note:` block is prepended explaining
 * what was dropped and pointing the agent at the right tools to fetch
 * the missing detail (`ExecuteQuery` for samples, `SearchDBSchema` for
 * omitted tables). Without this the agent silently treats the summary
 * as authoritative and may never probe for samples or discover the
 * tables that didn't make the cut.
 *
 * Escapes pipes + newlines so the table layout stays intact when a
 * column has surprising values.
 */
export function renderCatalogSummary(
  summary: CatalogSummary,
  maxChars: number = DEFAULT_CATALOG_SUMMARY_MAX_CHARS,
): string {
  const mdEscape: MdEscape = (s) =>
    s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const sep = '\n\n';

  const render = (blockFor: (t: CatalogSummaryTable) => string): {
    blocks: string[]; coveredCount: number; coveredAll: boolean;
  } => {
    const blocks: string[] = [];
    let total = 0;
    let coveredAll = true;
    for (const t of summary.tables) {
      const block = blockFor(t);
      const cost = block.length + (blocks.length > 0 ? sep.length : 0);
      if (total + cost > maxChars) {
        coveredAll = false;
        break;
      }
      blocks.push(block);
      total += cost;
    }
    return { blocks, coveredCount: blocks.length, coveredAll };
  };

  // Pass 1: full detail (schema + stats + samples) for every table.
  const fullPass = render((t) => renderTableFull(t, mdEscape));
  if (fullPass.coveredAll) return fullPass.blocks.join(sep);

  // Pass 2: drop sample rows everywhere; trade sample fidelity for
  // coverage of every table.
  const compactPass = render((t) => renderTableSchemaAndStats(t, mdEscape));

  const totalTables = summary.tables.length;
  const noteLines: string[] = ['> Note: This catalog summary was bounded to fit the agent\'s context window.'];
  // Always true at this point: full pass dropped samples (otherwise we
  // wouldn't have reached pass 2). Tell the agent samples are missing.
  noteLines.push('> Sample rows have been omitted from every table. Run `ExecuteQuery` with a small `SELECT * FROM <table> LIMIT N` if you need to inspect actual values.');
  if (!compactPass.coveredAll) {
    const omitted = summary.tables.slice(compactPass.coveredCount).map(tableId);
    const list = omitted.slice(0, 30).map((id) => `\`${id}\``).join(', ');
    const more = omitted.length > 30 ? ` (and ${omitted.length - 30} more)` : '';
    noteLines.push(
      `> The summary covers ${compactPass.coveredCount} of ${totalTables} tables. Omitted: ${list}${more}. Use \`SearchDBSchema\` to inspect any of them.`,
    );
  }
  return `${noteLines.join('\n')}\n\n${compactPass.blocks.join(sep)}`;
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
