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
import {
  ensureAutoContext,
  renderGeneratedContextFromToolThread,
} from './v2/auto-context/auto-context';

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
 * AutoContext orchestration lives in `v2/auto-context/auto-context.ts` —
 * this class is the thin integration point that calls `ensureAutoContext`
 * before the analyst's first LLM turn and `renderGeneratedContextFromToolThread`
 * when building the system prompt.
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

  async run(): Promise<AssistantMessage> {
    const ctx = this.context;
    // AutoContext is benchmark-only: production paths (RemoteAnalystAgent
    // and friends) extend this class without a `datasetKey`, so they
    // bypass the upfront orientation pass entirely. `ensureAutoContext`
    // returns immediately when `ctx.datasetKey` is unset.
    if (!ctx.autoContextAttempts) ctx.autoContextAttempts = [];
    if (ctx.datasetKey) {
      const t0 = Date.now();
      try {
        await ensureAutoContext(this as unknown as MXAgent);
        ctx.autoContextAttempts.push({ status: 'ok', durationMs: Date.now() - t0 });
      } catch (e) {
        // Best-effort orientation. Failures (DB blip, LLM error, agent
        // produced no SubmitSchemaInfo result) must not abort the run —
        // the analyst proceeds with no `<GeneratedContext>` block. We
        // record the outcome on `ctx.autoContextAttempts` so the runner
        // can write it into the persisted row, AND log to stderr.
        const msg = e instanceof Error ? e.message : String(e);
        ctx.autoContextAttempts.push({ status: 'failed', reason: msg, durationMs: Date.now() - t0 });
        const detail = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
        console.error(`[BenchmarkAnalystAgent] AutoContext failed (dataset=${ctx.datasetKey}, slot=${ctx.catalogKey ?? 'default'}): ${detail}`);
      }
    } else {
      // Production / unset-datasetKey path — `ensureAutoContext` would
      // return early. Record as skipped so the eval output is uniform.
      ctx.autoContextAttempts.push({ status: 'skipped' });
    }
    return super.run();
  }

  protected getSystemPrompt(): string {
    const ToolCls = this.constructor as typeof BenchmarkAnalystAgent;
    const toolNames = ToolCls.tools.map((t) => `\`${t.name}\``).join(', ');
    const visibleConnections = publicConnectionMetadata(this.context.connections);
    const dialects = extractDialects(this.context.connections ?? []);
    const dialectHints = renderDialectHints(dialects);
    const generatedContext = renderGeneratedContextFromToolThread(this as unknown as MXAgent);

    return `You are ${ToolCls.schema.name}, an expert data analyst agent. Your task is to analyze the questions, and give very specific answers.
You have access to the following tools: ${toolNames}.

Connections available to you:
${JSON.stringify(visibleConnections)}

${dialectHints}

## Analysis guidelines:
  - Carefully consider the question and the data connections you have access to. Be concise, specific and accurate in responses.
  - Two context sections appear below: \`UserContext\` (authoritative human-written dataset documentation) and \`GeneratedContext\` (schema layout, descriptions for non-self-evident columns, and verified joins computed from the actual data). \`UserContext\` is authoritative for column meanings, business rules, and how to interpret the question. \`GeneratedContext\` is authoritative for what the data actually looks like (joins, encodings, format quirks). When they disagree on intent, prefer \`UserContext\`; when \`GeneratedContext\` reveals a quirk not mentioned in \`UserContext\`, use it. SearchDBSchema is only for details neither section surfaces.
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

<UserContext>
${this.context.contextDocs ?? 'No documentation available.'}
</UserContext>
${generatedContext ? `
<GeneratedContext>
${generatedContext}
</GeneratedContext>` : ''}
`;
  }
}
