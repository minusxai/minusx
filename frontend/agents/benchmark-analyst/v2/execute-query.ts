// ExecuteQueryV2: SQL/Mongo queries against data connections
// Supports cross-connection queries, sequential label interpolation, handles-as-tables

import { Type, type Tool } from '@mariozechner/pi-ai';
import { type ToolResponse } from '@/orchestrator/types';
import type { QueryResult } from '@/lib/connections/base';
import { storeHandle, qualifyHandleRefs } from './handle-store';
import { computeResultStats } from './result-stats';
import {
  interpolateRefs,
  interpolateMongoRefs,
  mergeWithSessionLabels,
  recordSessionLabel,
} from './query-refs';
import { type PromptPassEntry } from './prompt-pass';
import { V2DataTool, getLighterModel } from './data-tool-base';
import { compressQueryResult, TOOL_MAX_LIMIT_CHARS } from '@/lib/api/compress-augmented';
import { enforceQueryLimit } from '@/lib/sql/limit-enforcer';
import { clampQueryTimeoutSeconds } from '../db-tools';
import type { ResultEntry } from '../result-shapes';

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
  timeout: Type.Optional(Type.Number({
    description: 'Per-query timeout in seconds (default 30, max 150). Applies to every query in the batch. Set this to 90–150 UP FRONT for a query that will scan a large table (full-table aggregation, JSON extraction over all rows) — do not eat a 30s kill and then retry. For ordinary queries leave it at the default and rewrite anything that times out (add filters, use an indexed column, avoid leading-wildcard LIKE).',
  })),
  maxChars: Type.Optional(Type.Number({
    description: 'Max characters of inline preview rows per result (default ~10,000). Increase up front (e.g. 30000–50000) only when you genuinely need to see more rows inline in this call. Otherwise prefer the default + `fetchHandle` for pagination.',
  })),
});

interface ExecuteQueryDetails {
  queryCount: number;
  errors: number;
}

export class ExecuteQueryV2 extends V2DataTool<typeof ExecuteQueryParams, ExecuteQueryDetails> {
  static readonly schema: Tool<typeof ExecuteQueryParams> = {
    name: 'ExecuteQuery',
    description: `Execute SQL queries against data connections. Returns {results, info?} where each result has {preview, handle, stats}.

FEATURES:
- Cross-connection queries: specify different connections for each query
- Handle references (FROM handle_xyz): in-engine join — **only works when the query's connection is duckdb or benchmark-sqlite** (both share one in-memory DuckDB instance where handle tables live). Scales to handles of any size with no inlining.
- Sequential mode (sequential=true): queries run in order, $label.column references in later queries expand into the SQL/JSON as a literal list/JSON array. The **universal** cross-connection mechanism — works SQL→SQL across engines, SQL→Mongo, etc. Prefer FROM handle_xyz when both ends are duckdb/sqlite.
- Per-query errors: a failing query returns {error} in its slot without failing the batch
- Per-query handle errors: if the result can't be stored as a SQL table (e.g. your source query produced duplicate output column names like \`SELECT MIN(a) AS min, MIN(b) AS min\`), the slot contains {preview, stats, handle_error} — you still get the data, but \`FROM <handle>\` won't work. Give the duplicate columns distinct aliases and re-run if you need handle-based joins.
- Prompt: if provided, the lighter model re-ranks each result's preview rows and returns a single cross-result info summary
- Timeout (seconds, default 30, max 150): per-query cancellation budget; bump UP FRONT for queries that scan large tables — don't eat a default kill then retry

SEQUENTIAL MODE:
In sequential mode (sequential=true), the 2nd+ query MUST reference an earlier result via $label.column. Works for SQL AND Mongo.

SQL → SQL example:
  query1: {connection: "orders", query: "SELECT product_id FROM sales ORDER BY revenue DESC LIMIT 100", label: "top"}
  query2: {connection: "catalog", query: "SELECT * FROM products WHERE id IN ($top.product_id)", label: "details"}

SQL → Mongo example — DO THIS instead of inlining a long $in array (handles don't apply across SQL/Mongo, but $label.column does):
  sequential: true
  query1: {connection: "metadata_db", query: "SELECT article_id FROM article_metadata WHERE author='Amy Jones'", label: "amy"}
  query2: {connection: "articles_db", query: '{"collection":"articles","pipeline":[{"$match":{"article_id":{"$in":"$amy.article_id"}}},{"$project":{"title":1,"description":1}}]}'}
The "$amy.article_id" string inside the JSON pipeline expands to a real JSON array of the article_ids from query1.

HANDLE AS TABLE (duckdb / benchmark-sqlite only):
Any stored handle can be joined as a table when the query's connection is duckdb or benchmark-sqlite (both route through the same in-memory DuckDB instance where handle tables are registered):
  "SELECT o.id FROM orders o JOIN handle_abc h ON o.product_id = h.id WHERE h.value > 100"
For postgres / bigquery / mongo connections — handle tables don't exist in those engines. Use sequential mode + $label.column instead (above).

FUZZY MATCHING:
Use SQL functions directly: jaro_winkler_similarity() (DuckDB / benchmark sqlite), similarity() with pg_trgm (PostgreSQL).
For semantic re-ranking, pass a \`prompt\` — the lighter model re-ranks each result's preview rows and writes one \`info\` summary across all results.

MONGO:
For Mongo connections, write a JSON aggregation pipeline: {"collection": "name", "pipeline": [stages]}. Common stages: $match, $group, $project, $sort, $limit. Use sequential mode + $label.column for cross-DB chains (above) — NEVER paste hundreds of IDs into an inline $in array.`,
    parameters: ExecuteQueryParams,
  };

  async run(): Promise<ToolResponse<ExecuteQueryDetails>> {
    const { queries, prompt, sequential = false, timeout, maxChars } = this.parameters;
    const timeoutMs = clampQueryTimeoutSeconds(timeout) * 1000;
    const previewMaxChars = typeof maxChars === 'number' && maxChars > 0 ? maxChars : TOOL_MAX_LIMIT_CHARS;

    await this.ensureConnectors();

    const labeledResults = new Map<string, Record<string, unknown>[]>();
    let errorCount = 0;

    type Collected = { entry: ResultEntry; raw: QueryResult | null; label: string };

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

      // Interpolate $label.column references. Per-call labels (set in
      // sequential mode by earlier queries in this batch) merge with
      // session-scoped labels from prior ExecuteQuery calls — so a chain
      // started in a previous call (e.g. SQL → Mongo split across two tool
      // calls) still resolves. Per-call wins on collision.
      const availableLabels = mergeWithSessionLabels(labeledResults);
      const interpolatedQuery = availableLabels.size > 0
        ? (isMongo
          ? interpolateMongoRefs(spec.query, availableLabels)
          : interpolateRefs(spec.query, availableLabels))
        : spec.query;

      try {
        // Qualify `FROM handle_xyz` references to the shared `memory` catalog
        // so they resolve as real tables (handle tables and the ATTACHed
        // dataset catalogs share one DuckDB instance). Handle tables are a
        // SQL-only feature — guard non-SQL connections.
        const { sql: qualifiedQuery, referencedHandles } =
          await qualifyHandleRefs(interpolatedQuery);
        if (referencedHandles.length > 0 && dialect !== 'duckdb') {
          return {
            entry: {
              error: `Handle table references (FROM handle_xyz) require a duckdb connection; '${spec.connection}' is ${dialect}. Chain via \`sequential: true\` + \`$label.column\` instead, or read the handle with fetchHandle.`,
            },
            raw: null,
            label,
          };
        }

        // Enforce query limit (skip for Mongo — caps live in MongoConnector)
        const finalQuery = isMongo
          ? interpolatedQuery
          : await enforceQueryLimit(qualifiedQuery, { dialect });

        const result = await connector.query(finalQuery, undefined, timeoutMs);

        // Store the labeled result both per-call (so a same-batch sequential
        // query can ref it) and session-wide (so a *later* ExecuteQuery call
        // can ref it too — the agent's natural mental model).
        if (spec.label) {
          labeledResults.set(spec.label, result.rows);
          recordSessionLabel(spec.label, result.rows);
        }

        // storeHandle awaits the DuckDB registration. If the result can't
        // be made into a SQL table (most commonly: source query returned
        // duplicate column names), we surface the error verbatim as
        // `handle_error` and omit `handle` — preview & stats still ship
        // so the agent has the data and a clear next step (fix aliases).
        const stored = await storeHandle(result);
        const stats = computeResultStats(result, Math.min(result.rows.length, 100));
        // Skip the inline compress when a prompt is set — `runPromptPass`
        // produces the re-ranked preview from the raw rows.
        const preview = prompt
          ? undefined
          : compressQueryResult(result, previewMaxChars).data;

        const entry: ResultEntry = stored.error
          ? { preview, stats, handle_error: stored.error }
          : { preview, handle: stored.handleId, stats };
        return { entry, raw: result, label };
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

    const results: ResultEntry[] = collected.map((c) => c.entry);
    const response: { results: ResultEntry[]; info?: string } = { results };

    // With a prompt, the lighter model re-ranks each preview's rows and writes
    // one cross-result `info` summary (see prompt-pass.ts).
    if (prompt) {
      const entries: PromptPassEntry[] = collected.map((c) =>
        c.raw
          ? { label: c.label, result: c.raw }
          : { label: c.label, error: c.entry.error ?? 'query failed' },
      );
      const { previews, info } = await this.runPromptPass(entries, prompt, getLighterModel(), previewMaxChars);
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
