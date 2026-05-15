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
): Promise<CatalogTables> {
  const connectionsRows: Record<string, unknown>[] = [];
  const schemasRows: Record<string, unknown>[] = [];
  const tablesRows: Record<string, unknown>[] = [];
  const columnsRows: Record<string, unknown>[] = [];
  const indexesRows: Record<string, unknown>[] = [];
  const columnStatsRows: Record<string, unknown>[] = [];

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
  };
}

// ── Catalog store ──────────────────────────────────────────────────────────
// Process-wide cache for the built catalog + the DuckDB connection that
// holds it as queryable tables. Tests reset via `clearCatalogCache()`.

// eslint-disable-next-line no-restricted-syntax -- server-only; benchmark process singleton
let catalogCache: CatalogTables | null = null;
// eslint-disable-next-line no-restricted-syntax -- server-only; benchmark process singleton
let catalogDb: DuckDBInstance | null = null;
// eslint-disable-next-line no-restricted-syntax -- server-only; benchmark process singleton
let catalogConn: DuckDBConnection | null = null;
// Serialise concurrent builds. DoubleCheck spawns two sub-agents in
// parallel; both may call SearchDBSchema before the cache is warm. Without
// this lock both await `DuckDBInstance.create(':memory:')` independently,
// race to assign the module-level `catalogConn`, then BOTH run the
// CREATE TABLE loop on the surviving connection — the second loop dies with
// "Table with name 'schemas' already exists!". Same pattern as
// `getOrCreateShared` in shared-duckdb.ts.
// eslint-disable-next-line no-restricted-syntax -- server-only; benchmark process singleton
let catalogPromise: Promise<{ catalog: CatalogTables; conn: DuckDBConnection }> | null = null;

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
 * `columns` / `column_stats` view of the schema.
 */
export async function getCatalogStore(
  connections: ConnectionInfo[] | undefined,
): Promise<{ catalog: CatalogTables; conn: DuckDBConnection }> {
  if (catalogCache && catalogConn) {
    return { catalog: catalogCache, conn: catalogConn };
  }
  if (catalogPromise) return catalogPromise;

  catalogPromise = (async () => {
    // Build connectors paired with their dialect for profileDatabase dispatch.
    const connectors = new Map<string, CatalogConnector>();
    for (const entry of connections ?? []) {
      if (!entry.config) continue;
      const c = await getOrCreateBenchmarkConnector(entry.name, entry.dialect, entry.config);
      connectors.set(entry.name, { connector: c, dialect: entry.dialect });
    }

    const catalog = await buildCatalog(connectors);
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

    catalogCache = catalog;
    catalogDb = db;
    catalogConn = conn;
    return { catalog, conn };
  })().catch((err) => {
    catalogPromise = null; // let next caller retry
    throw err;
  });

  return catalogPromise;
}

/** Drop the cached catalog (test/reset helper). */
export function clearCatalogCache(): void {
  catalogCache = null;
  catalogConn = null;
  catalogDb = null;
  catalogPromise = null;
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
