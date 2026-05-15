// ExecuteQueryV2: SQL/Mongo queries against data connections
// Supports cross-connection queries, sequential label interpolation, handles-as-tables

import { Type, type Tool } from '@mariozechner/pi-ai';
import { MXTool, type ToolResponse } from '@/orchestrator/types';
import type { BenchmarkAnalystContext, ConnectionInfo } from '../types';
import { getOrCreateBenchmarkConnector } from '../shared-duckdb';
import type { NodeConnector, QueryResult } from '@/lib/connections/base';
import { storeHandle, qualifyHandleRefs } from './handle-store';
import { computeResultStats, type ResultStats } from './result-stats';
import { interpolateRefs, interpolateMongoRefs } from './query-refs';
import { runPromptPass, type PromptPassEntry } from './prompt-pass';
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

    const labeledResults = new Map<string, Record<string, unknown>[]>();
    let errorCount = 0;

    type Collected = { entry: QueryResultEntry; raw: QueryResult | null; label: string };

    const executeQuery = async (
      spec: { connection: string; query: string; label?: string },
      index: number,
    ): Promise<Collected> => {
      const label = spec.label ?? `Query ${index + 1}`;
      const connector = this.connectors.get(spec.connection);
      if (!connector) {
        return {
          entry: { error: `Connection '${spec.connection}' not found. Available: ${Array.from(this.connectors.keys()).join(', ')}` },
          raw: null,
          label,
        };
      }

      const dialect = this.dialects.get(spec.connection) ?? 'duckdb';
      const isMongo = dialect === 'mongo';

      // In sequential mode, validate that 2nd+ queries reference earlier results
      if (sequential && index > 0) {
        const hasRef = /\$[a-zA-Z_]\w*\.\w+/.test(spec.query);
        if (!hasRef) {
          return {
            entry: { error: `Query ${index + 1} must reference an earlier result via $label.column in sequential mode. Example: WHERE id IN ($prev.id)` },
            raw: null,
            label,
          };
        }
      }

      // Interpolate $label.column references (sequential mode)
      let interpolatedQuery = spec.query;
      if (sequential && labeledResults.size > 0) {
        interpolatedQuery = isMongo
          ? interpolateMongoRefs(spec.query, labeledResults)
          : interpolateRefs(spec.query, labeledResults);
      }

      try {
        // Qualify `FROM handle_xyz` references to the shared `memory` catalog
        // so they resolve as real tables (handle tables and the ATTACHed
        // dataset catalogs share one DuckDB instance). Handle tables are a
        // SQL-only feature — guard non-SQL connections.
        const { sql: qualifiedQuery, referencedHandles } =
          await qualifyHandleRefs(interpolatedQuery);
        if (
          referencedHandles.length > 0 &&
          dialect !== 'duckdb' && dialect !== 'sqlite'
        ) {
          return {
            entry: {
              error: `Handle table references (FROM handle_xyz) require a duckdb or sqlite connection; '${spec.connection}' is ${dialect}. Re-run the query on a SQL connection, or read the handle with fetchHandle.`,
            },
            raw: null,
            label,
          };
        }

        // Enforce query limit (skip for Mongo — caps live in MongoConnector)
        const finalQuery = isMongo
          ? interpolatedQuery
          : await enforceQueryLimit(qualifiedQuery, { dialect });

        const result = await connector.query(finalQuery);

        // Store under its label for sequential $label.column references
        if (spec.label) {
          labeledResults.set(spec.label, result.rows);
        }

        const handle = storeHandle(result);
        const compressed = compressQueryResult(result, TOOL_MAX_LIMIT_CHARS);
        const stats = computeResultStats(result, Math.min(result.rows.length, 100));

        return { entry: { preview: compressed.data, handle, stats }, raw: result, label };
      } catch (err) {
        errorCount++;
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
      details: { queryCount: queries.length, errors: errorCount },
    };
  }
}
