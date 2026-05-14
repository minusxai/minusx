/**
 * SearchDBSchemaV2: SQL queries over a synthetic catalog.
 * Catalog tables: connections, schemas, tables, columns, indexes, column_stats.
 */

import { Type, type Tool } from '@mariozechner/pi-ai';
import type { Context, AssistantMessage, TextContent } from '@mariozechner/pi-ai';
import { MXTool, type ToolResponse } from '@/orchestrator/types';
import type { BenchmarkAnalystContext } from '../types';
import { buildCatalog, catalogToMarkdown, type CatalogData } from './catalog';
import { storeHandle } from './handle-store';
import { computeResultStats, type ResultStats } from './result-stats';
import { compressQueryResult, TOOL_MAX_LIMIT_CHARS } from '@/lib/api/compress-augmented';
import { getOrCreateBenchmarkConnector } from '../shared-duckdb';
import type { QueryResult, SchemaEntry } from '@/lib/connections/base';
import { getModel } from '@/lib/llm/get-model';
import type { Api, Model } from '@/lib/llm/get-model';

const DEFAULT_SEARCH_MODEL = getModel('anthropic', 'claude-haiku-4-5-20251001');
let searchModel: Model<Api> = DEFAULT_SEARCH_MODEL;
export function setSearchModel(model: Model<Api>) { searchModel = model; }

const QueryItem = Type.Object({
  query: Type.String({ description: 'SQL query against the catalog tables' }),
  label: Type.Optional(Type.String({ description: 'Short label for this query result' })),
});

const SearchDBSchemaV2Params = Type.Object({
  queries: Type.Array(QueryItem, {
    description: 'SQL queries to run against the catalog. Each query produces a separate result with a handle.',
    minItems: 1,
  }),
  prompt: Type.Optional(Type.String({
    description: 'Optional prompt for a lightweight LLM to synthesize findings across all query results. Used for complex analysis or summarization.',
  })),
  sequential: Type.Optional(Type.Boolean({
    description: 'If true, run queries sequentially (for $label.col references between catalog queries). Default false (parallel).',
    default: false,
  })),
});

interface QueryResultItem {
  label?: string;
  preview: string;
  handle: string;
  stats: ResultStats;
}

interface ErrorResultItem {
  label?: string;
  error: string;
}

interface SearchDBSchemaV2Details extends Record<string, unknown> {
  queryCount: number;
  successCount: number;
  errorCount: number;
}

export class SearchDBSchemaV2 extends MXTool<
  typeof SearchDBSchemaV2Params,
  BenchmarkAnalystContext,
  SearchDBSchemaV2Details
> {
  static readonly schema: Tool<typeof SearchDBSchemaV2Params> = {
    name: 'SearchDBSchema',
    description: `Search database metadata via SQL over a synthetic catalog. Use to discover tables, columns, and statistics before querying data.

Catalog tables:
- connections: name, dialect, description
- schemas: connection, schema_name
- tables: connection, schema_name, table_name, row_count
- columns: connection, schema_name, table_name, column_name, data_type, ordinal_position
- indexes: connection, schema_name, table_name, index_name, columns, is_unique
- column_stats: connection, schema_name, table_name, column_name, category, description, null_count, n_distinct, min, max, avg, min_date, max_date, top_values

Examples:
  "SELECT * FROM tables WHERE table_name LIKE '%user%'"
  "SELECT column_name, data_type FROM columns WHERE table_name = 'orders'"
  "SELECT * FROM column_stats WHERE n_distinct < 10"

Returns per query: {preview, handle, stats}. Optional prompt produces top-level {info}.`,
    parameters: SearchDBSchemaV2Params,
  };

  private catalogData: CatalogData | null = null;
  private catalogConnector: Awaited<ReturnType<typeof getOrCreateBenchmarkConnector>> | null = null;

  private async ensureCatalog(): Promise<void> {
    if (this.catalogData) return;

    // Build catalog from connections
    const schemasByConnection = new Map<string, SchemaEntry[]>();
    for (const conn of this.context.connections ?? []) {
      if (!conn.config) continue;
      const connector = await getOrCreateBenchmarkConnector(conn.name, conn.dialect, conn.config);
      const schema = await connector.getSchema();
      schemasByConnection.set(conn.name, schema);
    }

    this.catalogData = buildCatalog(this.context.connections ?? [], schemasByConnection);

    // Create an in-memory DuckDB with catalog tables
    this.catalogConnector = await getOrCreateBenchmarkConnector(
      '__v2_catalog__',
      'duckdb',
      { file_path: ':memory:' },
    );

    // Create catalog tables
    await this.createCatalogTables();
  }

  private async createCatalogTables(): Promise<void> {
    if (!this.catalogConnector || !this.catalogData) return;

    const c = this.catalogConnector;

    // Create connections table
    await c.query(`CREATE TABLE IF NOT EXISTS connections (name VARCHAR, dialect VARCHAR, description VARCHAR)`);
    for (const row of this.catalogData.connections) {
      await c.query(`INSERT INTO connections VALUES ('${esc(row.name)}', '${esc(row.dialect)}', '${esc(row.description)}')`);
    }

    // Create schemas table
    await c.query(`CREATE TABLE IF NOT EXISTS schemas (connection VARCHAR, schema_name VARCHAR)`);
    for (const row of this.catalogData.schemas) {
      await c.query(`INSERT INTO schemas VALUES ('${esc(row.connection)}', '${esc(row.schema_name)}')`);
    }

    // Create tables table
    await c.query(`CREATE TABLE IF NOT EXISTS tables (connection VARCHAR, schema_name VARCHAR, table_name VARCHAR, row_count INTEGER)`);
    for (const row of this.catalogData.tables) {
      await c.query(`INSERT INTO tables VALUES ('${esc(row.connection)}', '${esc(row.schema_name)}', '${esc(row.table_name)}', ${row.row_count ?? 'NULL'})`);
    }

    // Create columns table
    await c.query(`CREATE TABLE IF NOT EXISTS columns (connection VARCHAR, schema_name VARCHAR, table_name VARCHAR, column_name VARCHAR, data_type VARCHAR, ordinal_position INTEGER)`);
    for (const row of this.catalogData.columns) {
      await c.query(`INSERT INTO columns VALUES ('${esc(row.connection)}', '${esc(row.schema_name)}', '${esc(row.table_name)}', '${esc(row.column_name)}', '${esc(row.data_type)}', ${row.ordinal_position})`);
    }

    // Create indexes table
    await c.query(`CREATE TABLE IF NOT EXISTS indexes (connection VARCHAR, schema_name VARCHAR, table_name VARCHAR, index_name VARCHAR, columns VARCHAR, is_unique BOOLEAN)`);
    for (const row of this.catalogData.indexes) {
      await c.query(`INSERT INTO indexes VALUES ('${esc(row.connection)}', '${esc(row.schema_name)}', '${esc(row.table_name)}', '${esc(row.index_name)}', '${esc(row.columns)}', ${row.is_unique})`);
    }

    // Create column_stats table
    await c.query(`CREATE TABLE IF NOT EXISTS column_stats (connection VARCHAR, schema_name VARCHAR, table_name VARCHAR, column_name VARCHAR, category VARCHAR, description VARCHAR, null_count INTEGER, n_distinct INTEGER, min VARCHAR, max VARCHAR, avg DOUBLE, min_date VARCHAR, max_date VARCHAR, top_values VARCHAR)`);
    for (const row of this.catalogData.column_stats) {
      await c.query(`INSERT INTO column_stats VALUES ('${esc(row.connection)}', '${esc(row.schema_name)}', '${esc(row.table_name)}', '${esc(row.column_name)}', ${nullOr(row.category)}, ${nullOr(row.description)}, ${row.null_count ?? 'NULL'}, ${row.n_distinct ?? 'NULL'}, ${nullOr(String(row.min))}, ${nullOr(String(row.max))}, ${row.avg ?? 'NULL'}, ${nullOr(row.min_date)}, ${nullOr(row.max_date)}, ${nullOr(row.top_values)})`);
    }
  }

  async run(): Promise<ToolResponse<SearchDBSchemaV2Details>> {
    await this.ensureCatalog();

    const { queries, prompt, sequential = false } = this.parameters;
    const results: Array<QueryResultItem | ErrorResultItem> = [];

    // Execute queries
    const executeQuery = async (item: { query: string; label?: string }): Promise<QueryResultItem | ErrorResultItem> => {
      try {
        const result = await this.catalogConnector!.query(item.query);
        const handle = storeHandle(result);
        const previewRows = result.rows.slice(0, 100);
        const compressed = compressQueryResult({ ...result, rows: previewRows }, TOOL_MAX_LIMIT_CHARS);
        const stats = computeResultStats(result, previewRows.length);
        return { label: item.label, preview: compressed.data, handle, stats };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        return { label: item.label, error: `Query failed: ${errMsg}` };
      }
    };

    if (sequential) {
      for (const q of queries) {
        results.push(await executeQuery(q));
      }
    } else {
      const promises = queries.map(executeQuery);
      results.push(...await Promise.all(promises));
    }

    // Count successes/errors
    const successCount = results.filter(r => !('error' in r)).length;
    const errorCount = results.filter(r => 'error' in r).length;

    // Optional prompt pass
    let info: string | undefined;
    if (prompt && successCount > 0) {
      const successResults = results.filter((r): r is QueryResultItem => !('error' in r));
      const dataSections = successResults.map((r, i) => {
        const label = r.label || `Result ${i + 1}`;
        return `## ${label}\n${r.preview}`;
      }).join('\n\n');

      const ctx: Context = {
        systemPrompt: `You are a concise data assistant. Analyze the schema metadata below and answer the user's question. Be brief and factual.`,
        messages: [
          { role: 'user', content: `${dataSections}\n\nQuestion: ${prompt}`, timestamp: Date.now() },
        ],
        tools: [],
      };

      const responseMsg = await this.orchestrator.callLLM(searchModel, ctx, this.id, { maxTokens: 2048 });
      info = extractText(responseMsg);
    }

    const response: Record<string, unknown> = {
      success: true,
      results,
    };
    if (info) response.info = info;

    return {
      content: [{ type: 'text', text: JSON.stringify(response) }],
      isError: errorCount === queries.length,
      details: { queryCount: queries.length, successCount, errorCount },
    };
  }
}

function esc(s: string): string {
  return s?.replace(/'/g, "''") ?? '';
}

function nullOr(s: string | undefined): string {
  return s ? `'${esc(s)}'` : 'NULL';
}

function extractText(msg: AssistantMessage): string {
  return msg.content
    .filter((c): c is TextContent => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
    .trim();
}
