import 'server-only';

import type { SchemaEntry, SchemaColumn, ColumnMeta } from './base';
import type { QueryResult } from './base';

// ─── Internal Classification ─────────────────────────────────────────────────

type ColumnClassification = 'categorical' | 'numeric' | 'temporal' | 'id_unique' | 'boolean' | 'text' | 'unknown';

type ColumnCategory = ColumnMeta['category'] & string;

function toCategory(c: ColumnClassification): ColumnCategory {
  switch (c) {
    case 'categorical': return 'categorical';
    case 'numeric': return 'numeric';
    case 'temporal': return 'temporal';
    default: return 'other';
  }
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_COLUMNS_GENERIC = 30;
const TOP_VALUES_LIMIT = 20;
const CATEGORICAL_ABSOLUTE_MAX = 100;
const CATEGORICAL_RATIO_MAX = 0.05;
const ID_UNIQUE_RATIO_MIN = 0.5;

// ─── Types ───────────────────────────────────────────────────────────────────

type QueryFn = (sql: string) => Promise<QueryResult>;
type QuoteStyle = 'double' | 'backtick';

interface TableEntry {
  schema: string;
  table: string;
  columns: Array<{ name: string; type: string }>;
}

/** Result of profiling — enriched schema + metadata about the profiling run */
export interface ProfileResult {
  schema: SchemaEntry[];
  generatedAt: string;
  connectorType: string;
  queryCount: number;
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

export async function profileDatabase(
  connectorType: string,
  schema: SchemaEntry[],
  queryFn: QueryFn,
): Promise<ProfileResult> {
  let queryCount = 0;
  const countedQueryFn: QueryFn = async (sql) => {
    queryCount++;
    return queryFn(sql);
  };

  const allTables: TableEntry[] = [];
  for (const s of schema) {
    for (const t of s.tables) {
      allTables.push({ schema: s.schema, table: t.table, columns: t.columns });
    }
  }

  let enrichedTables: Array<{ schema: string; table: string; columns: SchemaColumn[] }>;

  switch (connectorType) {
    case 'postgresql':
      enrichedTables = await profilePostgres(allTables, countedQueryFn);
      break;
    case 'duckdb':
    case 'csv':
    case 'google-sheets':
      enrichedTables = await profileDuckDb(allTables, countedQueryFn);
      break;
    case 'bigquery':
      enrichedTables = await profileBigQuery(allTables, countedQueryFn);
      break;
    default:
      enrichedTables = await profileGeneric(allTables, countedQueryFn, 'double');
      break;
  }

  // Re-group into SchemaEntry[] (grouped by schema name)
  const schemaMap = new Map<string, SchemaEntry>();
  for (const t of enrichedTables) {
    if (!schemaMap.has(t.schema)) schemaMap.set(t.schema, { schema: t.schema, tables: [] });
    schemaMap.get(t.schema)!.tables.push({ table: t.table, columns: t.columns });
  }

  return {
    schema: Array.from(schemaMap.values()),
    generatedAt: new Date().toISOString(),
    connectorType,
    queryCount,
  };
}

// ─── Column Classification ───────────────────────────────────────────────────

function classifyColumn(
  columnType: string,
  nDistinct: number,
  rowCount: number,
): ColumnClassification {
  const t = columnType.toLowerCase();

  if (t.includes('bool')) return 'boolean';
  if (['date', 'timestamp', 'time', 'datetime', 'interval'].some(k => t.includes(k))) return 'temporal';
  if (t.includes('uuid')) return 'id_unique';

  const ratio = rowCount > 0 ? nDistinct / rowCount : 1;
  if (ratio >= ID_UNIQUE_RATIO_MIN) return 'id_unique';

  if (['int', 'float', 'double', 'decimal', 'numeric', 'real', 'bigint', 'smallint', 'number', 'int64', 'float64'].some(k => t.includes(k))) {
    return 'numeric';
  }

  if (nDistinct <= CATEGORICAL_ABSOLUTE_MAX || ratio <= CATEGORICAL_RATIO_MAX) {
    if (['text', 'varchar', 'character', 'string', 'char', 'enum'].some(k => t.includes(k))) {
      return 'categorical';
    }
  }

  if (['text', 'varchar', 'character', 'string', 'char'].some(k => t.includes(k))) return 'text';
  return 'unknown';
}

// ─── Build SchemaColumn with meta ────────────────────────────────────────────

function buildColumn(
  col: { name: string; type: string },
  classification: ColumnClassification,
  data: { description?: string; nullCount?: number; nDistinct?: number; min?: number | string; max?: number | string; avg?: number; minDate?: string; maxDate?: string } = {},
): SchemaColumn {
  const meta: ColumnMeta = { category: toCategory(classification) };

  if (data.description) meta.description = data.description;
  if (data.nullCount && data.nullCount > 0) meta.nullCount = data.nullCount;
  if (classification === 'categorical' && data.nDistinct != null) meta.nDistinct = data.nDistinct;
  if (classification === 'numeric') {
    if (data.min != null) meta.min = data.min;
    if (data.max != null) meta.max = data.max;
    if (data.avg != null) meta.avg = data.avg;
  }
  if (classification === 'temporal') {
    if (data.minDate) meta.minDate = data.minDate;
    if (data.maxDate) meta.maxDate = data.maxDate;
  }

  return { name: col.name, type: col.type, meta };
}

function plainColumn(col: { name: string; type: string }): SchemaColumn {
  return { name: col.name, type: col.type };
}

// ─── Identifier Quoting ──────────────────────────────────────────────────────

function qi(identifier: string, style: QuoteStyle = 'double'): string {
  return style === 'backtick' ? `\`${identifier}\`` : `"${identifier}"`;
}

function qualifiedTable(schema: string, table: string, style: QuoteStyle = 'double'): string {
  return `${qi(schema, style)}.${qi(table, style)}`;
}

// ─── PostgreSQL Strategy — O(1) queries ──────────────────────────────────────

const PG_FALLBACK_TO_GENERIC = false;

type EnrichedTable = { schema: string; table: string; columns: SchemaColumn[] };

async function profilePostgres(tables: TableEntry[], queryFn: QueryFn): Promise<EnrichedTable[]> {
  const schemaNames = [...new Set(tables.map(t => t.schema))];
  const schemaList = schemaNames.map(s => `'${escapeSql(s)}'`).join(', ');

  // 1. Batch row counts
  const rowCountMap = new Map<string, number>();
  try {
    const countResult = await queryFn(`
      SELECT n.nspname AS schema_name, c.relname AS table_name, c.reltuples::bigint AS row_count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN (${schemaList}) AND c.relkind IN ('r', 'p', 'v', 'm')
    `);
    for (const row of countResult.rows) {
      rowCountMap.set(`${row.schema_name}.${row.table_name}`, Number(row.row_count ?? 0));
    }
  } catch { /* continue */ }

  // 2. Batch pg_stats + descriptions
  const pgStatsMap = new Map<string, Record<string, unknown>>();
  try {
    const statsResult = await queryFn(`
      SELECT
        s.schemaname AS schema_name, s.tablename AS table_name, s.attname AS column_name,
        s.null_frac, s.n_distinct,
        s.most_common_vals::text AS most_common_vals, s.most_common_freqs::text AS most_common_freqs,
        s.histogram_bounds::text AS histogram_bounds, d.description
      FROM pg_stats s
      LEFT JOIN pg_class c ON c.relname = s.tablename
      LEFT JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = s.schemaname
      LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = s.attname
      LEFT JOIN pg_description d ON d.objoid = c.oid AND d.objsubid = a.attnum
      WHERE s.schemaname IN (${schemaList})
    `);
    for (const row of statsResult.rows) {
      pgStatsMap.set(`${row.schema_name}.${row.table_name}.${row.column_name}`, row);
    }
  } catch { /* empty → skip tables */ }

  const results: EnrichedTable[] = [];
  const fallbackTables: TableEntry[] = [];

  for (const { schema, table, columns } of tables) {
    const rowCount = rowCountMap.get(`${schema}.${table}`) ?? 0;
    const hasStats = columns.some(col => pgStatsMap.has(`${schema}.${table}.${col.name}`));
    if (!hasStats) {
      if (PG_FALLBACK_TO_GENERIC) fallbackTables.push({ schema, table, columns });
      continue;
    }

    const enrichedCols: SchemaColumn[] = [];
    for (const col of columns) {
      const pgStat = pgStatsMap.get(`${schema}.${table}.${col.name}`);
      if (!pgStat) { enrichedCols.push(plainColumn(col)); continue; }

      const nullFraction = Number(pgStat.null_frac ?? 0);
      const nullCount = Math.round(nullFraction * rowCount);
      let nDistinct: number;
      const raw = Number(pgStat.n_distinct ?? 0);
      nDistinct = raw < 0 ? Math.round(Math.abs(raw) * rowCount) : raw;
      const clamped = Math.min(nDistinct, rowCount);
      const classification = classifyColumn(col.type, clamped, rowCount);

      const sc = buildColumn(col, classification, {
        description: pgStat.description ? String(pgStat.description) : undefined,
        nullCount,
        nDistinct: clamped,
      });

      // Categorical top values from pg_stats (free)
      if (classification === 'categorical' && pgStat.most_common_vals) {
        sc.meta!.topValues = parsePgArray(String(pgStat.most_common_vals), String(pgStat.most_common_freqs ?? ''), rowCount);
      }

      // Min/max from histogram_bounds (free)
      if (pgStat.histogram_bounds) {
        const bounds = parsePgArrayLiteral(String(pgStat.histogram_bounds));
        if (bounds.length >= 2) {
          if (classification === 'numeric') {
            sc.meta!.min = parseNumeric(bounds[0]);
            sc.meta!.max = parseNumeric(bounds[bounds.length - 1]);
          } else if (classification === 'temporal') {
            sc.meta!.minDate = bounds[0];
            sc.meta!.maxDate = bounds[bounds.length - 1];
          }
        }
      }

      enrichedCols.push(sc);
    }

    results.push({ schema, table, columns: enrichedCols });
  }

  if (fallbackTables.length > 0) {
    results.push(...await profileGeneric(fallbackTables, queryFn, 'double'));
  }

  return results;
}

// ─── DuckDB Strategy — O(tables + categoricals) ─────────────────────────────

async function profileDuckDb(tables: TableEntry[], queryFn: QueryFn): Promise<EnrichedTable[]> {
  // Batch comments
  const commentMap = new Map<string, string>();
  try {
    const r = await queryFn(`SELECT schema_name, table_name, column_name, comment FROM duckdb_columns() WHERE comment IS NOT NULL`);
    for (const row of r.rows) commentMap.set(`${row.schema_name}.${row.table_name}.${row.column_name}`, String(row.comment));
  } catch { /* no comments */ }

  const results: EnrichedTable[] = [];

  for (const { schema, table, columns } of tables) {
    try {
      const summaryResult = await queryFn(`SUMMARIZE ${qualifiedTable(schema, table)}`);
      const summaryMap = new Map<string, Record<string, unknown>>();
      for (const row of summaryResult.rows) summaryMap.set(String(row.column_name), row);

      const firstSummary = summaryMap.values().next().value;
      const rowCount = Number(firstSummary?.count ?? 0);

      const categoricals: string[] = [];
      const enrichedCols: SchemaColumn[] = [];

      for (const col of columns) {
        const summary = summaryMap.get(col.name);
        if (!summary) { enrichedCols.push(plainColumn(col)); continue; }

        const nDistinct = Math.min(Number(summary.approx_unique ?? 0), rowCount);
        const nullCount = Math.round((Number(summary.null_percentage ?? 0) / 100) * rowCount);
        const classification = classifyColumn(col.type, nDistinct, rowCount);

        const sc = buildColumn(col, classification, {
          description: commentMap.get(`${schema}.${table}.${col.name}`),
          nullCount,
          nDistinct,
          min: classification === 'numeric' ? parseNumeric(summary.min) : undefined,
          max: classification === 'numeric' ? parseNumeric(summary.max) : undefined,
          avg: classification === 'numeric' ? parseNumeric(summary.avg) as number | undefined : undefined,
          minDate: classification === 'temporal' && summary.min != null ? String(summary.min) : undefined,
          maxDate: classification === 'temporal' && summary.max != null ? String(summary.max) : undefined,
        });

        if (classification === 'categorical') categoricals.push(col.name);
        enrichedCols.push(sc);
      }

      if (categoricals.length > 0) {
        await fetchTopValues(categoricals, schema, table, rowCount, enrichedCols, queryFn, 'double');
      }

      results.push({ schema, table, columns: enrichedCols });
    } catch { /* skip table */ }
  }

  return results;
}

// ─── BigQuery Strategy — metadata only (descriptions) ────────────────────────

const BQ_DEEP_SCAN = false;

async function profileBigQuery(tables: TableEntry[], queryFn: QueryFn): Promise<EnrichedTable[]> {
  const byDataset = new Map<string, TableEntry[]>();
  for (const t of tables) {
    const existing = byDataset.get(t.schema) ?? [];
    existing.push(t);
    byDataset.set(t.schema, existing);
  }

  // Batch descriptions per dataset
  const descMap = new Map<string, string>();
  for (const dataset of byDataset.keys()) {
    try {
      const r = await queryFn(`
        SELECT table_name, column_name, description
        FROM ${qi(dataset, 'backtick')}.INFORMATION_SCHEMA.COLUMN_FIELD_PATHS
        WHERE description IS NOT NULL
      `);
      for (const row of r.rows) descMap.set(`${dataset}.${row.table_name}.${row.column_name}`, String(row.description));
    } catch (e) {
      console.warn(`[statistics] Failed to fetch descriptions for dataset ${dataset}:`, e);
    }
  }

  const results: EnrichedTable[] = [];

  for (const { schema: dataset, table, columns } of tables) {
    try {
      if (!BQ_DEEP_SCAN) {
        // Metadata-only: add description to columns that have one
        const enrichedCols: SchemaColumn[] = columns.map(col => {
          const desc = descMap.get(`${dataset}.${table}.${col.name}`);
          return desc ? { name: col.name, type: col.type, meta: { description: desc } } : { name: col.name, type: col.type };
        });
        results.push({ schema: dataset, table, columns: enrichedCols });
        continue;
      }

      // Deep scan path (BQ_DEEP_SCAN = true)
      const BQ_TEMPORAL_TYPES = ['date', 'timestamp', 'time', 'datetime', 'interval'];
      const BQ_NUMERIC_TYPES = ['int64', 'float64', 'numeric', 'bignumeric', 'integer', 'float', 'decimal', 'double', 'real'];
      const BQ_STRING_TYPES = ['string', 'varchar', 'char', 'text'];
      const BQ_SKIP_TYPES = ['struct', 'record', 'array', 'geography', 'bytes', 'json'];

      const enrichedCols: SchemaColumn[] = [];
      const stringCols: Array<{ name: string; type: string }> = [];
      const numericCols: Array<{ name: string; type: string }> = [];

      for (const col of columns) {
        const t = col.type.toLowerCase();
        const desc = descMap.get(`${dataset}.${table}.${col.name}`);
        const cls: ColumnClassification =
          t.includes('bool') ? 'boolean' :
          BQ_TEMPORAL_TYPES.some(k => t.includes(k)) ? 'temporal' :
          t.includes('uuid') ? 'id_unique' :
          BQ_SKIP_TYPES.some(k => t.includes(k)) ? 'unknown' :
          BQ_NUMERIC_TYPES.some(k => t.includes(k)) ? 'numeric' :
          BQ_STRING_TYPES.some(k => t.includes(k)) ? 'text' : 'unknown';

        if (cls === 'numeric') numericCols.push(col);
        else if (cls === 'text' || cls === 'unknown') stringCols.push(col);
        else enrichedCols.push(buildColumn(col, cls, { description: desc }));
      }

      if (stringCols.length > 0 || numericCols.length > 0) {
        const aggParts: string[] = [];
        for (const col of stringCols) {
          const qc = qi(col.name, 'backtick');
          aggParts.push(`APPROX_COUNT_DISTINCT(${qc}) AS ${qi(`dist_${col.name}`, 'backtick')}`);
          aggParts.push(`COUNTIF(${qc} IS NULL) AS ${qi(`null_${col.name}`, 'backtick')}`);
        }
        for (const col of numericCols) {
          const qc = qi(col.name, 'backtick');
          aggParts.push(`MIN(${qc}) AS ${qi(`min_${col.name}`, 'backtick')}`);
          aggParts.push(`MAX(${qc}) AS ${qi(`max_${col.name}`, 'backtick')}`);
        }

        const aggResult = await queryFn(`SELECT ${aggParts.join(', ')} FROM ${qi(dataset, 'backtick')}.${qi(table, 'backtick')}`);
        const aggRow = aggResult.rows[0] ?? {};

        const categoricals: string[] = [];
        for (const col of stringCols) {
          const nd = Math.min(Number(aggRow[`dist_${col.name}`] ?? 0), 0); // rowCount unknown
          const nullCount = Number(aggRow[`null_${col.name}`] ?? 0);
          const cls2 = classifyColumn(col.type, nd, 0);
          const sc = buildColumn(col, cls2, {
            description: descMap.get(`${dataset}.${table}.${col.name}`), nullCount, nDistinct: nd,
          });
          if (cls2 === 'categorical') categoricals.push(col.name);
          enrichedCols.push(sc);
        }

        for (const col of numericCols) {
          enrichedCols.push(buildColumn(col, 'numeric', {
            description: descMap.get(`${dataset}.${table}.${col.name}`),
            min: parseNumeric(aggRow[`min_${col.name}`]),
            max: parseNumeric(aggRow[`max_${col.name}`]),
          }));
        }

        if (categoricals.length > 0) {
          await fetchTopValues(categoricals, dataset, table, 0, enrichedCols, queryFn, 'backtick');
        }
      }

      // Sort back to original order
      const colOrder = new Map(columns.map((c, i) => [c.name, i]));
      enrichedCols.sort((a, b) => (colOrder.get(a.name) ?? 0) - (colOrder.get(b.name) ?? 0));

      results.push({ schema: dataset, table, columns: enrichedCols });
    } catch { /* skip table */ }
  }

  return results;
}

// ─── Generic SQL Strategy ────────────────────────────────────────────────────

async function profileGeneric(tables: TableEntry[], queryFn: QueryFn, quoteStyle: QuoteStyle): Promise<EnrichedTable[]> {
  const results: EnrichedTable[] = [];

  for (const { schema, table, columns } of tables) {
    try {
      const limitedCols = columns.slice(0, MAX_COLUMNS_GENERIC);
      const parts: string[] = ['COUNT(*) AS _row_count'];
      for (const col of limitedCols) {
        const qc = qi(col.name, quoteStyle);
        parts.push(`COUNT(DISTINCT ${qc}) AS ${qi(`dist_${col.name}`, quoteStyle)}`);
        parts.push(`SUM(CASE WHEN ${qc} IS NULL THEN 1 ELSE 0 END) AS ${qi(`null_${col.name}`, quoteStyle)}`);
      }

      const aggResult = await queryFn(`SELECT ${parts.join(', ')} FROM ${qualifiedTable(schema, table, quoteStyle)}`);
      const aggRow = aggResult.rows[0] ?? {};
      const rowCount = Number(aggRow._row_count ?? 0);

      const categoricals: string[] = [];
      const enrichedCols: SchemaColumn[] = [];

      for (const col of limitedCols) {
        const nDistinct = Math.min(Number(aggRow[`dist_${col.name}`] ?? 0), rowCount);
        const nullCount = Number(aggRow[`null_${col.name}`] ?? 0);
        const classification = classifyColumn(col.type, nDistinct, rowCount);

        enrichedCols.push(buildColumn(col, classification, { nullCount, nDistinct }));
        if (classification === 'categorical') categoricals.push(col.name);
      }

      if (categoricals.length > 0) {
        await fetchTopValues(categoricals, schema, table, rowCount, enrichedCols, queryFn, quoteStyle);
      }

      results.push({ schema, table, columns: enrichedCols });
    } catch { /* skip table */ }
  }

  return results;
}

// ─── Shared Helpers ──────────────────────────────────────────────────────────

async function fetchTopValues(
  categoricals: string[], schema: string, table: string, rowCount: number,
  columns: SchemaColumn[], queryFn: QueryFn, quoteStyle: QuoteStyle,
): Promise<void> {
  for (const colName of categoricals) {
    try {
      const qc = qi(colName, quoteStyle);
      const result = await queryFn(
        `SELECT ${qc} AS val, COUNT(*) AS cnt FROM ${qualifiedTable(schema, table, quoteStyle)} WHERE ${qc} IS NOT NULL GROUP BY ${qc} ORDER BY cnt DESC LIMIT ${TOP_VALUES_LIMIT}`
      );
      const col = columns.find(c => c.name === colName);
      if (col?.meta) {
        col.meta.topValues = result.rows.map(row => ({
          value: (row.val as string | number | boolean) ?? '',
          count: Number(row.cnt ?? 0),
          fraction: rowCount > 0 ? Number(row.cnt ?? 0) / rowCount : 0,
        }));
      }
    } catch { /* skip */ }
  }
}

function parsePgArray(valsStr: string, freqsStr: string, rowCount: number): ColumnMeta['topValues'] {
  const vals = parsePgArrayLiteral(valsStr);
  const freqs = parsePgArrayLiteral(freqsStr).map(Number);
  return vals.slice(0, TOP_VALUES_LIMIT).map((val, i) => ({
    value: val,
    count: Math.round((freqs[i] ?? 0) * rowCount),
    fraction: freqs[i] ?? 0,
  }));
}

function parsePgArrayLiteral(str: string): string[] {
  if (!str || str === '{}') return [];
  const inner = str.replace(/^\{/, '').replace(/\}$/, '');
  const result: string[] = [];
  let current = '';
  let inQuote = false;
  for (const ch of inner) {
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ',' && !inQuote) { result.push(current); current = ''; }
    else current += ch;
  }
  result.push(current);
  return result;
}

function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}

function parseNumeric(val: unknown): number | undefined {
  if (val == null || val === '' || val === 'NULL') return undefined;
  const n = Number(val);
  return isNaN(n) ? undefined : n;
}
