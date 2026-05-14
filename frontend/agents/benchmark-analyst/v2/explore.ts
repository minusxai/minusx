/**
 * Explore tool: Cross-table discovery search.
 * "Search when you don't know the table" — scans in-scope text columns
 * for a match term, unions results with source + score columns.
 */

import { Type, type Tool } from '@mariozechner/pi-ai';
import type { Context, AssistantMessage, TextContent } from '@mariozechner/pi-ai';
import { MXTool, type ToolResponse } from '@/orchestrator/types';
import type { BenchmarkAnalystContext } from '../types';
import { storeHandle } from './handle-store';
import { computeResultStats, type ResultStats } from './result-stats';
import { compressQueryResult, TOOL_MAX_LIMIT_CHARS } from '@/lib/api/compress-augmented';
import { getOrCreateBenchmarkConnector } from '../shared-duckdb';
import type { NodeConnector, SchemaEntry, QueryResult } from '@/lib/connections/base';
import { getModel } from '@/lib/llm/get-model';
import type { Api, Model } from '@/lib/llm/get-model';

const DEFAULT_EXPLORE_MODEL = getModel('anthropic', 'claude-haiku-4-5-20251001');
let exploreModel: Model<Api> = DEFAULT_EXPLORE_MODEL;
export function setExploreModel(model: Model<Api>) { exploreModel = model; }

const MAX_RESULTS_PER_TABLE = 100;
const MAX_TOTAL_RESULTS = 500;

const ExploreFilter = Type.Object({
  connection: Type.Optional(Type.String({ description: 'Limit search to this connection' })),
  schema: Type.Optional(Type.String({ description: 'Limit search to this schema' })),
  table: Type.Optional(Type.String({ description: 'Limit search to this table' })),
  columns: Type.Optional(Type.Array(Type.String(), { description: 'Limit search to these columns' })),
  match: Type.String({ description: 'Search term for lexical/fuzzy matching across text columns' }),
});

const ExploreParams = Type.Object({
  filter: ExploreFilter,
  prompt: Type.Optional(Type.String({
    description: 'Optional prompt for semantic re-ranking or analysis of search results.',
  })),
});

interface ExploreResultItem {
  source_connection: string;
  source_schema: string;
  source_table: string;
  source_column: string;
  matched_value: string;
  score: number;
  row_data: Record<string, unknown>;
}

interface ExploreDetails extends Record<string, unknown> {
  tablesSearched: number;
  columnsSearched: number;
  matchesFound: number;
}

export class Explore extends MXTool<
  typeof ExploreParams,
  BenchmarkAnalystContext,
  ExploreDetails
> {
  static readonly schema: Tool<typeof ExploreParams> = {
    name: 'Explore',
    description: `Cross-table discovery search — use when you don't know which table contains what you're looking for.

Searches all text/varchar columns across connections for the match term using fuzzy matching.
Returns results with source (connection, schema, table, column) and similarity score.

When to use Explore vs ExecuteQuery:
- Explore: "Find anything related to 'solar energy'" — don't know the table
- ExecuteQuery: "Get revenue from the sales table" — know the table

Filter options:
- connection: Limit to one database
- schema: Limit to one schema
- table: Limit to one table
- columns: Limit to specific column names
- match: The search term (required)

Optional prompt: Re-rank or analyze results semantically after lexical search.

Returns: {results, handle, stats, info?}`,
    parameters: ExploreParams,
  };

  private connectors = new Map<string, NodeConnector>();
  private dialects = new Map<string, string>();
  private schemasByConn = new Map<string, SchemaEntry[]>();

  private async buildConnectors(): Promise<void> {
    for (const conn of this.context.connections ?? []) {
      if (!conn.config || this.connectors.has(conn.name)) continue;
      const c = await getOrCreateBenchmarkConnector(conn.name, conn.dialect, conn.config);
      this.connectors.set(conn.name, c);
      this.dialects.set(conn.name, conn.dialect);
      const schema = await c.getSchema();
      this.schemasByConn.set(conn.name, schema);
    }
  }

  private isTextColumn(type: string): boolean {
    const t = type.toLowerCase();
    return ['text', 'varchar', 'character', 'string', 'char'].some(k => t.includes(k));
  }

  private buildSearchQuery(
    dialect: string,
    schemaName: string,
    tableName: string,
    columnName: string,
    match: string,
  ): string {
    const escapedMatch = match.replace(/'/g, "''");
    const table = `"${schemaName}"."${tableName}"`;
    const col = `"${columnName}"`;

    // Dialect-specific fuzzy search
    if (dialect === 'duckdb' || dialect === 'sqlite') {
      // DuckDB has jaro_winkler_similarity; SQLite via DuckDB also has it
      return `
        SELECT
          '${schemaName}' as source_schema,
          '${tableName}' as source_table,
          '${columnName}' as source_column,
          ${col} as matched_value,
          jaro_winkler_similarity(LOWER(CAST(${col} AS VARCHAR)), LOWER('${escapedMatch}')) as score,
          *
        FROM ${table}
        WHERE ${col} IS NOT NULL
          AND (
            LOWER(CAST(${col} AS VARCHAR)) LIKE LOWER('%${escapedMatch}%')
            OR jaro_winkler_similarity(LOWER(CAST(${col} AS VARCHAR)), LOWER('${escapedMatch}')) > 0.7
          )
        ORDER BY score DESC
        LIMIT ${MAX_RESULTS_PER_TABLE}
      `;
    }

    if (dialect === 'postgresql') {
      // PostgreSQL with pg_trgm
      return `
        SELECT
          '${schemaName}' as source_schema,
          '${tableName}' as source_table,
          '${columnName}' as source_column,
          ${col} as matched_value,
          similarity(LOWER(${col}::text), LOWER('${escapedMatch}')) as score,
          *
        FROM ${table}
        WHERE ${col} IS NOT NULL
          AND (
            LOWER(${col}::text) LIKE LOWER('%${escapedMatch}%')
            OR similarity(LOWER(${col}::text), LOWER('${escapedMatch}')) > 0.3
          )
        ORDER BY score DESC
        LIMIT ${MAX_RESULTS_PER_TABLE}
      `;
    }

    // Fallback: simple LIKE
    return `
      SELECT
        '${schemaName}' as source_schema,
        '${tableName}' as source_table,
        '${columnName}' as source_column,
        ${col} as matched_value,
        1.0 as score,
        *
      FROM ${table}
      WHERE ${col} IS NOT NULL
        AND LOWER(CAST(${col} AS VARCHAR)) LIKE LOWER('%${escapedMatch}%')
      LIMIT ${MAX_RESULTS_PER_TABLE}
    `;
  }

  async run(): Promise<ToolResponse<ExploreDetails>> {
    await this.buildConnectors();

    const { filter, prompt } = this.parameters;
    const { connection: connFilter, schema: schemaFilter, table: tableFilter, columns: colFilter, match } = filter;

    const allResults: ExploreResultItem[] = [];
    let tablesSearched = 0;
    let columnsSearched = 0;

    // Search across connections
    for (const [connName, connector] of this.connectors) {
      if (connFilter && connName !== connFilter) continue;

      const dialect = this.dialects.get(connName) ?? 'duckdb';
      if (dialect === 'mongo') continue; // Skip Mongo for now (different search pattern)

      const schemas = this.schemasByConn.get(connName) ?? [];

      for (const schemaEntry of schemas) {
        if (schemaFilter && schemaEntry.schema !== schemaFilter) continue;

        for (const table of schemaEntry.tables) {
          if (tableFilter && table.table !== tableFilter) continue;
          tablesSearched++;

          // Find text columns
          const textCols = table.columns.filter(c => {
            if (colFilter && !colFilter.includes(c.name)) return false;
            return this.isTextColumn(c.type);
          });

          for (const col of textCols) {
            columnsSearched++;

            try {
              const sql = this.buildSearchQuery(
                dialect,
                schemaEntry.schema,
                table.table,
                col.name,
                match,
              );
              const result = await connector.query(sql);

              for (const row of result.rows) {
                allResults.push({
                  source_connection: connName,
                  source_schema: String(row.source_schema),
                  source_table: String(row.source_table),
                  source_column: String(row.source_column),
                  matched_value: String(row.matched_value),
                  score: Number(row.score) || 0,
                  row_data: row,
                });

                if (allResults.length >= MAX_TOTAL_RESULTS) break;
              }
            } catch {
              // Skip errors (e.g., missing function)
            }

            if (allResults.length >= MAX_TOTAL_RESULTS) break;
          }
          if (allResults.length >= MAX_TOTAL_RESULTS) break;
        }
        if (allResults.length >= MAX_TOTAL_RESULTS) break;
      }
      if (allResults.length >= MAX_TOTAL_RESULTS) break;
    }

    // Sort by score descending
    allResults.sort((a, b) => b.score - a.score);

    // Build result as QueryResult format
    const resultRows = allResults.map(r => ({
      source_connection: r.source_connection,
      source_schema: r.source_schema,
      source_table: r.source_table,
      source_column: r.source_column,
      matched_value: r.matched_value,
      score: r.score,
      ...r.row_data,
    }));

    const queryResult: QueryResult = {
      columns: resultRows[0] ? Object.keys(resultRows[0]) : ['source_connection', 'source_schema', 'source_table', 'source_column', 'matched_value', 'score'],
      types: resultRows[0] ? Object.keys(resultRows[0]).map(() => 'VARCHAR') : [],
      rows: resultRows,
      finalQuery: `EXPLORE match="${match}"`,
    };

    const handle = storeHandle(queryResult);
    const previewRows = resultRows.slice(0, 100);
    const compressed = compressQueryResult({ ...queryResult, rows: previewRows }, TOOL_MAX_LIMIT_CHARS);
    const stats = computeResultStats(queryResult, previewRows.length);

    // Optional prompt for semantic re-ranking/analysis
    let info: string | undefined;
    if (prompt && resultRows.length > 0) {
      const ctx: Context = {
        systemPrompt: `You are a concise data assistant. Analyze the search results and answer the user's question. Focus on the most relevant matches. Be brief.`,
        messages: [
          { role: 'user', content: `Search results for "${match}":\n${compressed.data}\n\nTask: ${prompt}`, timestamp: Date.now() },
        ],
        tools: [],
      };

      const responseMsg = await this.orchestrator.callLLM(exploreModel, ctx, this.id, { maxTokens: 2048 });
      info = extractText(responseMsg);
    }

    const response: Record<string, unknown> = {
      success: true,
      preview: compressed.data,
      handle,
      stats,
      searchSummary: {
        tablesSearched,
        columnsSearched,
        matchesFound: allResults.length,
        term: match,
      },
    };
    if (info) response.info = info;

    return {
      content: [{ type: 'text', text: JSON.stringify(response) }],
      isError: false,
      details: { tablesSearched, columnsSearched, matchesFound: allResults.length },
    };
  }
}

function extractText(msg: AssistantMessage): string {
  return msg.content
    .filter((c): c is TextContent => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
    .trim();
}
