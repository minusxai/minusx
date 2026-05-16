// Catalog builder + store: creates the 6 synthetic catalog tables from
// connection schemas and exposes them as queryable DuckDB tables (SQL over
// metadata, as opposed to SQL over data). Used by both SearchDBSchema (the
// LLM-facing catalog SQL tool) and Explore (which queries `columns` /
// `column_stats` to find searchable text columns).

import 'server-only';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import type { SchemaEntry, NodeConnector, QueryResult, ColumnMeta } from '@/lib/connections/base';
import { profileDatabase } from '@/lib/connections/statistics-engine';
import { getOrCreateBenchmarkConnector } from '../shared-duckdb';
import type { ConnectionInfo } from '../types';
import { buildSampleSql } from './sample-sql';
import {
  buildPromptPassContext,
  extractText,
  parsePromptPassResponse,
  applyRerank,
  pickPromptPassInfo,
  PROMPT_ROW_CAP,
  type PromptPassCallLLM,
  type PromptPassEntry,
} from './prompt-pass';
import type { Api, Model } from '@/lib/llm/get-model';

export interface CatalogTable {
  columns: string[];
  types: string[];
  rows: Record<string, unknown>[];
}

export interface CatalogTables {
  connections: CatalogTable;
  schemas: CatalogTable;
  tables: CatalogTable;
  columns: CatalogTable;
  indexes: CatalogTable;
  column_stats: CatalogTable;
  /** Lighter-model-picked diverse/representative sample rows per table. */
  sample_rows: CatalogTable;
  /** One free-text shape note per table from the lighter model. */
  sample_notes: CatalogTable;
}

/**
 * Sample-build config. When passed to `buildCatalog`, each table gets:
 *   1. A `poolSize`-row random sample pulled via `connector.query` (dialect-
 *      specific `USING SAMPLE` / `TABLESAMPLE` / `$sample`).
 *   2. A lighter-model pass over the pool (cells truncated to
 *      `truncateCellChars` for LLM input only) returning `pickK` row picks
 *      plus a 1–3 sentence shape/quirk note (`info`).
 * Picks go into `catalog.sample_rows`; notes go into `catalog.sample_notes`.
 * Per-table failures are logged + skipped — catalog still builds.
 */
export interface SampleConfig {
  /** Free-text instruction passed to the lighter model. Used to steer
   *  per-slot behaviour: `'representative'` for `'default' / 'agent-a'`,
   *  `'edge cases / rare variants'` for `'agent-b'`. */
  slotPrompt: string;
  callLLM: PromptPassCallLLM;
  model: Model<Api>;
  /** Rows to pull from the source connector per table. Default 100. */
  poolSize?: number;
  /** Rows the lighter model is asked to pick out of the pool. Default 10. */
  pickK?: number;
  /** Max chars per cell shown to the LLM (full rows preserved in storage). Default 1000. */
  truncateCellChars?: number;
}

/** A connector plus its dialect — the dialect drives `profileDatabase` dispatch. */
export interface CatalogConnector {
  connector: NodeConnector;
  dialect: string;
}

/**
 * Build the synthetic catalog from all connectors.
 * Each connector's schema is fetched and optionally enriched via profileDatabase
 * using that connection's real dialect (so e.g. Mongo connections pass through
 * rather than having DuckDB-style profiling SQL run against them).
 */
export async function buildCatalog(
  connectors: Map<string, CatalogConnector>,
  sampleConfig?: SampleConfig,
): Promise<CatalogTables> {
  const connectionsRows: Record<string, unknown>[] = [];
  const schemasRows: Record<string, unknown>[] = [];
  const tablesRows: Record<string, unknown>[] = [];
  const columnsRows: Record<string, unknown>[] = [];
  const indexesRows: Record<string, unknown>[] = [];
  const columnStatsRows: Record<string, unknown>[] = [];
  const sampleRowsRows: Record<string, unknown>[] = [];
  const sampleNotesRows: Record<string, unknown>[] = [];

  for (const [connName, { connector, dialect }] of connectors) {
    connectionsRows.push({ connection_name: connName });

    let schema: SchemaEntry[];
    try {
      schema = await connector.getSchema();
    } catch (err) {
      console.warn(`Failed to get schema for ${connName}:`, err);
      continue;
    }

    // Check if schema is already enriched (has meta on columns)
    const needsEnrichment = schema.some((s) =>
      s.tables.some((t) =>
        t.columns.some((c) => !c.meta),
      ),
    );

    if (needsEnrichment) {
      try {
        // `profileDatabase` dispatches on the connector type — pass the real
        // dialect so SQL profiling strategies only run against SQL connectors
        // (Mongo etc. fall through to pass-through, no failed queries).
        const profile = await profileDatabase(
          dialect,
          schema,
          async (sql) => connector.query(sql),
        );
        schema = profile.schema;
      } catch (err) {
        console.warn(`Failed to profile ${connName}:`, err);
        // Continue with unenriched schema
      }
    }

    for (const schemaEntry of schema) {
      schemasRows.push({
        connection_name: connName,
        schema_name: schemaEntry.schema,
      });

      for (const table of schemaEntry.tables) {
        tablesRows.push({
          connection_name: connName,
          schema_name: schemaEntry.schema,
          table_name: table.table,
          row_count: null, // Not available from SchemaTable
        });

        for (const col of table.columns) {
          columnsRows.push({
            connection_name: connName,
            schema_name: schemaEntry.schema,
            table_name: table.table,
            column_name: col.name,
            data_type: col.type,
          });

          // Column stats from meta
          if (col.meta) {
            columnStatsRows.push(buildColumnStatsRow(
              connName,
              schemaEntry.schema,
              table.table,
              col.name,
              col.meta,
            ));
          }
        }

        // Indexes
        for (const idx of table.indexes ?? []) {
          indexesRows.push({
            connection_name: connName,
            schema_name: schemaEntry.schema,
            table_name: table.table,
            index_name: idx.name,
            columns: idx.columns.join(', '),
            is_unique: idx.unique,
          });
        }

        // Sample rows + shape note (when sampleConfig present). Failures
        // are per-table — one bad table doesn't break the catalog build.
        if (sampleConfig) {
          try {
            const built = await buildSampleForTable(
              connName, schemaEntry.schema, table.table,
              dialect, connector, sampleConfig,
            );
            sampleRowsRows.push(...built.rows);
            if (built.note !== null) sampleNotesRows.push(built.note);
          } catch (err) {
            console.warn(`Sample build failed for ${connName}.${table.table}:`, err);
          }
        }
      }
    }
  }

  return {
    connections: {
      columns: ['connection_name'],
      types: ['VARCHAR'],
      rows: connectionsRows,
    },
    schemas: {
      columns: ['connection_name', 'schema_name'],
      types: ['VARCHAR', 'VARCHAR'],
      rows: schemasRows,
    },
    tables: {
      columns: ['connection_name', 'schema_name', 'table_name', 'row_count'],
      types: ['VARCHAR', 'VARCHAR', 'VARCHAR', 'BIGINT'],
      rows: tablesRows,
    },
    columns: {
      columns: ['connection_name', 'schema_name', 'table_name', 'column_name', 'data_type'],
      types: ['VARCHAR', 'VARCHAR', 'VARCHAR', 'VARCHAR', 'VARCHAR'],
      rows: columnsRows,
    },
    indexes: {
      columns: ['connection_name', 'schema_name', 'table_name', 'index_name', 'columns', 'is_unique'],
      types: ['VARCHAR', 'VARCHAR', 'VARCHAR', 'VARCHAR', 'VARCHAR', 'BOOLEAN'],
      rows: indexesRows,
    },
    column_stats: {
      columns: [
        'connection_name', 'schema_name', 'table_name', 'column_name',
        'category', 'n_distinct', 'null_count',
        'min_value', 'max_value', 'avg_value',
        'min_date', 'max_date',
        'top_values',
      ],
      types: [
        'VARCHAR', 'VARCHAR', 'VARCHAR', 'VARCHAR',
        'VARCHAR', 'BIGINT', 'BIGINT',
        'DOUBLE', 'DOUBLE', 'DOUBLE',
        'VARCHAR', 'VARCHAR',
        'VARCHAR',
      ],
      rows: columnStatsRows,
    },
    sample_rows: {
      columns: ['connection_name', 'schema_name', 'table_name', 'row_index', 'row_json'],
      types: ['VARCHAR', 'VARCHAR', 'VARCHAR', 'INTEGER', 'VARCHAR'],
      rows: sampleRowsRows,
    },
    sample_notes: {
      columns: ['connection_name', 'schema_name', 'table_name', 'notes'],
      types: ['VARCHAR', 'VARCHAR', 'VARCHAR', 'VARCHAR'],
      rows: sampleNotesRows,
    },
  };
}

// ── Sample builder ─────────────────────────────────────────────────────────
// Pulls a random pool from the source DB, asks the lighter model to pick a
// representative/diverse subset + write a shape note. Returns the catalog
// rows to splice into `sample_rows` + `sample_notes`. Per-table failures
// throw (caller skips this table).

async function buildSampleForTable(
  connName: string,
  schemaName: string,
  tableName: string,
  dialect: string,
  connector: NodeConnector,
  config: SampleConfig,
): Promise<{ rows: Record<string, unknown>[]; note: Record<string, unknown> | null }> {
  const poolSize = config.poolSize ?? 100;
  const pickK = config.pickK ?? 10;
  const truncateCellChars = config.truncateCellChars ?? 1000;

  const sql = buildSampleSql(dialect, schemaName, tableName, poolSize);
  const pool = await connector.query(sql);
  if (pool.rows.length === 0) {
    return { rows: [], note: null };
  }

  // Truncate big cells for LLM input only (storage keeps full content).
  const truncatedRows = pool.rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const c of pool.columns) {
      const v = row[c];
      out[c] = typeof v === 'string' && v.length > truncateCellChars
        ? `${v.slice(0, truncateCellChars)}...[truncated]`
        : v;
    }
    return out;
  });

  const entry: PromptPassEntry = {
    label: 'sample-pool',
    result: { ...pool, rows: truncatedRows },
  };
  const llmCtx = buildPromptPassContext([entry], config.slotPrompt, {});
  const text = extractText(await config.callLLM(config.model, llmCtx));
  const parsed = parsePromptPassResponse(text);

  const shown = pool.rows.slice(0, PROMPT_ROW_CAP);
  const reranked = applyRerank(shown, parsed?.results?.[0]?.rerankedIds);
  const picked = reranked.slice(0, pickK);
  const info = pickPromptPassInfo(parsed, text);

  const rows = picked.map((row, i) => ({
    connection_name: connName,
    schema_name: schemaName,
    table_name: tableName,
    row_index: i,
    row_json: JSON.stringify(row),
  }));
  const note = {
    connection_name: connName,
    schema_name: schemaName,
    table_name: tableName,
    notes: info,
  };
  return { rows, note };
}

// ── Catalog store ──────────────────────────────────────────────────────────
// Per-key cache of built catalogs. `cacheKey` selects which catalog
// instance a caller reads — single-agent runs use `'default'`; DoubleCheck
// sub-agents pass `'agent-a'` / `'agent-b'` so per-slot sample tables can
// differ without per-query filtering. Each key owns an independent DuckDB
// instance (catalog tables are small; cost is negligible).
//
// The `Map<key, Promise<...>>` doubles as the build-race lock that
// previously lived in a separate `catalogPromise` singleton: concurrent
// callers for the same key share one in-flight promise instead of racing
// `DuckDBInstance.create(':memory:')` and clobbering each other's
// CREATE TABLE.

// eslint-disable-next-line no-restricted-syntax -- server-only; benchmark process singleton
const catalogStores = new Map<string, Promise<{ catalog: CatalogTables; conn: DuckDBConnection }>>();

function escapeCatalogValue(v: unknown): string {
  if (v == null) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'bigint') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return `'${String(v).replace(/'/g, "''")}'`;
}

/**
 * Build (or return cached) the catalog plus a DuckDB connection over its
 * tables. Both `SearchDBSchema` and `Explore` use this — they share the same
 * `columns` / `column_stats` view of the schema. `cacheKey` selects which
 * per-slot instance to use; defaults to `'default'` for single-agent runs.
 * `sampleConfig` is forwarded to `buildCatalog` to populate
 * `sample_rows` / `sample_notes` via the lighter model; omit it to skip
 * sample-table building (those tables stay empty).
 */
export async function getCatalogStore(
  connections: ConnectionInfo[] | undefined,
  cacheKey: string = 'default',
  sampleConfig?: SampleConfig,
  datasetKey?: string,
): Promise<{ catalog: CatalogTables; conn: DuckDBConnection }> {
  // Compose the cache key with the dataset namespace so two parallel
  // benchmark datasets each get their own per-slot catalog instance
  // (matches the shared-duckdb ATTACH namespacing).
  const composedKey = datasetKey ? `${datasetKey}::${cacheKey}` : cacheKey;
  const existing = catalogStores.get(composedKey);
  if (existing) return existing;

  const built = (async () => {
    // Build connectors paired with their dialect for profileDatabase dispatch.
    const connectors = new Map<string, CatalogConnector>();
    for (const entry of connections ?? []) {
      if (!entry.config) continue;
      const c = await getOrCreateBenchmarkConnector(
        entry.name, entry.dialect, entry.config, { datasetKey },
      );
      connectors.set(entry.name, { connector: c, dialect: entry.dialect });
    }

    const catalog = await buildCatalog(connectors, sampleConfig);
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();

    for (const [tableName, tableData] of Object.entries(catalog) as [string, CatalogTable][]) {
      const colDefs = tableData.columns
        .map((col, i) => `"${col}" ${tableData.types[i]}`)
        .join(', ');
      await conn.run(`CREATE TABLE ${tableName} (${colDefs})`);
      if (tableData.rows.length === 0) continue;
      const colNames = tableData.columns.map((c) => `"${c}"`).join(', ');
      const valueRows = tableData.rows
        .map((row) => `(${tableData.columns.map((col) => escapeCatalogValue(row[col])).join(', ')})`)
        .join(',\n');
      await conn.run(`INSERT INTO ${tableName} (${colNames}) VALUES ${valueRows}`);
    }

    // Keep the DuckDBInstance binding alive — `conn` references it.
    void db;

    return { catalog, conn };
  })().catch((err) => {
    catalogStores.delete(composedKey); // let next caller retry
    throw err;
  });

  catalogStores.set(composedKey, built);
  return built;
}

/** Drop every cached catalog (test/reset helper). */
export function clearCatalogCache(): void {
  catalogStores.clear();
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function buildColumnStatsRow(
  connName: string,
  schemaName: string,
  tableName: string,
  columnName: string,
  meta: ColumnMeta,
): Record<string, unknown> {
  return {
    connection_name: connName,
    schema_name: schemaName,
    table_name: tableName,
    column_name: columnName,
    category: meta.category,
    n_distinct: meta.nDistinct,
    null_count: meta.nullCount,
    min_value: meta.min,
    max_value: meta.max,
    avg_value: meta.avg,
    min_date: meta.minDate,
    max_date: meta.maxDate,
    top_values: meta.topValues ? JSON.stringify(meta.topValues) : null,
  };
}
