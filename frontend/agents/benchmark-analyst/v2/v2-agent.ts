// V2BenchmarkAnalystAgent: the 4-tool V2 agent
// Extends BenchmarkAnalystAgent but overrides tools and system prompt

import { Type, type Tool, type TSchema } from '@mariozechner/pi-ai';
import { BenchmarkAnalystAgent, fauxRegistration } from '../benchmark-analyst';
import type { BenchmarkAnalystContext } from '../types';
import { publicConnectionMetadata } from '../types';
import { SearchDBSchemaV2 } from './search-db-schema';
import { ExecuteQueryV2 } from './execute-query';
import { ExploreV2 } from './explore';
import { FetchHandleV2 } from './fetch-handle';
import { renderDialectHints, extractDialects } from './dialect-hints';
import { getAnalystModel } from '@/agents/analyst/model-config';

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

  protected getSystemPrompt(): string {
    const ToolCls = this.constructor as typeof V2BenchmarkAnalystAgent;
    const visibleConnections = publicConnectionMetadata(this.context.connections);
    const dialects = extractDialects(this.context.connections ?? []);
    const dialectHints = renderDialectHints(dialects);

    return `You are ${ToolCls.schema.name}, an expert data analyst agent. Your task is to analyze questions and give specific, accurate answers.

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

Example: SELECT * FROM columns WHERE table_name = 'orders'

### ExecuteQuery
Run SQL queries against data connections. Features:
- Cross-connection: query different databases in one call
- Sequential mode: queries run in order, $label.column references expand to earlier results
- Handle tables: any stored handle can be queried as a table (FROM handle_xyz)
- Per-query errors: one failing query doesn't fail the batch

Example sequential:
  query1: {connection: "sales", query: "SELECT product_id FROM orders ORDER BY revenue DESC LIMIT 100", label: "top"}
  query2: {connection: "catalog", query: "SELECT * FROM products WHERE id IN ($top.product_id)"}

### Explore
Cross-table discovery search — use when you don't know which table has your data.
Searches all text columns matching your filter, returns matches with source and score.
Example: {filter: {match: "solar"}, prompt: "rank by relevance to renewable energy"}

### fetchHandle
Pagination over stored results. Every query returns a handle; use fetchHandle to see more rows.
Example: fetchHandle(handle="handle_abc", offset=100, length=100)

## Handle Model
Every query returns a handle (e.g., "handle_abc123") plus a bounded preview and stats.
- Full results live outside your context (not truncated)
- Use fetchHandle for more rows
- Use FROM handle_xyz in ExecuteQuery to join/aggregate on stored results

## Connections
${JSON.stringify(visibleConnections)}

${dialectHints}

## Analysis Guidelines
1. Start with SearchDBSchema to understand the schema, indexes, and column stats
2. Plan before executing: decompose the question, write the fewest queries needed
3. Prefer set-based queries (GROUP BY, JOIN, aggregate) over per-entity queries
4. Use the column_stats table to understand data distributions before filtering
5. For fuzzy matching: use SQL functions (jaro_winkler_similarity, LIKE, etc.)
6. For semantic tasks: use Explore with a prompt, or ExecuteQuery with a prompt

## Response Format [EXTREMELY IMPORTANT]
Only the first 30 words of your final response will be evaluated. Lead with the answer:

TL;DR: <direct answer to the question>
Analysis: <supporting details, tables, reasoning>

Example:
Q: What is the total revenue for product X?
TL;DR: $123,456 was the total revenue for product X in the last quarter.
Analysis: <table of monthly breakdown>...

## Data Documentation
${this.context.contextDocs ?? 'No documentation available.'}
`;
  }
}
