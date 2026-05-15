// SearchDBSchemaV2: SQL queries against the synthetic catalog
// Catalog tables: connections, schemas, tables, columns, indexes, column_stats

import { Type, type Tool } from '@mariozechner/pi-ai';
import { type ToolResponse } from '@/orchestrator/types';
import type { QueryResult } from '@/lib/connections/base';
import { getCatalogStore } from './catalog';
import { storeHandle } from './handle-store';
import { computeResultStats, type ResultStats } from './result-stats';
import { type PromptPassEntry } from './prompt-pass';
import { V2DataTool, getLighterModel } from './data-tool-base';
import { compressQueryResult, TOOL_MAX_LIMIT_CHARS } from '@/lib/api/compress-augmented';

const CatalogQuerySpec = Type.Object({
  query: Type.String({ description: 'SQL query against the catalog tables' }),
  label: Type.Optional(Type.String({ description: 'Short label for this query result' })),
});

const SearchDBSchemaParams = Type.Object({
  queries: Type.Array(CatalogQuerySpec, {
    description: 'One or more SQL queries against the catalog. Catalog tables: connections, schemas, tables, columns, indexes, column_stats.',
    minItems: 1,
  }),
  prompt: Type.Optional(Type.String({ description: 'Optional: if provided, an LLM summarizes all results and returns a single info string' })),
  sequential: Type.Optional(Type.Boolean({ description: 'If true, queries run sequentially (default: false, parallel)' })),
  maxChars: Type.Optional(Type.Number({
    description: 'Max characters of inline preview rows per result (default ~10,000). Increase up front (e.g. 30000–50000) only when you genuinely need to see more rows inline. Otherwise use the default + `fetchHandle` for pagination.',
  })),
});

interface QueryResultEntry {
  preview?: string;
  handle?: string;
  stats?: ResultStats;
  error?: string;
  /** See ExecuteQueryV2 — set when the result can't be registered as a
   *  SQL table (e.g. catalog query with duplicate aliases). */
  handle_error?: string;
}

interface SearchDBSchemaDetails {
  catalogBuilt: boolean;
  queryCount: number;
}

export class SearchDBSchemaV2 extends V2DataTool<typeof SearchDBSchemaParams, SearchDBSchemaDetails> {
  static readonly schema: Tool<typeof SearchDBSchemaParams> = {
    name: 'SearchDBSchema',
    description: `Query the database schema catalog using SQL. The catalog is a set of 6 tables built from all connection schemas:

CATALOG TABLES:
- connections: connection_name
- schemas: connection_name, schema_name
- tables: connection_name, schema_name, table_name, row_count
- columns: connection_name, schema_name, table_name, column_name, data_type
- indexes: connection_name, schema_name, table_name, index_name, columns, is_unique
- column_stats: connection_name, schema_name, table_name, column_name, category, n_distinct, null_count, min_value, max_value, avg_value, min_date, max_date, top_values

EXAMPLES:
- List all tables: SELECT * FROM tables
- Find columns with 'user' in name: SELECT * FROM columns WHERE column_name LIKE '%user%'
- Find categorical columns: SELECT * FROM column_stats WHERE category = 'categorical'
- Find tables with indexes: SELECT DISTINCT table_name FROM indexes

Each query returns {preview, handle, stats}. If prompt is provided, an LLM processes all results and returns a single info summary.`,
    parameters: SearchDBSchemaParams,
  };

  async run(): Promise<ToolResponse<SearchDBSchemaDetails>> {
    const { queries, prompt, sequential = false, maxChars } = this.parameters;
    const previewMaxChars = typeof maxChars === 'number' && maxChars > 0 ? maxChars : TOOL_MAX_LIMIT_CHARS;

    // Build catalog if needed (shared with Explore, cached process-wide)
    const { conn } = await getCatalogStore(this.context.connections);

    // Execute queries
    type Collected = { entry: QueryResultEntry; raw: QueryResult | null; label: string };

    const executeQuery = async (
      spec: { query: string; label?: string },
      index: number,
    ): Promise<Collected> => {
      const label = spec.label ?? `Query ${index + 1}`;
      try {
        const result = await conn.run(spec.query);
        const cc = result.columnCount;
        const columns: string[] = [];
        const types: string[] = [];
        for (let i = 0; i < cc; i++) {
          columns.push(result.columnName(i));
          types.push(result.columnType(i).toString());
        }
        const rows = await result.getRowObjectsJS() as Record<string, unknown>[];
        const queryResult: QueryResult = { columns, types, rows, finalQuery: spec.query };

        const stored = await storeHandle(queryResult);
        const stats = computeResultStats(queryResult, Math.min(rows.length, 100));
        // Skip the inline compress when a prompt is set — `runPromptPass`
        // produces the re-ranked preview from the raw rows.
        const preview = prompt
          ? undefined
          : compressQueryResult(queryResult, previewMaxChars).data;

        const entry: QueryResultEntry = stored.error
          ? { preview, stats, handle_error: stored.error }
          : { preview, handle: stored.handleId, stats };
        return { entry, raw: queryResult, label };
      } catch (err) {
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
      const { previews, info } = await this.runPromptPass(entries, prompt, getLighterModel(), previewMaxChars);
      previews.forEach((p, i) => {
        if (p !== undefined) results[i].preview = p;
      });
      response.info = info;
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(response) }],
      isError: false,
      details: { catalogBuilt: true, queryCount: queries.length },
    };
  }
}

// `clearCatalogCache` lives in `catalog.ts` now (shared with Explore).
export { clearCatalogCache } from './catalog';
