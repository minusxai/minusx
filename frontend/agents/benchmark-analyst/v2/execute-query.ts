// ExecuteQueryV2: SQL/Mongo queries against data connections
// Supports cross-connection queries, sequential label interpolation, handles-as-tables

import { Type, type Tool, type AssistantMessage, type Context, type TextContent } from '@mariozechner/pi-ai';
import { MXTool, type ToolResponse } from '@/orchestrator/types';
import type { BenchmarkAnalystContext, ConnectionInfo } from '../types';
import { getOrCreateBenchmarkConnector } from '../shared-duckdb';
import type { NodeConnector, QueryResult } from '@/lib/connections/base';
import { storeHandle, fetchHandle, queryHandle } from './handle-store';
import { computeResultStats, type ResultStats } from './result-stats';
import { interpolateRefs, interpolateMongoRefs } from './query-refs';
import { compressQueryResult, TOOL_MAX_LIMIT_CHARS } from '@/lib/api/compress-augmented';
import { enforceQueryLimit } from '@/lib/sql/limit-enforcer';
import { getModel, type Api, type Model } from '@/lib/llm/get-model';

const DEFAULT_INFO_MODEL = getModel('anthropic', 'claude-haiku-4-5-20251001');
let infoModel: Model<Api> = DEFAULT_INFO_MODEL;
export function setInfoModel(model: Model<Api>) { infoModel = model; }

const QuerySpec = Type.Object({
  connection: Type.String({ description: 'Database connection name' }),
  query: Type.String({ description: 'SQL query (or Mongo pipeline JSON for mongo connections). Can reference earlier query results via $label.column in sequential mode, or join against handle tables (FROM handle_xyz).' }),
  label: Type.Optional(Type.String({ description: 'Short label for this query (required for sequential $label references)' })),
});

const ExecuteQueryParams = Type.Object({
  queries: Type.Array(QuerySpec, {
    description: 'One or more queries to execute. Each specifies a connection and query.',
    minItems: 1,
  }),
  prompt: Type.Optional(Type.String({ description: 'Optional: if provided, an LLM processes all results and returns a single info summary' })),
  sequential: Type.Optional(Type.Boolean({ description: 'If true, queries run sequentially and can reference earlier results via $label.column (default: false, parallel)' })),
});

interface QueryResultEntry {
  preview?: string;
  handle?: string;
  stats?: ResultStats;
  error?: string;
}

interface ExecuteQueryDetails {
  queryCount: number;
  errors: number;
}

export class ExecuteQueryV2 extends MXTool<
  typeof ExecuteQueryParams,
  BenchmarkAnalystContext,
  ExecuteQueryDetails
> {
  static readonly schema: Tool<typeof ExecuteQueryParams> = {
    name: 'ExecuteQuery',
    description: `Execute SQL queries against data connections. Returns {results, info?} where each result has {preview, handle, stats}.

FEATURES:
- Cross-connection queries: specify different connections for each query
- Handle references: results from earlier queries (or any stored handle) can be joined as tables: FROM handle_xyz
- Sequential mode (sequential=true): queries run in order, $label.column references expand to values from earlier results
- Per-query errors: a failing query returns {error} in its slot without failing the batch
- Prompt: if provided, an LLM processes all results and returns a single info summary

SEQUENTIAL MODE:
In sequential mode, the 2nd+ query MUST reference an earlier result via $label.column.
Example:
  query1: {connection: "orders", query: "SELECT product_id FROM sales ORDER BY revenue DESC LIMIT 100", label: "top"}
  query2: {connection: "catalog", query: "SELECT * FROM products WHERE id IN ($top.product_id)", label: "details"}

HANDLE AS TABLE:
Any stored handle can be queried as a table:
  "SELECT o.id FROM orders o JOIN handle_abc h ON o.product_id = h.id WHERE h.value > 100"

FUZZY MATCHING:
Use SQL functions directly: jaro_winkler_similarity(), levenshtein() (DuckDB), similarity() (PostgreSQL), etc.
For semantic matching, pass results to an LLM via the prompt parameter.

MONGO:
For Mongo connections, write a JSON aggregation pipeline: {"collection": "name", "pipeline": [stages]}
$label.column references expand to JSON arrays for use with $in.`,
    parameters: ExecuteQueryParams,
  };

  private connectors = new Map<string, NodeConnector>();
  private dialects = new Map<string, string>();

  private async initConnectors(): Promise<void> {
    for (const entry of this.context.connections ?? []) {
      if (!entry.config) continue;
      if (this.connectors.has(entry.name)) continue;
      const c = await getOrCreateBenchmarkConnector(entry.name, entry.dialect, entry.config);
      this.connectors.set(entry.name, c);
      this.dialects.set(entry.name, entry.dialect);
    }
  }

  async run(): Promise<ToolResponse<ExecuteQueryDetails>> {
    const { queries, prompt, sequential = false } = this.parameters;

    await this.initConnectors();

    const results: QueryResultEntry[] = [];
    const labeledResults = new Map<string, Record<string, unknown>[]>();
    let errorCount = 0;

    const executeQuery = async (
      spec: { connection: string; query: string; label?: string },
      index: number,
    ): Promise<QueryResultEntry> => {
      const connector = this.connectors.get(spec.connection);
      if (!connector) {
        return { error: `Connection '${spec.connection}' not found. Available: ${Array.from(this.connectors.keys()).join(', ')}` };
      }

      const dialect = this.dialects.get(spec.connection) ?? 'duckdb';
      const isMongo = dialect === 'mongo';

      // In sequential mode, validate that 2nd+ queries reference earlier results
      if (sequential && index > 0) {
        const hasRef = /\$[a-zA-Z_]\w*\.\w+/.test(spec.query);
        if (!hasRef) {
          return { error: `Query ${index + 1} must reference an earlier result via $label.column in sequential mode. Example: WHERE id IN ($prev.id)` };
        }
      }

      // Interpolate references
      let interpolatedQuery = spec.query;
      if (sequential && labeledResults.size > 0) {
        interpolatedQuery = isMongo
          ? interpolateMongoRefs(spec.query, labeledResults)
          : interpolateRefs(spec.query, labeledResults);
      }

      // Check for handle table references and expand them
      // Handle references like FROM handle_xyz are handled by the connector via handle tables
      // For now, we rely on the query containing handle references that the connector resolves

      try {
        // Enforce query limit (skip for Mongo)
        const finalQuery = isMongo
          ? interpolatedQuery
          : await enforceQueryLimit(interpolatedQuery, { dialect });

        const result = await connector.query(finalQuery);

        // Store with label if provided
        if (spec.label) {
          labeledResults.set(spec.label, result.rows);
        }

        const handle = storeHandle(result);
        const compressed = compressQueryResult(result, TOOL_MAX_LIMIT_CHARS);
        const stats = computeResultStats(result, Math.min(result.rows.length, 100));

        return { preview: compressed.data, handle, stats };
      } catch (err) {
        errorCount++;
        const msg = err instanceof Error ? err.message : String(err);
        return { error: msg };
      }
    };

    if (sequential) {
      for (let i = 0; i < queries.length; i++) {
        results.push(await executeQuery(queries[i], i));
      }
    } else {
      const promises = queries.map((spec, i) => executeQuery(spec, i));
      results.push(...await Promise.all(promises));
    }

    // Build response
    const response: { results: QueryResultEntry[]; info?: string } = { results };

    // If prompt provided, call LLM for summary
    if (prompt) {
      const previewsText = results
        .map((r, i) => {
          const label = queries[i].label ?? `Query ${i + 1}`;
          if (r.error) return `## ${label}\nERROR: ${r.error}`;
          return `## ${label}\n${r.preview}\nStats: ${JSON.stringify(r.stats)}`;
        })
        .join('\n\n');

      const ctx: Context = {
        systemPrompt: 'You are a data tool. Analyze the query results and answer the user\'s question concisely. Be factual and brief. Do not re-emit row data — summarize or reference handles instead.',
        messages: [
          { role: 'user', content: `${previewsText}\n\n## Task\n${prompt}`, timestamp: Date.now() },
        ],
        tools: [],
      };

      const msg = await this.orchestrator.callLLM(infoModel, ctx, this.id, { maxTokens: 4096 });
      response.info = extractText(msg);
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(response) }],
      isError: false,
      details: { queryCount: queries.length, errors: errorCount },
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
