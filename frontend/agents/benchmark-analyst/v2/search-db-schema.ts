// SearchDBSchemaV2: SQL queries against the synthetic catalog
// Catalog tables: connections, schemas, tables, columns, indexes, column_stats

import { Type, type Tool } from '@mariozechner/pi-ai';
import { MXTool, type ToolResponse } from '@/orchestrator/types';
import type { BenchmarkAnalystContext, ConnectionInfo } from '../types';
import { getOrCreateBenchmarkConnector } from '../shared-duckdb';
import type { QueryResult } from '@/lib/connections/base';
import { buildCatalog, type CatalogTables, type CatalogTable, type CatalogConnector } from './catalog';
import { storeHandle } from './handle-store';
import { computeResultStats, type ResultStats } from './result-stats';
import { runPromptPass, type PromptPassEntry } from './prompt-pass';
import { compressQueryResult, TOOL_MAX_LIMIT_CHARS } from '@/lib/api/compress-augmented';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { getModel, type Api, type Model } from '@/lib/llm/get-model';

const DEFAULT_INFO_MODEL = getModel('anthropic', 'claude-haiku-4-5-20251001');
let infoModel: Model<Api> = DEFAULT_INFO_MODEL;
export function setInfoModel(model: Model<Api>) { infoModel = model; }

const CatalogQuerySpec = Type.Object({
  query: Type.String({ description: 'SQL query against the catalog tables' }),
  label: Type.Optional(Type.String({ description: 'Short label for this query result' })),
});

const SearchDBSchemaParams = Type.Object({
  queries: Type.Array(CatalogQuerySpec, {
    description: 'One or more SQL queries against the catalog. Catalog tables: connections, schemas, tables, columns, indexes, column_stats.',
    minItems: 1,
  }),
  prompt: Type.Optional(Type.String({ description: 'Optional: if provided, an LLM summarizes all results and returns a single info string' })),
  sequential: Type.Optional(Type.Boolean({ description: 'If true, queries run sequentially (default: false, parallel)' })),
});

interface QueryResultEntry {
  preview?: string;
  handle?: string;
  stats?: ResultStats;
  error?: string;
}

interface SearchDBSchemaDetails {
  catalogBuilt: boolean;
  queryCount: number;
}

// Process-wide catalog cache
let catalogCache: CatalogTables | null = null;
let catalogDb: DuckDBInstance | null = null;
let catalogConn: DuckDBConnection | null = null;

async function getOrBuildCatalog(
  connections: ConnectionInfo[] | undefined,
): Promise<{ catalog: CatalogTables; conn: DuckDBConnection }> {
  if (catalogCache && catalogConn) {
    return { catalog: catalogCache, conn: catalogConn };
  }

  // Build connectors (paired with their dialect for profileDatabase dispatch)
  const connectors = new Map<string, CatalogConnector>();
  for (const entry of connections ?? []) {
    if (!entry.config) continue;
    const c = await getOrCreateBenchmarkConnector(entry.name, entry.dialect, entry.config);
    connectors.set(entry.name, { connector: c, dialect: entry.dialect });
  }

  // Build catalog
  const catalog = await buildCatalog(connectors);
  catalogCache = catalog;

  // Create in-memory DuckDB for catalog queries
  catalogDb = await DuckDBInstance.create(':memory:');
  catalogConn = await catalogDb.connect();

  // Create and populate catalog tables
  for (const [tableName, tableData] of Object.entries(catalog) as [string, CatalogTable][]) {
    if (tableData.rows.length === 0) {
      // Still create the table for schema discovery
      const colDefs = tableData.columns.map((col, i) => `"${col}" ${tableData.types[i]}`).join(', ');
      await catalogConn.run(`CREATE TABLE ${tableName} (${colDefs})`);
      continue;
    }

    const colDefs = tableData.columns.map((col, i) => `"${col}" ${tableData.types[i]}`).join(', ');
    await catalogConn.run(`CREATE TABLE ${tableName} (${colDefs})`);

    // Insert rows
    const colNames = tableData.columns.map((c) => `"${c}"`).join(', ');
    const valueRows = tableData.rows.map((row) => {
      const vals = tableData.columns.map((col) => {
        const v = row[col];
        if (v == null) return 'NULL';
        if (typeof v === 'number') return String(v);
        if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
        return `'${String(v).replace(/'/g, "''")}'`;
      });
      return `(${vals.join(', ')})`;
    }).join(',\n');

    await catalogConn.run(`INSERT INTO ${tableName} (${colNames}) VALUES ${valueRows}`);
  }

  return { catalog, conn: catalogConn };
}

export class SearchDBSchemaV2 extends MXTool<
  typeof SearchDBSchemaParams,
  BenchmarkAnalystContext,
  SearchDBSchemaDetails
> {
  static readonly schema: Tool<typeof SearchDBSchemaParams> = {
    name: 'SearchDBSchema',
    description: `Query the database schema catalog using SQL. The catalog is a set of 6 tables built from all connection schemas:

CATALOG TABLES:
- connections: connection_name
- schemas: connection_name, schema_name
- tables: connection_name, schema_name, table_name, row_count
- columns: connection_name, schema_name, table_name, column_name, data_type
- indexes: connection_name, schema_name, table_name, index_name, columns, is_unique
- column_stats: connection_name, schema_name, table_name, column_name, category, n_distinct, null_count, min_value, max_value, avg_value, min_date, max_date, top_values

EXAMPLES:
- List all tables: SELECT * FROM tables
- Find columns with 'user' in name: SELECT * FROM columns WHERE column_name LIKE '%user%'
- Find categorical columns: SELECT * FROM column_stats WHERE category = 'categorical'
- Find tables with indexes: SELECT DISTINCT table_name FROM indexes

Each query returns {preview, handle, stats}. If prompt is provided, an LLM processes all results and returns a single info summary.`,
    parameters: SearchDBSchemaParams,
  };

  async run(): Promise<ToolResponse<SearchDBSchemaDetails>> {
    const { queries, prompt, sequential = false } = this.parameters;

    // Build catalog if needed
    const { conn } = await getOrBuildCatalog(this.context.connections);

    // Execute queries
    type Collected = { entry: QueryResultEntry; raw: QueryResult | null; label: string };

    const executeQuery = async (
      spec: { query: string; label?: string },
      index: number,
    ): Promise<Collected> => {
      const label = spec.label ?? `Query ${index + 1}`;
      try {
        const result = await conn.run(spec.query);
        const cc = result.columnCount;
        const columns: string[] = [];
        const types: string[] = [];
        for (let i = 0; i < cc; i++) {
          columns.push(result.columnName(i));
          types.push(result.columnType(i).toString());
        }
        const rows = await result.getRowObjectsJS() as Record<string, unknown>[];
        const queryResult: QueryResult = { columns, types, rows, finalQuery: spec.query };

        const handle = storeHandle(queryResult);
        const compressed = compressQueryResult(queryResult, TOOL_MAX_LIMIT_CHARS);
        const stats = computeResultStats(queryResult, Math.min(rows.length, 100));

        return { entry: { preview: compressed.data, handle, stats }, raw: queryResult, label };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { entry: { error: msg }, raw: null, label };
      }
    };

    const collected: Collected[] = [];
    if (sequential) {
      for (let i = 0; i < queries.length; i++) {
        collected.push(await executeQuery(queries[i], i));
      }
    } else {
      collected.push(...await Promise.all(queries.map((spec, i) => executeQuery(spec, i))));
    }

    const results: QueryResultEntry[] = collected.map((c) => c.entry);
    const response: { results: QueryResultEntry[]; info?: string } = { results };

    // With a prompt, the lighter model re-ranks each preview's rows and writes
    // one cross-result `info` summary (see prompt-pass.ts).
    if (prompt) {
      const entries: PromptPassEntry[] = collected.map((c) =>
        c.raw
          ? { label: c.label, result: c.raw }
          : { label: c.label, error: c.entry.error ?? 'query failed' },
      );
      const { previews, info } = await runPromptPass(
        entries, prompt, infoModel, this.orchestrator, this.id,
      );
      previews.forEach((p, i) => {
        if (p !== undefined) results[i].preview = p;
      });
      response.info = info;
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(response) }],
      isError: false,
      details: { catalogBuilt: true, queryCount: queries.length },
    };
  }
}

// Reset catalog cache (for testing)
export function clearCatalogCache(): void {
  catalogCache = null;
  catalogConn = null;
  catalogDb = null;
}
