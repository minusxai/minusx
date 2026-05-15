// ExploreV2: Cross-table discovery search
// "Search when you don't know the table" — lexical matching with optional semantic re-ranking

import { Type, type Tool, type AssistantMessage, type Context, type TextContent } from '@mariozechner/pi-ai';
import { MXTool, type ToolResponse } from '@/orchestrator/types';
import type { BenchmarkAnalystContext, ConnectionInfo } from '../types';
import { getOrCreateBenchmarkConnector } from '../shared-duckdb';
import type { NodeConnector, QueryResult, SchemaEntry } from '@/lib/connections/base';
import { storeHandle } from './handle-store';
import { computeResultStats, type ResultStats } from './result-stats';
import { compressQueryResult, TOOL_MAX_LIMIT_CHARS } from '@/lib/api/compress-augmented';
import { getModel, type Api, type Model } from '@/lib/llm/get-model';

const DEFAULT_EXPLORE_MODEL = getModel('anthropic', 'claude-haiku-4-5-20251001');
let exploreModel: Model<Api> = DEFAULT_EXPLORE_MODEL;
export function setExploreModel(model: Model<Api>) { exploreModel = model; }

const ExploreFilter = Type.Object({
  connection: Type.Optional(Type.String({ description: 'Limit search to this connection' })),
  schema: Type.Optional(Type.String({ description: 'Limit search to this schema' })),
  table: Type.Optional(Type.String({ description: 'Limit search to this table' })),
  columns: Type.Optional(Type.Array(Type.String(), { description: 'Limit search to these columns' })),
  match: Type.String({ description: 'Term to search for (lexical/fuzzy matching)' }),
});

const ExploreParams = Type.Object({
  filter: ExploreFilter,
  prompt: Type.Optional(Type.String({ description: 'Optional: if provided, an LLM re-ranks/filters results semantically' })),
});

interface QueryResultEntry {
  preview?: string;
  handle?: string;
  stats?: ResultStats;
  error?: string;
}

interface ExploreDetails {
  connectionsSearched: number;
  tablesSearched: number;
  rowsFound: number;
}

interface SearchTarget {
  connection: string;
  schema: string;
  table: string;
  column: string;
  dialect: string;
}

export class ExploreV2 extends MXTool<
  typeof ExploreParams,
  BenchmarkAnalystContext,
  ExploreDetails
> {
  static readonly schema: Tool<typeof ExploreParams> = {
    name: 'Explore',
    description: `Cross-table discovery search — "search when you don't know which table has what you need."

Use Explore when:
- You need to find where a value/term appears across the database
- You're doing entity discovery or exploratory analysis
- You want to identify which tables/columns contain relevant data

Use ExecuteQuery when:
- You already know which table has your data
- You need to run specific SQL with joins, aggregations, etc.

FILTER OPTIONS:
- connection: limit to one connection
- schema: limit to one schema
- table: limit to one table
- columns: limit to specific column names
- match: the term to search for (required)

The search runs lexical/fuzzy matching across all text columns in scope.
Results include source (table.column) and score columns.

If prompt is provided, an LLM re-ranks results semantically (e.g., "rank by relevance to renewable energy").`,
    parameters: ExploreParams,
  };

  private connectors = new Map<string, NodeConnector>();
  private dialects = new Map<string, string>();
  private schemas = new Map<string, SchemaEntry[]>();

  private async initConnectors(): Promise<void> {
    for (const entry of this.context.connections ?? []) {
      if (!entry.config) continue;
      if (this.connectors.has(entry.name)) continue;
      const c = await getOrCreateBenchmarkConnector(entry.name, entry.dialect, entry.config);
      this.connectors.set(entry.name, c);
      this.dialects.set(entry.name, entry.dialect);
      try {
        const schema = await c.getSchema();
        this.schemas.set(entry.name, schema);
      } catch {
        this.schemas.set(entry.name, []);
      }
    }
  }

  async run(): Promise<ToolResponse<ExploreDetails>> {
    const { filter, prompt } = this.parameters;

    await this.initConnectors();

    // Validate connection filter if provided
    if (filter.connection && !this.connectors.has(filter.connection)) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ error: `Connection '${filter.connection}' not found. Available: ${Array.from(this.connectors.keys()).join(', ')}` }),
        }],
        isError: true,
        details: { connectionsSearched: 0, tablesSearched: 0, rowsFound: 0 },
      };
    }

    // Find all searchable targets (text columns in scope)
    const targets = this.findSearchTargets(filter);

    // Run searches
    const allRows: Record<string, unknown>[] = [];
    const searchedConnections = new Set<string>();
    const searchedTables = new Set<string>();

    for (const target of targets) {
      searchedConnections.add(target.connection);
      searchedTables.add(`${target.connection}.${target.table}`);

      try {
        const rows = await this.searchColumn(target, filter.match);
        allRows.push(...rows);
      } catch (err) {
        // Continue with other columns
        console.warn(`Search failed for ${target.connection}.${target.table}.${target.column}:`, err);
      }
    }

    // Sort by score descending
    allRows.sort((a, b) => (b.score as number) - (a.score as number));

    // Build result
    const result: QueryResult = {
      columns: ['id', 'matched_text', 'source', 'score'],
      types: ['VARCHAR', 'VARCHAR', 'VARCHAR', 'DOUBLE'],
      rows: allRows.slice(0, 1000), // Cap at 1000 results
      finalQuery: `EXPLORE match="${filter.match}"`,
    };

    const handle = storeHandle(result);
    const compressed = compressQueryResult(result, TOOL_MAX_LIMIT_CHARS);
    const stats = computeResultStats(result, Math.min(result.rows.length, 100));

    const response: { results: QueryResultEntry[]; info?: string } = {
      results: [{ preview: compressed.data, handle, stats }],
    };

    // If prompt provided, call LLM for re-ranking
    if (prompt && result.rows.length > 0) {
      const ctx: Context = {
        systemPrompt: 'You are a data tool. Re-rank or filter the search results based on the user\'s criteria. Return a brief summary of the most relevant findings. Do not re-emit all the data — reference row IDs or summarize patterns.',
        messages: [
          { role: 'user', content: `Search results for "${filter.match}":\n${compressed.data}\n\n## Task\n${prompt}`, timestamp: Date.now() },
        ],
        tools: [],
      };

      const msg = await this.orchestrator.callLLM(exploreModel, ctx, this.id, { maxTokens: 4096 });
      response.info = extractText(msg);
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(response) }],
      isError: false,
      details: {
        connectionsSearched: searchedConnections.size,
        tablesSearched: searchedTables.size,
        rowsFound: result.rows.length,
      },
    };
  }

  private findSearchTargets(filter: {
    connection?: string;
    schema?: string;
    table?: string;
    columns?: string[];
    match: string;
  }): SearchTarget[] {
    const targets: SearchTarget[] = [];
    const TEXT_TYPES = new Set(['VARCHAR', 'TEXT', 'STRING', 'CHAR', 'NVARCHAR', 'NCHAR']);

    for (const [connName, schemaEntries] of this.schemas) {
      if (filter.connection && filter.connection !== connName) continue;

      const dialect = this.dialects.get(connName) ?? 'duckdb';

      for (const schemaEntry of schemaEntries) {
        if (filter.schema && filter.schema !== schemaEntry.schema) continue;

        for (const table of schemaEntry.tables) {
          if (filter.table && filter.table !== table.table) continue;

          for (const col of table.columns) {
            // Check if text column
            const isText = TEXT_TYPES.has(col.type.toUpperCase()) ||
              col.type.toUpperCase().includes('VARCHAR') ||
              col.type.toUpperCase().includes('TEXT') ||
              col.type.toUpperCase().includes('CHAR');

            if (!isText) continue;

            // Check column filter
            if (filter.columns && !filter.columns.includes(col.name)) continue;

            targets.push({
              connection: connName,
              schema: schemaEntry.schema,
              table: table.table,
              column: col.name,
              dialect,
            });
          }
        }
      }
    }

    return targets;
  }

  private async searchColumn(
    target: SearchTarget,
    match: string,
  ): Promise<Record<string, unknown>[]> {
    const connector = this.connectors.get(target.connection);
    if (!connector) return [];

    const escapedMatch = match.replace(/'/g, "''");
    const source = `${target.table}.${target.column}`;

    // Build search query based on dialect
    let sql: string;
    if (target.dialect === 'duckdb') {
      // DuckDB has jaro_winkler_similarity
      sql = `
        SELECT
          rowid as id,
          "${target.column}" as matched_text,
          '${source}' as source,
          jaro_winkler_similarity("${target.column}", '${escapedMatch}') as score
        FROM "${target.table}"
        WHERE "${target.column}" IS NOT NULL
          AND (
            "${target.column}" ILIKE '%${escapedMatch}%'
            OR jaro_winkler_similarity("${target.column}", '${escapedMatch}') > 0.7
          )
        ORDER BY score DESC
        LIMIT 100
      `;
    } else {
      // Generic: use LIKE
      sql = `
        SELECT
          CAST(rowid AS VARCHAR) as id,
          "${target.column}" as matched_text,
          '${source}' as source,
          CASE
            WHEN LOWER("${target.column}") = LOWER('${escapedMatch}') THEN 1.0
            WHEN LOWER("${target.column}") LIKE LOWER('%${escapedMatch}%') THEN 0.8
            ELSE 0.5
          END as score
        FROM "${target.table}"
        WHERE "${target.column}" IS NOT NULL
          AND LOWER("${target.column}") LIKE LOWER('%${escapedMatch}%')
        ORDER BY score DESC
        LIMIT 100
      `;
    }

    try {
      const result = await connector.query(sql);
      return result.rows;
    } catch {
      // Fallback: simpler query without rowid
      const fallbackSql = `
        SELECT
          "${target.column}" as matched_text,
          '${source}' as source,
          0.8 as score
        FROM "${target.table}"
        WHERE "${target.column}" IS NOT NULL
          AND LOWER("${target.column}") LIKE LOWER('%${escapedMatch}%')
        LIMIT 100
      `;
      try {
        const result = await connector.query(fallbackSql);
        return result.rows.map((row, i) => ({ id: String(i), ...row }));
      } catch {
        return [];
      }
    }
  }
}

function extractText(msg: AssistantMessage): string {
  return msg.content
    .filter((c): c is TextContent => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
    .trim();
}
