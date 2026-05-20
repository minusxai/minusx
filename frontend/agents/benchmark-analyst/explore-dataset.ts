// ExploreDataset: runs one or more queries (potentially across different
// databases) and passes the combined results to an LLM for analysis. Useful
// for entity resolution, deduplication, clustering, and other data-reasoning
// tasks that can't be expressed in a query alone — especially cross-DB
// scenarios. A query is SQL for relational connections, or a native
// `{collection, pipeline}` aggregation pipeline (JSON string) for MongoDB.

import { Type, type Tool } from '@mariozechner/pi-ai';
import type { AssistantMessage, Context, TextContent } from '@mariozechner/pi-ai';
import { MXTool, type ToolResponse } from '@/orchestrator/types';
import { type BenchmarkAnalystContext, type ConnectionInfo } from './types';
import { compressQueryResult, TOOL_MAX_LIMIT_CHARS } from '@/lib/api/compress-augmented';
import { enforceQueryLimit } from '@/lib/sql/limit-enforcer';
import { getOrCreateBenchmarkConnector } from './shared-duckdb';
import { qualifyHandleRefs } from './v2/handle-store';
import type { NodeConnector, QueryResult } from '@/lib/connections/base';
import { getModel } from '@/lib/llm/get-model';
import type { Api, Model } from '@/lib/llm/get-model';
import {
  interpolateRefs,
  interpolateMongoRefs,
  findUnresolvedMongoLabelRefs,
  detectLowLimit,
} from './v2/query-refs';

// Re-export for backward compatibility with tests
export { interpolateMongoRefs };

const DEFAULT_EXPLORE_MODEL = getModel('anthropic', 'claude-haiku-4-5-20251001');

// Overridable for testing (faux provider).
let exploreModel: Model<Api> = DEFAULT_EXPLORE_MODEL;
export function setExploreModel(model: Model<Api>) { exploreModel = model; }

// ─── Shared connector wiring (same as db-tools.ts) ──────────────────────
async function buildConnectorsFromContext(
  connections: ConnectionInfo[] | undefined,
  connectors: Map<string, NodeConnector>,
  dialects?: Map<string, string>,
  datasetKey?: string,
): Promise<void> {
  for (const entry of connections ?? []) {
    if (!entry.config) continue;
    if (connectors.has(entry.name)) continue;
    const c = await getOrCreateBenchmarkConnector(
      entry.name, entry.dialect, entry.config, { datasetKey },
    );
    connectors.set(entry.name, c);
    dialects?.set(entry.name, entry.dialect);
  }
}

// ─── ExploreDataset ──────────────────────────────────────────────────────

const QuerySpec = Type.Object({
  connection: Type.String({ description: 'Database connection name' }),
  query: Type.String({ description: 'Query to run on this connection (~1000 rows). For a SQL connection this is a SQL query; for a MongoDB connection it is a JSON string {"collection": "...", "pipeline": [...aggregation stages]} — a native aggregation pipeline. Can reference columns from earlier queries using $label.column_name: in SQL, `WHERE id IN ($revenue.product_id)` expands to all product_id values from the query labelled "revenue"; in a Mongo pipeline, the quoted token `{"$in": "$revenue.product_id"}` expands to the JSON array `{"$in": [101, 102, ...]}`.' }),
  label: Type.Optional(Type.String({ description: 'Short label for this dataset (e.g. "revenue", "products"). Shown to the LLM as a header.' })),
});

const ExploreDatasetParams = Type.Object({
  queries: Type.Array(QuerySpec, {
    description: 'One or more queries to run sequentially (can span different connections). When using multiple queries, the 2nd+ query MUST reference an earlier result via $label.column_name (e.g. WHERE id IN ($revenue.product_id)) to keep datasets aligned. If you need independent explorations, use separate ExploreDataset calls instead. If same DB, prefer CTE/subqueries in a single query.',
    minItems: 1,
  }),
  prompt: Type.String({ description: 'A precise, 1-2 sentence instruction. State exactly what output you need (e.g. "group rows by real-world entity and return a mapping of canonical_name → [ids]"). Do NOT ask open-ended questions.' }),
});

interface ExploreDatasetDetails extends Record<string, unknown> {
  analysis: string;
  totalRowCount: number;
  executedQueries: Array<{ connection: string; finalQuery: string; rowCount: number }>;
}

function buildExploreSystemPrompt(contextDocs?: string): string {
  return `You are a data tool. Another agent sends you data + a task. Return ONLY the answer — no preamble, no methodology, no commentary.

You are invoked when:
- When the main agent needs an LLM to reason about the data — such as entity resolution, deduplication, clustering, pattern detection, or other tasks that can't be expressed in SQL. You are mainly invoked for unknown-unknowns where FuzzyMatch isn't applicable (e.g. grouping similar rows across the whole table is O(n²) for FuzzyMatch but natural for an LLM).

## Guidelines
- Never give only a small subset of results unless asked. Answer the main agent's question promptly and completely.
- Never give up midway. Example: IF the main agent asks "group these products into 5 clusters", don't return 3 clusters and say "... similarly". Return all data expected.

## Data Documentation (The main agent has access to this; here just for your reference to better understand the data and the main agent's needs)
${contextDocs ?? 'No documentation available.'}

Output format:
- Simple, machine-readable: single line json or csv also works
- No prose. No "Here is the analysis:" headers.
- If the data is insufficient, add a warning: "MAYBE INSUFFICIENT DATA: <one-line reason>". NEVER refuse to answer. Your goal is to help the main agent do its job better, even if the data is imperfect. Always provide your best guess and flag any concerns about data quality or gaps.
- If the task asks for groupings, return them as: Group "label": id1, id2, id3`;
}


export class ExploreDataset extends MXTool<
  typeof ExploreDatasetParams,
  BenchmarkAnalystContext,
  ExploreDatasetDetails
> {
  static readonly schema: Tool<typeof ExploreDatasetParams> = {
    name: 'ExploreDataset',
    description:
      `Runs one or more SQL queries (at least 1000 rows each, potentially across different databases) and passes the combined results to a smaller LLM for analysis. Use for entity resolution, deduplication, clustering, or pattern detection that cannot be expressed in SQL alone. Queries run sequentially — later queries can reference earlier results via $label.column_name (e.g. WHERE id IN ($revenue.product_id)). Use this for cross-DB joins without manually copying IDs.
      IMPORTANT — keep the dataset small and focused:
      1. A smaller LLM processes this data. For ranking/aggregation questions, send the top 1000 rows by the ranking metric, then use $label references to pull related data from other tables.
      2. Always ORDER BY the most relevant column (revenue, popularity, etc.) — never by arbitrary columns (id, created_at). The LLM sees the data in order and may truncate from the bottom.
      3. For cross-DB entity resolution: query the ranking table first (e.g. top 1000 by revenue), then use $label.id to fetch metadata only for those IDs from the other DB. This keeps both datasets small and aligned.
      
      ## Example:
      query 1: connection=prod_revenue, query="SELECT product_id, SUM(revenue) AS revenue FROM sales GROUP BY product_id ORDER BY revenue DESC LIMIT 1000", label="revenue"
      query 2: connection=prod_catalog, query="SELECT id, name, category FROM products WHERE id IN ($revenue.product_id)", label="products"
      prompt: "Group these products into 5 clusters based on their names and categories. Return a mapping of cluster_name → [product_ids]."

      For a MongoDB connection, query is instead a JSON string {"collection": "...", "pipeline": [...]} (a native aggregation pipeline). $label.column references work inside it as quoted tokens, e.g. {"$match": {"id": {"$in": "$revenue.product_id"}}} expands to a JSON array of the referenced values. If you put "$x.y" inside $in/$nin and x isn't a defined label, the tool returns an explicit "unknown label" error listing the labels you have — that's the right thing to fix first when you see "$in needs an array" surfaced from the engine.
      `,
    parameters: ExploreDatasetParams,
  };

  private connectors = new Map<string, NodeConnector>();
  private dialects = new Map<string, string>();

  async run(): Promise<ToolResponse<ExploreDatasetDetails>> {
    // 1. Build connectors
    await buildConnectorsFromContext(
      this.context.connections, this.connectors, this.dialects, this.context.datasetKey,
    );
    // Always make the built-in `_scratch` DuckDB available — parity with
    // ChainedExecuteQuery. The agent learns about it from the V1 prompt
    // and uses it across BOTH tools to run `FROM handle_xyz` joins in
    // datasets that have no other DuckDB/sqlite connection.
    if (!this.connectors.has('_scratch')) {
      const scratch = await getOrCreateBenchmarkConnector('_scratch', 'duckdb', {});
      this.connectors.set('_scratch', scratch);
      this.dialects.set('_scratch', 'duckdb');
    }

    const { queries, prompt } = this.parameters;

    // 2. Execute queries sequentially, interpolating $label.col references
    const dataSections: string[] = [];
    const executedQueries: ExploreDatasetDetails['executedQueries'] = [];
    const labeledResults = new Map<string, Record<string, unknown>[]>();
    let totalRowCount = 0;

    for (let i = 0; i < queries.length; i++) {
      const { connection, query: rawQuery, label } = queries[i];
      const connector = this.connectors.get(connection);
      if (!connector) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Connection '${connection}' not found. Use ListDBConnections to see available connections.` }) }],
          isError: true,
          details: { analysis: '', totalRowCount: 0, executedQueries },
        };
      }

      const dialect = this.dialects.get(connection) ?? 'duckdb';
      const isMongo = dialect === 'mongo';

      // Validate: result-set size must be >= 1000 (smaller misses relevant data).
      // SQL: a `LIMIT n` clause; Mongo: a terminal `{$limit:n}` pipeline stage.
      const lowLimit = detectLowLimit(rawQuery, isMongo);
      if (lowLimit !== null) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Query "${label || connection}" has a row limit of ${lowLimit} which is too low — a smaller limit will miss relevant data and lead to incorrect results. Use a limit of 1000 or higher.` }) }],
          isError: true,
          details: { analysis: '', totalRowCount: 0, executedQueries },
        };
      }

      // Validate: 2nd+ queries must reference an earlier result via $label.col
      if (i > 0 && !/\$[a-zA-Z_]\w*\.\w+/.test(rawQuery)) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Query ${i + 1} ("${label || connection}") must reference an earlier query result using $label.column_name (e.g. WHERE id IN ($${queries[0].label || 'prev'}.id)). For independent explorations, use separate ExploreDataset calls.` }) }],
          isError: true,
          details: { analysis: '', totalRowCount: 0, executedQueries },
        };
      }

      // Preflight: on Mongo, catch `$in: "$x.y"` references to unknown
      // labels BEFORE we send to the engine — its raw error ("$in needs
      // an array") doesn't mention the missing label.
      if (isMongo) {
        const unknown = findUnresolvedMongoLabelRefs(rawQuery, labeledResults);
        if (unknown.length > 0) {
          const knownList = [...labeledResults.keys()].join(', ') || '(none)';
          return {
            content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Query ${i + 1} ("${label || connection}") references label(s) [${unknown.join(', ')}] inside $in/$nin, but no such label is defined. Available labels: [${knownList}]. Either set the label on an earlier query or fix the typo.` }) }],
            isError: true,
            details: { analysis: '', totalRowCount: 0, executedQueries },
          };
        }
      }

      // Interpolate references to previous query results (e.g. $revenue.product_id)
      const interpolated = isMongo
        ? interpolateMongoRefs(rawQuery, labeledResults)
        : interpolateRefs(rawQuery, labeledResults);

      let result: QueryResult;
      try {
        // For SQL queries, rewrite `FROM handle_xyz` → `memory.main."handle_xyz"`
        // so the reference resolves to the shared-DuckDB handle table —
        // parity with ChainedExecuteQuery. Block handle refs on non-SQL
        // dialects (handles are SQL tables in the shared DuckDB).
        let prepared: string;
        if (isMongo) {
          prepared = interpolated;
        } else {
          const { sql, referencedHandles } = await qualifyHandleRefs(interpolated);
          if (referencedHandles.length > 0 && dialect !== 'duckdb' && dialect !== 'sqlite') {
            return {
              content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Query ${i + 1} (${connection}) references labelled query result(s) (${referencedHandles.join(', ')}) on a '${dialect}' connection. To chain a prior labelled result here, use \`sequential: true\` + \`$label.column\` instead of \`FROM handle_xyz\`.` }) }],
              isError: true,
              details: { analysis: '', totalRowCount: 0, executedQueries },
            };
          }
          prepared = sql;
        }
        // enforceQueryLimit is a SQL-AST parser — skip it for Mongo; the
        // connector's own enforceMongoLimit caps native pipelines.
        const cappedQuery = isMongo ? prepared : await enforceQueryLimit(prepared, { dialect });
        result = await connector.query(cappedQuery);
        executedQueries.push({ connection, finalQuery: result.finalQuery ?? cappedQuery, rowCount: result.rows.length });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Query ${i + 1} (${connection}) failed: ${errMsg}` }) }],
          isError: true,
          details: { analysis: '', totalRowCount: 0, executedQueries },
        };
      }

      if (label) labeledResults.set(label, result.rows);
      totalRowCount += result.rows.length;

      const columns = result.columns ?? (result.rows[0] ? Object.keys(result.rows[0]) : []);
      const types = result.types ?? columns.map(() => 'unknown');
      const compressed = compressQueryResult(
        { columns, types, rows: result.rows },
        TOOL_MAX_LIMIT_CHARS,
      );

      const header = label || `Dataset ${i + 1} (${connection})`;
      dataSections.push(`## ${header}\n${compressed.data}`);
    }

    // 3. Call LLM with combined data + prompt
    const rowSummary = executedQueries.map(q => `${q.rowCount} rows from ${q.connection}`).join(', ');
    const userContent = `${dataSections.join('\n\n')}\n\n## Task (${rowSummary} — process ALL rows, not just a sample)\n${prompt}`;
    const ctx: Context = {
      systemPrompt: buildExploreSystemPrompt(this.context.contextDocs),
      messages: [
        { role: 'user', content: userContent, timestamp: Date.now() },
      ],
      tools: [],
    };

    const model = exploreModel;
    const responseMsg = await this.orchestrator.callLLM(model, ctx, this.id, { maxTokens: 16384 });
    const analysis = extractText(responseMsg);

    return {
      content: [{ type: 'text', text: JSON.stringify({ success: true, analysis, executedQueries }) }],
      isError: false,
      details: { analysis, totalRowCount, executedQueries },
    };
  }
}

// ─── pure helpers ─────────────────────────────────────────────────────────

function extractText(msg: AssistantMessage): string {
  return msg.content
    .filter((c): c is TextContent => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
    .trim();
}
