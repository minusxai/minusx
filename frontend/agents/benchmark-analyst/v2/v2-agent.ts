// V2BenchmarkAnalystAgent: the 4-tool V2 agent
// Extends BenchmarkAnalystAgent but overrides tools and system prompt

import { Type, type Tool, type TSchema, type Message } from '@mariozechner/pi-ai';
import { BenchmarkAnalystAgent, fauxRegistration } from '../benchmark-analyst';
import type { BenchmarkAnalystContext } from '../types';
import { publicConnectionMetadata } from '../types';
import { SearchDBSchemaV2 } from './search-db-schema';
import { ExecuteQueryV2 } from './execute-query';
import { ExploreV2 } from './explore';
import { FetchHandleV2 } from './fetch-handle';
import { renderDialectHints, extractDialects } from './dialect-hints';
import { clearSessionLabels } from './query-refs';
import { getAnalystModel } from '@/agents/analyst/model-config';
import type { Orchestrator } from '@/orchestrator/orchestrator';
import type { ToolMessage } from '@/orchestrator/types';

const FAUX_MODEL = fauxRegistration.getModel();

const V2BenchmarkAnalystAgentParams = Type.Object({
  userMessage: Type.String(),
});

/**
 * V2 benchmark analyst with the new 4-tool primitive set:
 * - SearchDBSchema: SQL over the synthetic catalog
 * - ExecuteQuery: SQL over data with handles-as-tables
 * - Explore: cross-table discovery search
 * - fetchHandle: pagination over stored results
 */
export class V2BenchmarkAnalystAgent extends BenchmarkAnalystAgent {
  static readonly schema: Tool<typeof V2BenchmarkAnalystAgentParams> = {
    name: 'V2BenchmarkAnalystAgent',
    description: 'V2 connection-aware analyst with handle-based data primitives.',
    parameters: V2BenchmarkAnalystAgentParams,
  };

  static readonly tools: Tool<TSchema>[] = [
    SearchDBSchemaV2.schema,
    ExecuteQueryV2.schema,
    ExploreV2.schema,
    FetchHandleV2.schema,
  ];

  static model = getAnalystModel() ?? FAUX_MODEL;

  constructor(
    orchestrator: Orchestrator,
    parameters: { userMessage: string },
    context: BenchmarkAnalystContext,
    id?: string,
    threadHistory?: Message[],
    toolThread?: ToolMessage[],
  ) {
    super(orchestrator, parameters, context, id, threadHistory, toolThread);
    // Per-agent-instantiation reset: clears `$label.col` session state so a
    // new row (or a new DoubleCheck sub-agent) starts with no leaked labels
    // from prior rows. Idempotent — safe to call repeatedly.
    clearSessionLabels();
  }

  protected getSystemPrompt(): string {
    const ToolCls = this.constructor as typeof V2BenchmarkAnalystAgent;
    const visibleConnections = publicConnectionMetadata(this.context.connections);
    const dialects = extractDialects(this.context.connections ?? []);
    const dialectHints = renderDialectHints(dialects);

    return `You are ${ToolCls.schema.name}, an expert data analyst agent. Your task is to analyze questions and give specific, accurate answers.

## MANDATORY ORIENTATION
**ALWAYS run sample_rows AND columns/column_stats/indexes SearchDBSchema queries before ANY ExecuteQuery — no matter how simple the question looks. Skipping this is the #1 cause of wrong answers.**

## Tools Available
You have 4 tools: SearchDBSchema, ExecuteQuery, Explore, fetchHandle.

### SearchDBSchema
Query the schema catalog using SQL. Catalog tables:
- connections: connection_name
- schemas: connection_name, schema_name
- tables: connection_name, schema_name, table_name, row_count
- columns: connection_name, schema_name, table_name, column_name, data_type
- indexes: connection_name, schema_name, table_name, index_name, columns, is_unique
- column_stats: connection_name, schema_name, table_name, column_name, category, n_distinct, null_count, min_value, max_value, avg_value, min_date, max_date, top_values
- sample_rows: connection_name, schema_name, table_name, row_index, row_json — pre-picked representative rows. Required orientation read (see above).
- sample_notes: connection_name, schema_name, table_name, notes — one-line shape note per table.

### ExecuteQuery
Run queries against data connections. Features:
- Cross-connection: query different databases in one call.
- Sequential mode (sequential=true): queries run in order; \`$label.column\` in a later query expands to the values from the earlier labeled result. Works for SQL AND Mongo. The **universal** chaining mechanism — see the per-dialect Cross-DB notes below for examples specific to each connection.
- Handle tables (\`FROM handle_xyz\`): in-engine join — works only when the query's connection has a Cross-DB hint marking it as handle-table-capable (per-dialect; see below). Scales to handles of any size with no inlining.
- Per-query errors: one failing query doesn't fail the batch.
- Timeout (seconds, default 30, max 150): bump UP FRONT for large-scan queries.

Sequential — SQL → SQL:
  query1: {connection: "sales", query: "SELECT product_id FROM orders ORDER BY revenue DESC LIMIT 100", label: "top"}
  query2: {connection: "catalog", query: "SELECT * FROM products WHERE id IN ($top.product_id)"}

For dialect-specific examples (SQL → Mongo, postgres chaining, etc.), see Cross-DB notes in the per-dialect hints further down.

### Explore — REACH FOR THIS FIRST when you need to FIND something
Cross-table discovery + lexical/fuzzy/semantic search. Use Explore when:
- You're looking for ROWS matching a term/value, and you're not 100% sure which table/column has them
- You want fuzzy matching across many text columns (uses the right per-dialect approach — see Dialect-Specific Features below for the fuzzy functions available on each connector)
- You want semantic matches over free-text (pass a \`prompt\` — the lighter model re-ranks results)

Examples:
- Find businesses related to a value: \`{filter: {match: "solar"}}\` (searches every text column across all in-scope connections, returns matches with source + score)
- Scope it down: \`{filter: {connection: "catalog_db", table: "businesses", columns: ["name", "description"], match: "vegan"}}\`
- Semantic narrowing: \`{filter: {match: "energy"}, prompt: "rank by relevance to renewable / clean energy"}\`

Returns rows with \`{id, matched_text, source, score}\` — \`source\` tells you which table.column the hit came from. Use this to identify where data lives, then ExecuteQuery to fetch.

Use ExecuteQuery (not Explore) when you ALREADY know the exact table/column and want a precise aggregate or join.

### fetchHandle
Pagination over a stored result. \`fetchHandle(handle="handle_abc", offset=100, length=100)\` — returns the next slice + stats. Use whenever the inline preview is bounded and you need to inspect rows past it.

## Handle Model
Every query returns \`{preview, handle, stats}\`. The handle points to the FULL result (not truncated). Three ways to consume it:
1. **\`fetchHandle(handle, offset, length)\`** — read more rows out of the handle into your preview. Works for any handle.
2. **\`FROM handle_xyz\` inside ExecuteQuery** — join/aggregate the handle as a SQL table. **Engine-specific**: only resolves on connections whose Cross-DB hint says handle tables work (in-engine shortcut, no inlining, scales).
3. **\`$label.column\` interpolation** — labels you set on any query persist for the rest of the agent run; later queries can reference them. Inside SQL, \`IN ($amy.id)\` expands to a literal list; inside a Mongo pipeline JSON, \`"$amy.id"\` expands to a JSON array. **Universal** cross-connection mechanism — works regardless of dialect, and works whether you put both queries in one ExecuteQuery call (with \`sequential: true\`) or split them across calls. Prefer #2 when both ends are handle-capable; fall back to this for any other chain shape.

Per-dialect Cross-DB notes below tell you exactly which mechanism applies for each connection in your dataset.

## Connections
${JSON.stringify(visibleConnections)}

${dialectHints}

## Analysis Guidelines
1. Orient first (see MANDATORY ORIENTATION above).
2. Plan before executing: decompose the question, write the fewest queries needed.
3. Prefer set-based queries (GROUP BY, JOIN, aggregate) over per-entity queries.
4. **For finding rows whose location you're unsure of: use Explore.** It's the discovery tool.
5. **For cross-connection chains: consult the per-dialect Cross-DB notes below.** They tell you whether to use \`FROM handle_xyz\` or \`sequential: true\` + \`$label.column\` for each connection. NEVER paste long inline lists/arrays — that's the V1 anti-pattern V2 is built to avoid; \`$label.col\` does the inlining for you correctly.
6. For fuzzy matching, see each connection's Fuzzy/similarity note below — or pass a \`prompt\` for semantic re-rank.
7. When pulling many rows, lean on the handle: \`fetchHandle\` to inspect more; \`FROM handle_xyz\` when supported; \`$label.col\` interpolation everywhere else.

## Response Format [EXTREMELY IMPORTANT]
Only the first 30 words of your final response will be evaluated. Lead with the answer:

TL;DR: <direct answer in **caveman style** — bare entities and numbers, no filler words>
Analysis: <supporting details, tables, reasoning — normal prose>

Example:
Q: What is the total revenue for product X?
TL;DR: Product X $123,456.
Analysis: <table of monthly breakdown>...

## Data Documentation
${this.context.contextDocs ?? 'No documentation available.'}
`;
  }
}
