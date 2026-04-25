import 'server-only';

import type { SchemaEntry } from './base';
import type { QueryResult } from './base';
import type {
  ColumnClassification,
  ColumnStatistics,
  TableStatistics,
  DatabaseStatistics,
  TopValue,
} from './statistics-types';

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_COLUMNS_GENERIC = 30;
const TOP_VALUES_LIMIT = 20;

// Cardinality thresholds
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

// ─── Entry Point ─────────────────────────────────────────────────────────────

export async function profileDatabase(
  connectorType: string,
  schema: SchemaEntry[],
  queryFn: QueryFn,
): Promise<DatabaseStatistics> {
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

  let tables: TableStatistics[];

  switch (connectorType) {
    case 'postgresql':
      tables = await profilePostgres(allTables, countedQueryFn);
      break;
    case 'duckdb':
    case 'csv':
    case 'google-sheets':
      tables = await profileDuckDb(allTables, countedQueryFn);
      break;
    case 'bigquery':
      tables = await profileBigQuery(allTables, countedQueryFn);
      break;
    default:
      tables = await profileGeneric(allTables, countedQueryFn, 'double');
      break;
  }

  return {
    tables,
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

  if (['date', 'timestamp', 'time', 'datetime', 'interval'].some(k => t.includes(k))) {
    return 'temporal';
  }

  if (t.includes('uuid')) return 'id_unique';

  const ratio = rowCount > 0 ? nDistinct / rowCount : 1;

  if (ratio >= ID_UNIQUE_RATIO_MIN) return 'id_unique';

  // Numeric types always stay numeric (even low-cardinality ones like status codes)
  if (['int', 'float', 'double', 'decimal', 'numeric', 'real', 'bigint', 'smallint', 'number', 'int64', 'float64'].some(k => t.includes(k))) {
    return 'numeric';
  }

  // Categorical: only text-like types with low cardinality
  if (nDistinct <= CATEGORICAL_ABSOLUTE_MAX || ratio <= CATEGORICAL_RATIO_MAX) {
    if (['text', 'varchar', 'character', 'string', 'char', 'enum'].some(k => t.includes(k))) {
      return 'categorical';
    }
  }

  if (['text', 'varchar', 'character', 'string', 'char'].some(k => t.includes(k))) {
    return 'text';
  }

  return 'unknown';
}

// ─── Identifier Quoting ──────────────────────────────────────────────────────

function qi(identifier: string, style: QuoteStyle = 'double'): string {
  if (style === 'backtick') return `\`${identifier}\``;
  return `"${identifier}"`;
}

function qualifiedTable(schema: string, table: string, style: QuoteStyle = 'double'): string {
  return `${qi(schema, style)}.${qi(table, style)}`;
}

// ─── PostgreSQL Strategy — O(1) queries ──────────────────────────────────────
//
// 2 queries total for the entire database:
//   1. pg_class → row counts for ALL tables
//   2. pg_stats + pg_description → column stats + descriptions for ALL columns
// Top values come free from most_common_vals (no extra queries).
// When fallback is enabled, tables without pg_stats (ANALYZE not run) use generic SQL.

const PG_FALLBACK_TO_GENERIC = false;

async function profilePostgres(
  tables: TableEntry[],
  queryFn: QueryFn,
): Promise<TableStatistics[]> {
  // Collect all schema names for filtering
  const schemaNames = [...new Set(tables.map(t => t.schema))];
  const schemaList = schemaNames.map(s => `'${escapeSql(s)}'`).join(', ');

  // 1. Batch row counts: one query for all tables
  const rowCountMap = new Map<string, number>(); // "schema.table" → count
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
  } catch {
    // If this fails, we'll get 0 row counts — still usable
  }

  // 2. Batch all column stats + descriptions: one query for all tables
  // Key: "schema.table.column" → stats row
  const pgStatsMap = new Map<string, Record<string, unknown>>();
  try {
    const statsResult = await queryFn(`
      SELECT
        s.schemaname AS schema_name,
        s.tablename AS table_name,
        s.attname AS column_name,
        s.null_frac,
        s.n_distinct,
        s.most_common_vals::text AS most_common_vals,
        s.most_common_freqs::text AS most_common_freqs,
        s.histogram_bounds::text AS histogram_bounds,
        d.description
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
  } catch {
    // Empty map → will fall back to generic per-table
  }

  // 3. Build results from the batched data
  const results: TableStatistics[] = [];
  const fallbackTables: TableEntry[] = [];

  for (const { schema, table, columns } of tables) {
    const rowCount = rowCountMap.get(`${schema}.${table}`) ?? 0;

    // If ANALYZE hasn't run for this table, skip or fall back
    const hasStats = columns.some(col => pgStatsMap.has(`${schema}.${table}.${col.name}`));
    if (!hasStats) {
      if (PG_FALLBACK_TO_GENERIC) fallbackTables.push({ schema, table, columns });
      continue;
    }

    const columnStats: ColumnStatistics[] = [];
    for (const col of columns) {
      const pgStat = pgStatsMap.get(`${schema}.${table}.${col.name}`);
      if (!pgStat) {
        columnStats.push(makeEmptyColumnStat(col.name, col.type));
        continue;
      }

      const nullFraction = Number(pgStat.null_frac ?? 0);
      const nullCount = Math.round(nullFraction * rowCount);

      // pg_stats n_distinct: positive = absolute count, negative = fraction of rows
      let nDistinct: number;
      const rawNDistinct = Number(pgStat.n_distinct ?? 0);
      if (rawNDistinct < 0) {
        nDistinct = Math.round(Math.abs(rawNDistinct) * rowCount);
      } else {
        nDistinct = rawNDistinct;
      }

      const clampedDistinct = Math.min(nDistinct, rowCount);
      const cardinalityRatio = rowCount > 0 ? clampedDistinct / rowCount : 1;
      const classification = classifyColumn(col.type, clampedDistinct, rowCount);

      const stat: ColumnStatistics = {
        name: col.name,
        type: col.type,
        classification,
        description: pgStat.description ? String(pgStat.description) : undefined,
        nullCount,
        nDistinct,
        cardinalityRatio,
      };

      // Parse most_common_vals for categoricals — free, no extra query
      if (classification === 'categorical' && pgStat.most_common_vals) {
        stat.topValues = parsePgArray(
          String(pgStat.most_common_vals),
          String(pgStat.most_common_freqs ?? ''),
          rowCount,
        );
      }

      // Extract min/max from histogram_bounds — free, already in pg_stats
      if (pgStat.histogram_bounds) {
        const bounds = parsePgArrayLiteral(String(pgStat.histogram_bounds));
        if (bounds.length >= 2) {
          const first = bounds[0];
          const last = bounds[bounds.length - 1];
          if (classification === 'numeric') {
            stat.min = parseNumeric(first);
            stat.max = parseNumeric(last);
          } else if (classification === 'temporal') {
            stat.minDate = first;
            stat.maxDate = last;
          }
        }
      }

      columnStats.push(stat);
    }

    results.push({ schema, table, rowCount, columns: columnStats });
  }

  // Fallback: tables where ANALYZE hasn't run → use generic SQL (expensive)
  if (fallbackTables.length > 0) {
    const fallback = await profileGeneric(fallbackTables, queryFn, 'double');
    results.push(...fallback);
  }

  return results;
}

// ─── DuckDB Strategy — O(tables + total_categoricals) ────────────────────────
//
// 1 query for all column comments (batched).
// 1 SUMMARIZE per table (can't batch).
// 1 query per categorical column for top values (unavoidable).

async function profileDuckDb(
  tables: TableEntry[],
  queryFn: QueryFn,
): Promise<TableStatistics[]> {
  // 1. Batch all column comments in one query
  const commentMap = new Map<string, string>(); // "schema.table.column" → comment
  try {
    const commentsResult = await queryFn(`
      SELECT schema_name, table_name, column_name, comment
      FROM duckdb_columns()
      WHERE comment IS NOT NULL
    `);
    for (const row of commentsResult.rows) {
      commentMap.set(`${row.schema_name}.${row.table_name}.${row.column_name}`, String(row.comment));
    }
  } catch {
    // No comments available — continue without
  }

  // 2. SUMMARIZE per table + top values for categoricals
  const results: TableStatistics[] = [];

  for (const { schema, table, columns } of tables) {
    try {
      const summaryResult = await queryFn(
        `SUMMARIZE ${qualifiedTable(schema, table)}`
      );

      // Parse SUMMARIZE output: column_name, column_type, min, max, approx_unique, avg, std, q25, q50, q75, count, null_percentage
      const summaryMap = new Map<string, Record<string, unknown>>();
      for (const row of summaryResult.rows) {
        summaryMap.set(String(row.column_name), row);
      }

      const firstSummary = summaryMap.values().next().value;
      const rowCount = Number(firstSummary?.count ?? 0);

      const categoricals: string[] = [];
      const columnStats: ColumnStatistics[] = [];

      for (const col of columns) {
        const summary = summaryMap.get(col.name);
        if (!summary) {
          columnStats.push(makeEmptyColumnStat(col.name, col.type));
          continue;
        }

        const nDistinct = Number(summary.approx_unique ?? 0);
        const nullPercentage = Number(summary.null_percentage ?? 0);
        const nullFraction = nullPercentage / 100;
        const nullCount = Math.round(nullFraction * rowCount);
        const clampedDistinct = Math.min(nDistinct, rowCount);
      const cardinalityRatio = rowCount > 0 ? clampedDistinct / rowCount : 1;
        const classification = classifyColumn(col.type, clampedDistinct, rowCount);

        const stat: ColumnStatistics = {
          name: col.name,
          type: col.type,
          classification,
          description: commentMap.get(`${schema}.${table}.${col.name}`),
          nullCount,
          nDistinct: clampedDistinct,
          cardinalityRatio,
        };

        if (classification === 'numeric') {
          stat.min = parseNumeric(summary.min);
          stat.max = parseNumeric(summary.max);
          stat.avg = parseNumeric(summary.avg) as number | undefined;
        } else if (classification === 'temporal') {
          stat.minDate = summary.min != null ? String(summary.min) : undefined;
          stat.maxDate = summary.max != null ? String(summary.max) : undefined;
        } else if (classification === 'categorical') {
          categoricals.push(col.name);
        }

        columnStats.push(stat);
      }

      // Top values for categoricals — 1 query per column (unavoidable)
      if (categoricals.length > 0) {
        await fetchTopValues(categoricals, schema, table, rowCount, columnStats, queryFn, 'double');
      }

      results.push({ schema, table, rowCount, columns: columnStats });
    } catch {
      // Skip tables we can't profile
    }
  }

  return results;
}

// ─── BigQuery Strategy — O(datasets + tables + total_categoricals) ───────────
//
// 1 query per dataset for row counts (__TABLES__) — batched.
// 1 query per dataset for column descriptions (INFORMATION_SCHEMA) — batched.
// 1 aggregation per table (APPROX_COUNT_DISTINCT — unavoidable).
// 1 query per categorical column for top values (unavoidable).

async function profileBigQuery(
  tables: TableEntry[],
  queryFn: QueryFn,
): Promise<TableStatistics[]> {
  // Group tables by dataset
  const byDataset = new Map<string, TableEntry[]>();
  for (const t of tables) {
    const existing = byDataset.get(t.schema) ?? [];
    existing.push(t);
    byDataset.set(t.schema, existing);
  }

  // 1. Batch row counts and descriptions per dataset
  const rowCountMap = new Map<string, number>();   // "dataset.table" → count
  const descMap = new Map<string, string>();        // "dataset.table.column" → description

  for (const dataset of byDataset.keys()) {
    try {
      // Row counts — one query per dataset (free metadata)
      const countResult = await queryFn(
        `SELECT table_id, row_count FROM ${qi(dataset, 'backtick')}.__TABLES__`
      );
      for (const row of countResult.rows) {
        rowCountMap.set(`${dataset}.${row.table_id}`, Number(row.row_count ?? 0));
      }
    } catch {
      // Continue without row counts for this dataset
    }

    try {
      // Column descriptions — one query per dataset (free metadata)
      const descResult = await queryFn(`
        SELECT table_name, column_name, description
        FROM ${qi(dataset, 'backtick')}.INFORMATION_SCHEMA.COLUMN_FIELD_PATHS
        WHERE description IS NOT NULL
      `);
      for (const row of descResult.rows) {
        descMap.set(`${dataset}.${row.table_name}.${row.column_name}`, String(row.description));
      }
    } catch {
      // Continue without descriptions for this dataset
    }
  }

  // 2. Per-table aggregation + top values
  const results: TableStatistics[] = [];

  for (const { schema: dataset, table, columns } of tables) {
    try {
      const limitedCols = columns.slice(0, MAX_COLUMNS_GENERIC);
      const rowCount = rowCountMap.get(`${dataset}.${table}`) ?? 0;

      // Single aggregation: APPROX_COUNT_DISTINCT + COUNTIF(IS NULL)
      const aggParts: string[] = [];
      for (const col of limitedCols) {
        const qc = qi(col.name, 'backtick');
        aggParts.push(`APPROX_COUNT_DISTINCT(${qc}) AS ${qi(`dist_${col.name}`, 'backtick')}`);
        aggParts.push(`COUNTIF(${qc} IS NULL) AS ${qi(`null_${col.name}`, 'backtick')}`);
      }
      const aggResult = await queryFn(
        `SELECT ${aggParts.join(', ')} FROM ${qi(dataset, 'backtick')}.${qi(table, 'backtick')}`
      );
      const aggRow = aggResult.rows[0] ?? {};

      const categoricals: string[] = [];
      const columnStats: ColumnStatistics[] = [];

      for (const col of limitedCols) {
        const nDistinct = Number(aggRow[`dist_${col.name}`] ?? 0);
        const nullCount = Number(aggRow[`null_${col.name}`] ?? 0);
        const clampedDistinct = Math.min(nDistinct, rowCount);
      const cardinalityRatio = rowCount > 0 ? clampedDistinct / rowCount : 1;
        const classification = classifyColumn(col.type, clampedDistinct, rowCount);

        const stat: ColumnStatistics = {
          name: col.name,
          type: col.type,
          classification,
          description: descMap.get(`${dataset}.${table}.${col.name}`),
          nullCount,
          nDistinct: clampedDistinct,
          cardinalityRatio,
        };

        if (classification === 'categorical') {
          categoricals.push(col.name);
        }

        columnStats.push(stat);
      }

      if (categoricals.length > 0) {
        await fetchTopValues(categoricals, dataset, table, rowCount, columnStats, queryFn, 'backtick');
      }

      results.push({ schema: dataset, table, rowCount, columns: columnStats });
    } catch {
      // Skip tables we can't profile
    }
  }

  return results;
}

// ─── Generic SQL Strategy (Athena, etc.) — O(tables + total_categoricals) ────
//
// 1 aggregation per table: COUNT(*), COUNT(DISTINCT col), null counts.
// 1 query per categorical column for top values.

async function profileGeneric(
  tables: TableEntry[],
  queryFn: QueryFn,
  quoteStyle: QuoteStyle,
): Promise<TableStatistics[]> {
  const results: TableStatistics[] = [];

  for (const { schema, table, columns } of tables) {
    try {
      const limitedCols = columns.slice(0, MAX_COLUMNS_GENERIC);

      const parts: string[] = ['COUNT(*) AS _row_count'];
      for (const col of limitedCols) {
        const qc = qi(col.name, quoteStyle);
        parts.push(`COUNT(DISTINCT ${qc}) AS ${qi(`dist_${col.name}`, quoteStyle)}`);
        parts.push(`SUM(CASE WHEN ${qc} IS NULL THEN 1 ELSE 0 END) AS ${qi(`null_${col.name}`, quoteStyle)}`);
      }

      const aggResult = await queryFn(
        `SELECT ${parts.join(', ')} FROM ${qualifiedTable(schema, table, quoteStyle)}`
      );
      const aggRow = aggResult.rows[0] ?? {};
      const rowCount = Number(aggRow._row_count ?? 0);

      const categoricals: string[] = [];
      const columnStats: ColumnStatistics[] = [];

      for (const col of limitedCols) {
        const nDistinct = Number(aggRow[`dist_${col.name}`] ?? 0);
        const nullCount = Number(aggRow[`null_${col.name}`] ?? 0);
        const clampedDistinct = Math.min(nDistinct, rowCount);
      const cardinalityRatio = rowCount > 0 ? clampedDistinct / rowCount : 1;
        const classification = classifyColumn(col.type, clampedDistinct, rowCount);

        const stat: ColumnStatistics = {
          name: col.name,
          type: col.type,
          classification,
          nullCount,
          nDistinct: clampedDistinct,
          cardinalityRatio,
        };

        if (classification === 'categorical') {
          categoricals.push(col.name);
        }

        columnStats.push(stat);
      }

      if (categoricals.length > 0) {
        await fetchTopValues(categoricals, schema, table, rowCount, columnStats, queryFn, quoteStyle);
      }

      results.push({ schema, table, rowCount, columns: columnStats });
    } catch {
      // Skip tables we can't profile
    }
  }

  return results;
}

// ─── Shared Helpers ──────────────────────────────────────────────────────────

/** Fetch top values for categorical columns — 1 query per column */
async function fetchTopValues(
  categoricals: string[],
  schema: string,
  table: string,
  rowCount: number,
  columnStats: ColumnStatistics[],
  queryFn: QueryFn,
  quoteStyle: QuoteStyle,
): Promise<void> {
  for (const colName of categoricals) {
    try {
      const qc = qi(colName, quoteStyle);
      const result = await queryFn(
        `SELECT ${qc} AS val, COUNT(*) AS cnt FROM ${qualifiedTable(schema, table, quoteStyle)} WHERE ${qc} IS NOT NULL GROUP BY ${qc} ORDER BY cnt DESC LIMIT ${TOP_VALUES_LIMIT}`
      );

      const topValues: TopValue[] = result.rows.map(row => ({
        value: (row.val as string | number | boolean) ?? '',
        count: Number(row.cnt ?? 0),
        fraction: rowCount > 0 ? Number(row.cnt ?? 0) / rowCount : 0,
      }));

      const stat = columnStats.find(s => s.name === colName);
      if (stat) stat.topValues = topValues;
    } catch {
      // Skip if we can't fetch top values for this column
    }
  }
}

/** Parse PostgreSQL array literals like {val1,val2,val3} */
function parsePgArray(valsStr: string, freqsStr: string, rowCount: number): TopValue[] {
  const vals = parsePgArrayLiteral(valsStr);
  const freqs = parsePgArrayLiteral(freqsStr).map(Number);

  const topValues: TopValue[] = [];
  for (let i = 0; i < vals.length && i < TOP_VALUES_LIMIT; i++) {
    const fraction = freqs[i] ?? 0;
    topValues.push({
      value: vals[i],
      count: Math.round(fraction * rowCount),
      fraction,
    });
  }
  return topValues;
}

/** Parse a PostgreSQL text array literal {a,b,"c d"} into string[] */
function parsePgArrayLiteral(str: string): string[] {
  if (!str || str === '{}') return [];
  const inner = str.replace(/^\{/, '').replace(/\}$/, '');
  const result: string[] = [];
  let current = '';
  let inQuote = false;
  for (const ch of inner) {
    if (ch === '"') {
      inQuote = !inQuote;
    } else if (ch === ',' && !inQuote) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}

function makeEmptyColumnStat(name: string, type: string): ColumnStatistics {
  return {
    name,
    type,
    classification: 'unknown',
    nullCount: 0,
    nDistinct: 0,
    cardinalityRatio: 0,
  };
}

function parseNumeric(val: unknown): number | undefined {
  if (val == null || val === '' || val === 'NULL') return undefined;
  const n = Number(val);
  return isNaN(n) ? undefined : n;
}
