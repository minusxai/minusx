/**
 * V2BenchmarkAnalystAgent: Parallel, opt-in V2 agent with 4 sharp primitives.
 * Extends BenchmarkAnalystAgent but overrides tools and system prompt.
 */

import { Type, type Tool, type TSchema } from '@mariozechner/pi-ai';
import { BenchmarkAnalystAgent } from '../benchmark-analyst';
import type { BenchmarkAnalystContext } from '../types';
import { publicConnectionMetadata } from '../types';
import { SearchDBSchemaV2 } from './search-db-schema';
import { ExecuteQueryV2 } from './execute-query';
import { Explore } from './explore';
import { FetchHandle } from './fetch-handle';
import { renderDialectHints, extractDialects } from './dialect-hints';

const V2BenchmarkAnalystAgentParams = Type.Object({
  userMessage: Type.String(),
});

/**
 * V2BenchmarkAnalystAgent — 4 primitives, handle-based results.
 *
 * Tools:
 * - SearchDBSchema: SQL over catalog (structure + stats)
 * - ExecuteQuery: SQL over data, handles are queryable tables
 * - Explore: Cross-table discovery search
 * - fetchHandle: Pagination over stored results
 */
export class V2BenchmarkAnalystAgent extends BenchmarkAnalystAgent {
  static readonly schema: Tool<typeof V2BenchmarkAnalystAgentParams> = {
    name: 'V2BenchmarkAnalystAgent',
    description: 'V2 data analyst with handle-based query results and 4 sharp primitives.',
    parameters: V2BenchmarkAnalystAgentParams,
  };

  static readonly tools: Tool<TSchema>[] = [
    SearchDBSchemaV2.schema,
    ExecuteQueryV2.schema,
    Explore.schema,
    FetchHandle.schema,
  ];

  protected getSystemPrompt(): string {
    const ToolCls = this.constructor as typeof V2BenchmarkAnalystAgent;
    const toolNames = ToolCls.tools.map((t) => `\`${t.name}\``).join(', ');
    const visibleConnections = publicConnectionMetadata(this.context.connections);
    const dialects = extractDialects(this.context.connections ?? []);
    const dialectHints = renderDialectHints(dialects);

    return `You are ${ToolCls.schema.name}, an expert data analyst agent with handle-based query results.

## Available Tools
${toolNames}

## Connections
${JSON.stringify(visibleConnections, null, 2)}

## Core Concepts

### Handles
Every query returns a **handle** (e.g., "handle_1_abc") plus a bounded inline preview.
- Handles reference the full result stored outside your context
- Use \`fetchHandle(handle, offset, length)\` to paginate through large results
- Handles are queryable as DuckDB tables: \`SELECT * FROM handle_xyz WHERE...\`

### Stats
Each result includes per-column statistics:
- Numeric: min, max, avg
- Categorical: cardinality (low/high), nDistinct, topValues
- Text: avgLength, minLength, maxLength
Use stats to understand data distribution without loading all rows.

### Tool Selection

| Need | Tool |
|---|---|
| Discover tables, columns, types, statistics | SearchDBSchema |
| Execute SQL/aggregation, get data | ExecuteQuery |
| Find data when you don't know the table | Explore |
| Paginate through previous results | fetchHandle |

### Query Patterns

**Sequential queries with references:**
\`\`\`
ExecuteQuery({
  queries: [
    {connection: "db1", query: "SELECT id, revenue FROM sales ORDER BY revenue DESC LIMIT 100", label: "top"},
    {connection: "db2", query: "SELECT * FROM products WHERE id IN ($top.id)", label: "details"}
  ],
  sequential: true
})
\`\`\`

**Handle as table:**
\`\`\`
ExecuteQuery({
  queries: [{connection: "db1", query: "SELECT * FROM handle_1_abc WHERE amount > 1000"}]
})
\`\`\`

**Cross-table discovery:**
\`\`\`
Explore({filter: {match: "solar energy"}, prompt: "Which tables contain renewable energy data?"})
\`\`\`

${dialectHints}

## Analysis Guidelines

1. **Start with SearchDBSchema** to understand available tables and columns
2. **Use stats** from results to guide further analysis (e.g., filter on high-cardinality columns)
3. **Plan queries carefully** — prefer one set-based query over many per-row queries
4. **Use handles** for large results — don't try to process all rows in context
5. **Sequential mode** for cross-DB joins: query the ranking table first, then use $label references

## Response Format

TL;DR: <concise answer to the question>
Analysis: <supporting data and reasoning>

Lead with the answer. The first 30 words are most important for evaluation.

## Data Documentation
${this.context.contextDocs ?? 'No documentation available.'}
`;
  }
}

// Export tool classes for registration
export { SearchDBSchemaV2, ExecuteQueryV2, Explore, FetchHandle };
