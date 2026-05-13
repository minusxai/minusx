// ExploreDataset: runs a SQL query and passes the results to an LLM for
// analysis. Useful for entity resolution, deduplication, clustering, and
// other data-reasoning tasks that can't be expressed in SQL alone.

import { Type, type Tool } from '@mariozechner/pi-ai';
import type { AssistantMessage, Context, TextContent } from '@mariozechner/pi-ai';
import { MXTool, type ToolResponse } from '@/orchestrator/types';
import { type BenchmarkAnalystContext, type ConnectionInfo } from './types';
import { compressQueryResult, TOOL_MAX_LIMIT_CHARS } from '@/lib/api/compress-augmented';
import { enforceQueryLimit } from '@/lib/sql/limit-enforcer';
import { getOrCreateBenchmarkConnector } from './shared-duckdb';
import type { NodeConnector, QueryResult } from '@/lib/connections/base';
import { getModel } from '@/lib/llm/get-model';
import type { Api, Model } from '@/lib/llm/get-model';

const DEFAULT_EXPLORE_MODEL = getModel('anthropic', 'claude-haiku-4-5-20251001');

// Overridable for testing (faux provider).
let exploreModel: Model<Api> = DEFAULT_EXPLORE_MODEL;
export function setExploreModel(model: Model<Api>) { exploreModel = model; }

// ─── Shared connector wiring (same as db-tools.ts) ──────────────────────
async function buildConnectorsFromContext(
  connections: ConnectionInfo[] | undefined,
  connectors: Map<string, NodeConnector>,
  dialects?: Map<string, string>,
): Promise<void> {
  for (const entry of connections ?? []) {
    if (!entry.config) continue;
    if (connectors.has(entry.name)) continue;
    const c = await getOrCreateBenchmarkConnector(entry.name, entry.dialect, entry.config);
    connectors.set(entry.name, c);
    dialects?.set(entry.name, entry.dialect);
  }
}

// ─── ExploreDataset ──────────────────────────────────────────────────────

const ExploreDatasetParams = Type.Object({
  connection: Type.String({ description: 'Database connection name' }),
  query: Type.String({ description: 'SQL query to fetch the data to analyze. Typically ordered by some relevant column, ~1000 rows max.' }),
  prompt: Type.String({ description: 'A precise, 1-2 sentence instruction. State exactly what output you need (e.g. "group rows by real-world entity and return a mapping of canonical_name → [ids]"). Do NOT ask open-ended questions.' }),
});

interface ExploreDatasetDetails extends Record<string, unknown> {
  analysis: string;
  queryRowCount: number;
  finalQuery?: string;
}

const SYSTEM_PROMPT = `You are a data tool. Another agent sends you data + a task. Return ONLY the answer — no preamble, no methodology, no commentary.

You are invoked when:
- When the main agent needs an LLM to reason about the data — such as entity resolution, deduplication, clustering, pattern detection, or other tasks that can't be expressed in SQL. You are mainly invoked for unknown-unknowns where FuzzySearch isn't applicable (e.g. grouping similar rows across the whole table is O(n²) for FuzzySearch but natural for an LLM).

Output format:
- Structured and machine-readable: IDs, mappings, lists, JSON, or tables.
- No prose. No bullet-point explanations. No "Here is the analysis:" headers.
- If the data is insufficient, reply: "INSUFFICIENT DATA: <one-line reason>"
- If the task asks for groupings, return them as: Group "label": id1, id2, id3`;

export class ExploreDataset extends MXTool<
  typeof ExploreDatasetParams,
  BenchmarkAnalystContext,
  ExploreDatasetDetails
> {
  static readonly schema: Tool<typeof ExploreDatasetParams> = {
    name: 'ExploreDataset',
    description:
      'Runs a SQL query (up to 1000 rows) and passes the results to an LLM for analysis. Use for entity resolution, deduplication, clustering, or pattern detection that cannot be expressed in SQL alone.',
    parameters: ExploreDatasetParams,
  };

  private connectors = new Map<string, NodeConnector>();
  private dialects = new Map<string, string>();

  async run(): Promise<ToolResponse<ExploreDatasetDetails>> {
    // 1. Build connectors
    await buildConnectorsFromContext(this.context.connections, this.connectors, this.dialects);

    const { connection, query: rawQuery, prompt } = this.parameters;

    // 2. Execute the query
    const connector = this.connectors.get(connection);
    if (!connector) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Connection '${connection}' not found. Use ListDBConnections to see available connections.` }) }],
        isError: true,
        details: { analysis: '', queryRowCount: 0 },
      };
    }

    let result: QueryResult;
    try {
      const dialect = this.dialects.get(connection) ?? 'duckdb';
      const cappedSql = await enforceQueryLimit(rawQuery, { dialect });
      result = await connector.query(cappedSql);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: errMsg }) }],
        isError: true,
        details: { analysis: '', queryRowCount: 0 },
      };
    }

    // 3. Format results as text for the LLM
    const columns = result.columns ?? (result.rows[0] ? Object.keys(result.rows[0]) : []);
    const types = result.types ?? columns.map(() => 'unknown');
    const compressed = compressQueryResult(
      { columns, types, rows: result.rows },
      TOOL_MAX_LIMIT_CHARS,
    );

    // 4. Call LLM with data + prompt
    const userContent = `## Data\n${compressed.data}\n\n## Task\n${prompt}`;
    const ctx: Context = {
      systemPrompt: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: userContent, timestamp: Date.now() },
      ],
      tools: [],
    };

    const model = exploreModel;
    const responseMsg = await this.orchestrator.callLLM(model, ctx, this.id);
    const analysis = extractText(responseMsg);

    const finalQuery = result.finalQuery ?? rawQuery;

    return {
      content: [{ type: 'text', text: JSON.stringify({ success: true, analysis, finalQuery }) }],
      isError: false,
      details: { analysis, queryRowCount: result.rows.length, finalQuery },
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
