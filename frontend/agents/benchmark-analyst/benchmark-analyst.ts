import {
  Type,
  registerFauxProvider,
  type AssistantMessage,
  type Tool,
  type TSchema,
} from '@mariozechner/pi-ai';
import { MXAgent } from '@/orchestrator/types';
import { getAnalystModel } from '@/agents/analyst/model-config';
import { CatalogSearchDBSchema, ChainedExecuteQuery, FuzzyMatch } from './db-tools';
import { ExploreDataset } from './explore-dataset';
import { FetchHandleV2 } from './v2/fetch-handle';
import { renderDialectHints, extractDialects } from './v2/dialect-hints';
import { type BenchmarkAnalystContext, publicConnectionMetadata } from './types';
import { buildAutoContext, recordRecentAutoContext } from './v2/auto-context';

export const fauxRegistration = registerFauxProvider({
  api: 'faux-benchmark-analyst-api',
  provider: 'faux-benchmark-analyst',
  models: [{ id: 'stub-benchmark-analyst' }],
});
const FAUX_MODEL = fauxRegistration.getModel();

const BenchmarkAnalystAgentParams = Type.Object({
  userMessage: Type.String(),
});

/**
 * Bare-bones connection-aware analyst. Has DB tools only — no file system
 * access, no AppState wrapping. Subclasses (e.g. RemoteAnalystAgent) extend
 * with file tools, app context, and a richer user-content shape.
 *
 * Uses the `Base*` tool variants (`BaseSearchDBSchema`, `BaseExecuteQuery`)
 * which build NodeConnectors from `context.connections[*].config` at
 * `run()`-time and route queries directly to them. Production analyst
 * subclasses swap to the production tool variants (same `schema.name`,
 * different `run()`).
 */
export class BenchmarkAnalystAgent<
  TContext extends BenchmarkAnalystContext = BenchmarkAnalystContext,
> extends MXAgent<typeof BenchmarkAnalystAgentParams, TContext> {
  static readonly schema: Tool<typeof BenchmarkAnalystAgentParams> = {
    name: 'BenchmarkAnalystAgent',
    description: 'Connection-aware analyst that answers data questions via DB tools.',
    parameters: BenchmarkAnalystAgentParams,
  };
  static readonly tools: Tool<TSchema>[] = [
    CatalogSearchDBSchema.schema,
    ChainedExecuteQuery.schema,
    FetchHandleV2.schema,
    FuzzyMatch.schema,
    ExploreDataset.schema,
  ];
  static model = getAnalystModel() ?? FAUX_MODEL;

  /**
   * Markdown produced by the AutoContext step — verified joins, per-column
   * notes, sample rows, and example queries. Computed once at the start of
   * `run()` and appended to the system prompt (so Anthropic's prompt-cache
   * automatically reuses the block across rows of the same dataset within
   * its 5-min TTL — pi-ai marks the system prompt with `cache_control`).
   */
  protected autoContextBlock?: string;

  async run(): Promise<AssistantMessage> {
    const ctx = this.context;
    // AutoContext is benchmark-only: production paths (RemoteAnalystAgent
    // and friends) extend this class without a `datasetKey`, so they
    // bypass the upfront orientation pass entirely. The runner at
    // `frontend/benchmarks/runner.ts` always sets `datasetKey` on the
    // context, so benchmark rows always trigger it.
    if (ctx.datasetKey) {
      const userMessage = (this.parameters as { userMessage: string }).userMessage;
      try {
        this.autoContextBlock = await buildAutoContext(
          ctx.connections,
          { contextDocs: ctx.contextDocs, originalMessage: userMessage },
          (m, c) => this.orchestrator.callLLM(m, c, this.id, { maxTokens: 4096 }),
          {
            datasetKey: ctx.datasetKey,
            userMessage,
            // DoubleCheck sets `ctx.catalogKey` to 'agent-a' / 'agent-b'
            // per sub-agent so primary + secondary get isolated cache
            // slots (matches the per-slot catalog cache pattern).
            cacheKey: ctx.catalogKey,
          },
        );
      } catch (e) {
        // AutoContext is best-effort orientation. Failures (DB blip,
        // LLM error) must not abort the run — fall back to no block.
        // We log the error so silent failures (which yield agents
        // running without any AutoContext) are diagnosable from the
        // benchmark stderr without re-running with verbose tracing.
        const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
        console.error(`[BenchmarkAnalystAgent] AutoContext build failed (dataset=${ctx.datasetKey}, slot=${ctx.catalogKey ?? 'default'}): ${msg}`);
        this.autoContextBlock = undefined;
      }
      // Record into the process-wide registry so the benchmark runner
      // can surface the block per-row in its JSONL output (renders in
      // the benchmark viewer). Keyed by (datasetKey, slot).
      if (this.autoContextBlock) {
        recordRecentAutoContext(ctx.datasetKey, ctx.catalogKey ?? 'default', this.autoContextBlock);
      }
    }
    return super.run();
  }

  protected getSystemPrompt(): string {
    const ToolCls = this.constructor as typeof BenchmarkAnalystAgent;
    const toolNames = ToolCls.tools.map((t) => `\`${t.name}\``).join(', ');
    const visibleConnections = publicConnectionMetadata(this.context.connections);
    const dialects = extractDialects(this.context.connections ?? []);
    const dialectHints = renderDialectHints(dialects);

    return `You are ${ToolCls.schema.name}, an expert data analyst agent. Your task is to analyze the questions, and give very specific answers.
You have access to the following tools: ${toolNames}.

Connections available to you:
${JSON.stringify(visibleConnections)}

${dialectHints}

## Analysis guidelines:
  - Carefully consider the question and the data connections you have access to. Be concise, specific and accurate in responses.
  - An <AutoContext> block precedes your question. It already contains the discovered schema, per-table notes, sample rows, verified cross-table joins, and a few demonstration queries. Read it first — only call SearchDBSchema when you need details AutoContext didn't surface (e.g. indexes or a column the filter step elided).
  - Plan before executing: decompose the question into the facts it needs, then write the fewest queries that produce them. Strongly prefer one set-based query (GROUP BY / JOIN / aggregate) over the whole population to many per-entity queries — if you are running one query per row or id, stop and rewrite it as a single set query.
  - Execute queries with the ExecuteQuery tool. For each connection, see its "dialect" field above and the per-dialect notes below for syntax + cross-DB chaining details. Fix any syntax errors and try again until you get a valid response.

  ### FuzzyMatch — lexical matching with semantic fallback
  - FuzzyMatch matches a known term against stored values (typo/casing/spacing correction). It is NOT a search tool — it requires you to already know approximately what the value looks like.
  - Use BEFORE writing WHERE filters on text/categorical columns. Never assume the user's wording matches the data exactly.
  - Use 1-3 short, specific keywords — NOT full phrases (e.g. "green energy" not "green energy production in northern regions").
  - Prioritize similarity matches (typo correction) over substring matches (containment).
  - **Semantic expansion** is enabled by default: when no lexical matches are found, FuzzyMatch automatically finds semantically similar terms in the column and retries. Pay close attention to these expanded results — they reveal the data's actual vocabulary, which may differ significantly from the user's wording.
  - **Some matches (including semantic expansions)?** Question your recall. FuzzyMatch on a text column finds the *easy* hits. To find entities you missed:
    1. Examine the found matches' other columns (descriptions, metadata) to learn the domain vocabulary.
    2. Use that vocabulary to search other columns, or use ExploreDataset to semantically classify the full column.
    Example: searching "solar" in a "name" column finds "SolarMax", "SunPower Solar". But "GreenWatt Inc" is also a solar company — discoverable only by examining its "description" ("photovoltaic panels", "renewable energy"). A name-only search misses it.

  ## ExploreDataset — semantic reasoning over data
  - Use when you need an LLM to reason over data: entity resolution, deduplication, clustering, pattern detection, or semantic classification that SQL/FuzzyMatch cannot express.
  - Use when filtering on a SEMANTIC concept (e.g. "funny team names", "eco-friendly options") and the column is free-text — FuzzyMatch/LIKE are lexical and will miss synonyms. Cast a wide net (broad OR query or pull all rows if small), then use ExploreDataset with a precise classification prompt.
  - For ranking questions: query the ranking metric first (e.g. top 100 by revenue), then use $label.column_name to pull metadata for just those IDs. Always ORDER BY the relevant metric. Write a precise prompt stating the exact output format.
  - If data is in the same DB, prefer CTE/subqueries in a single query instead of $ referencing.

  ## Search Tool Selection — TL;DR
  | Need | Tool |
  |---|---|
  | Explore tables, columns, types | SearchDBSchema |
  | Known term, possibly stored differently (typos, casing, spacing) | FuzzyMatch |
  | Semantic concept in free-text (e.g. "eco-friendly", "funny names") | ExploreDataset |
  | Found some hits but unsure if complete | FuzzyMatch → examine results → ExploreDataset |
  | Entity resolution, dedup, clustering | ExploreDataset |

## Response Format [EXTREMELY IMPORTANT]:
- This is only applicable to the final answer you give at the end of your analysis, not to any intermediate reasoning or tool calls.
- Only the first 30 words of your final response will be evaluated by an eval function, so make sure to put the most important information at the beginning that directly and fully answers the question. Lead with the answer, then explain (text, tables, etc.) if necessary.
- If any specific names, terms are asked, use *exact* and *full* names; DO NOT get lazy and use abbreviations or short forms. The eval function does exact string match mostly.
- Format:
    TL;DR: <direct answer in **caveman style** — bare entities and numbers, no filler words>
    Analysis: <a concise analysis at the top presenting all important info first, followed by reasoning of how you arrived at the answer.>
Example:
Q: What is the total revenue for product X?
TL;DR: Product X $123,456.
Analysis: <table of monthly breakdown>...

## Data Documentation:
${this.context.contextDocs ?? 'No documentation available.'}

${this.autoContextBlock ? `## Auto-discovered context (computed from the actual data — joins, per-column notes, sample rows, example queries):\n${this.autoContextBlock}` : ''}
`;
  }
}
