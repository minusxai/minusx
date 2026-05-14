/**
 * ExecuteQueryV2: Execute SQL queries across connections with handle-based results.
 * Supports sequential mode with $label.col interpolation and handles-as-tables.
 */

import { Type, type Tool } from '@mariozechner/pi-ai';
import type { Context, AssistantMessage, TextContent } from '@mariozechner/pi-ai';
import { MXTool, type ToolResponse } from '@/orchestrator/types';
import type { BenchmarkAnalystContext, ConnectionInfo } from '../types';
import { storeHandle, getHandle, getAllHandles } from './handle-store';
import { computeResultStats, type ResultStats } from './result-stats';
import { interpolateRefs, interpolateMongoRefs } from './query-refs';
import { compressQueryResult, TOOL_MAX_LIMIT_CHARS } from '@/lib/api/compress-augmented';
import { enforceQueryLimit } from '@/lib/sql/limit-enforcer';
import { getOrCreateBenchmarkConnector } from '../shared-duckdb';
import type { NodeConnector, QueryResult } from '@/lib/connections/base';
import { getModel } from '@/lib/llm/get-model';
import type { Api, Model } from '@/lib/llm/get-model';

const DEFAULT_EXECUTE_MODEL = getModel('anthropic', 'claude-haiku-4-5-20251001');
let executeModel: Model<Api> = DEFAULT_EXECUTE_MODEL;
export function setExecuteModel(model: Model<Api>) { executeModel = model; }

const QuerySpec = Type.Object({
  connection: Type.String({ description: 'Database connection name' }),
  query: Type.String({
    description: `SQL query (or MongoDB aggregation pipeline JSON). Can reference:
- Columns from earlier queries: $label.column_name (in SQL: WHERE id IN ($prev.id); in Mongo: {"$in": "$prev.id"})
- Previously stored handles as tables: FROM handle_xyz (handle rows are queryable DuckDB tables)`
  }),
  label: Type.Optional(Type.String({ description: 'Short label for referencing this result in later queries' })),
});

const ExecuteQueryV2Params = Type.Object({
  queries: Type.Array(QuerySpec, {
    description: 'Queries to execute. Each produces a result with preview, handle, and stats.',
    minItems: 1,
  }),
  prompt: Type.Optional(Type.String({
    description: 'Optional prompt for a lightweight LLM to synthesize findings across ALL query results. Produces top-level info field.',
  })),
  sequential: Type.Optional(Type.Boolean({
    description: 'If true, run queries in order and enable $label.col interpolation. If false (default), run independently/parallel.',
    default: false,
  })),
});

interface QueryResultItem {
  connection: string;
  label?: string;
  preview: string;
  handle: string;
  stats: ResultStats;
  finalQuery?: string;
}

interface ErrorResultItem {
  connection: string;
  label?: string;
  error: string;
}

interface ExecuteQueryV2Details extends Record<string, unknown> {
  queryCount: number;
  successCount: number;
  errorCount: number;
  totalRows: number;
}

export class ExecuteQueryV2 extends MXTool<
  typeof ExecuteQueryV2Params,
  BenchmarkAnalystContext,
  ExecuteQueryV2Details
> {
  static readonly schema: Tool<typeof ExecuteQueryV2Params> = {
    name: 'ExecuteQuery',
    description: `Execute SQL queries against data connections. Each query returns a handle that can be:
1. Paginated via fetchHandle(handle, offset, length)
2. Queried as a DuckDB table: "FROM handle_xyz JOIN other_table..."

Modes:
- sequential=false (default): Run queries independently in parallel
- sequential=true: Run in order; $label.col references expand to values from earlier results

Query syntax:
- SQL: Standard SQL for the connection's dialect
- MongoDB: {"collection": "...", "pipeline": [...]} JSON string

Cross-query references (sequential=true only):
- SQL: WHERE id IN ($revenue.product_id) → WHERE id IN (1, 2, 3)
- Mongo: {"$in": "$revenue.id"} → {"$in": [1, 2, 3]}

Handle tables:
- Previous handles are queryable: SELECT * FROM handle_1_abc WHERE amount > 100

Fuzzy matching: Use SQL functions (jaro_winkler_similarity, levenshtein for DuckDB).
Semantic matching: Pass a prompt to have the results analyzed by an LLM.

Returns per query: {preview, handle, stats}. Optional prompt produces {info}.`,
    parameters: ExecuteQueryV2Params,
  };

  private connectors = new Map<string, NodeConnector>();
  private dialects = new Map<string, string>();

  private async buildConnectors(): Promise<void> {
    for (const conn of this.context.connections ?? []) {
      if (!conn.config || this.connectors.has(conn.name)) continue;
      const c = await getOrCreateBenchmarkConnector(conn.name, conn.dialect, conn.config);
      this.connectors.set(conn.name, c);
      this.dialects.set(conn.name, conn.dialect);
    }
  }

  async run(): Promise<ToolResponse<ExecuteQueryV2Details>> {
    await this.buildConnectors();

    const { queries, prompt, sequential = false } = this.parameters;
    const results: Array<QueryResultItem | ErrorResultItem> = [];
    const labeledResults = new Map<string, Record<string, unknown>[]>();
    let totalRows = 0;

    // Validate sequential mode: 2nd+ queries must reference earlier results
    if (sequential && queries.length > 1) {
      for (let i = 1; i < queries.length; i++) {
        const q = queries[i];
        if (!/\$[a-zA-Z_]\w*\.\w+/.test(q.query) && !/handle_\w+/.test(q.query)) {
          return {
            content: [{ type: 'text', text: JSON.stringify({
              success: false,
              error: `Query ${i + 1} ("${q.label || q.connection}") must reference an earlier result via $label.column or FROM handle_xyz. For independent queries, use sequential=false.`,
            }) }],
            isError: true,
            details: { queryCount: queries.length, successCount: 0, errorCount: 1, totalRows: 0 },
          };
        }
      }
    }

    // Execute queries
    const executeOne = async (
      spec: { connection: string; query: string; label?: string },
      index: number,
    ): Promise<QueryResultItem | ErrorResultItem> => {
      const { connection, query: rawQuery, label } = spec;
      const connector = this.connectors.get(connection);

      if (!connector) {
        return {
          connection,
          label,
          error: `Connection '${connection}' not found. Use SearchDBSchema to see available connections.`,
        };
      }

      const dialect = this.dialects.get(connection) ?? 'duckdb';
      const isMongo = dialect === 'mongo';

      try {
        // Interpolate $label.col references if sequential
        let interpolated = rawQuery;
        if (sequential && labeledResults.size > 0) {
          interpolated = isMongo
            ? interpolateMongoRefs(rawQuery, labeledResults)
            : interpolateRefs(rawQuery, labeledResults);
        }

        // Apply limit enforcement for SQL
        const cappedQuery = isMongo ? interpolated : await enforceQueryLimit(interpolated, { dialect });

        // Execute
        const result = await connector.query(cappedQuery);
        totalRows += result.rows.length;

        // Store in labeledResults for sequential references
        if (label) {
          labeledResults.set(label, result.rows);
        }

        // Create handle
        const handle = storeHandle(result);

        // Build preview and stats
        const previewRows = result.rows.slice(0, 100);
        const compressed = compressQueryResult({ ...result, rows: previewRows }, TOOL_MAX_LIMIT_CHARS);
        const stats = computeResultStats(result, previewRows.length);

        return {
          connection,
          label,
          preview: compressed.data,
          handle,
          stats,
          finalQuery: result.finalQuery ?? cappedQuery,
        };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        return { connection, label, error: `Query failed: ${errMsg}` };
      }
    };

    if (sequential) {
      for (let i = 0; i < queries.length; i++) {
        results.push(await executeOne(queries[i], i));
      }
    } else {
      const promises = queries.map((q, i) => executeOne(q, i));
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
        const header = r.label || `Result ${i + 1} (${r.connection})`;
        return `## ${header}\n${r.preview}`;
      }).join('\n\n');

      const rowSummary = successResults.map(r => `${r.stats.rowCount} rows from ${r.connection}`).join(', ');
      const userContent = `${dataSections}\n\n## Task (${rowSummary})\n${prompt}`;

      const ctx: Context = {
        systemPrompt: `You are a concise data assistant. Analyze the query results and answer the user's question. Be brief and factual. Return structured data when appropriate.`,
        messages: [
          { role: 'user', content: userContent, timestamp: Date.now() },
        ],
        tools: [],
      };

      const responseMsg = await this.orchestrator.callLLM(executeModel, ctx, this.id, { maxTokens: 4096 });
      info = extractText(responseMsg);
    }

    const response: Record<string, unknown> = {
      success: errorCount < queries.length,
      results,
    };
    if (info) response.info = info;

    return {
      content: [{ type: 'text', text: JSON.stringify(response) }],
      isError: errorCount === queries.length,
      details: { queryCount: queries.length, successCount, errorCount, totalRows },
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
