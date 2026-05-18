import {
  Type,
  registerFauxProvider,
  type AssistantMessage,
  type Tool,
  type ToolResultMessage,
  type TSchema,
} from '@mariozechner/pi-ai';
import { MXAgent } from '@/orchestrator/types';
import type { NodeConnector } from '@/lib/connections/base';
import { gen_id } from '@/orchestrator/utils';
import { getAnalystModel } from '@/agents/analyst/model-config';
import { CatalogSearchDBSchema, ChainedExecuteQuery, FuzzyMatch } from './db-tools';
import { ExploreDataset } from './explore-dataset';
import { FetchHandleV2 } from './v2/fetch-handle';
import { renderDialectHints, extractDialects } from './v2/dialect-hints';
import { type BenchmarkAnalystContext, publicConnectionMetadata } from './types';
import { getOrCreateBenchmarkConnector } from './shared-duckdb';
import { getCatalogStore } from './v2/catalog';
import { getLighterModel } from './v2/data-tool-base';
import type { PromptPassCallLLM } from './v2/prompt-pass';
import {
  AUTO_CONTEXT_MAX_CHARS,
  AutoContextAgent,
  autoContextStore,
  buildAutoContextCacheHitWrapper,
  buildAutoContextSynthAssistant,
  buildCatalogSummary,
  catalogProjection,
  estimateSchemaChars,
  extractAutoContextPayload,
  filterSchemaByQuestion,
  fingerprint,
  makeFetchTableSample,
  renderAutoContextPayload,
  renderCatalogSummary,
} from './v2/auto-context';

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

  async run(): Promise<AssistantMessage> {
    const ctx = this.context;
    // AutoContext is benchmark-only: production paths (RemoteAnalystAgent
    // and friends) extend this class without a `datasetKey`, so they
    // bypass the upfront orientation pass entirely. The runner at
    // `frontend/benchmarks/runner.ts` always sets `datasetKey` on the
    // context, so benchmark rows always trigger it.
    if (ctx.datasetKey) {
      try {
        await this.ensureAutoContext();
      } catch (e) {
        // Best-effort orientation. Failures (DB blip, LLM error, agent
        // produced no valid <AutoContext> payload) must not abort the
        // run. Surface in stderr so silent failures are diagnosable.
        const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
        console.error(`[BenchmarkAnalystAgent] AutoContext failed (dataset=${ctx.datasetKey}, slot=${ctx.catalogKey ?? 'default'}): ${msg}`);
      }
    }
    return super.run();
  }

  /**
   * Make sure `this.toolThread` carries an `AutoContextAgent` wrapper that
   * `getSystemPrompt()` can read. Two paths:
   *
   * - Cache miss: builds the catalog summary, then
   *   `this.orchestrator.dispatch(synth, this)`. The orchestrator pushes
   *   the synth `assistant{toolCall}` and the wrapped `toolResult` onto
   *   `this.toolThread` automatically. We then extract the parsed payload
   *   for the cache.
   * - Cache hit: skips the dispatch. We manually push a synthetic
   *   `(assistant, toolResult)` pair onto `this.toolThread` carrying the
   *   cached payload — `getSystemPrompt()` finds it the same way as on a
   *   cache-miss row.
   *
   * Cache key: `${datasetKey}:${slot}:${suffix}` where slot is
   * `ctx.catalogKey` (DoubleCheck uses `agent-a` / `agent-b` for slot
   * isolation across the two sub-analysts) and suffix is `'full'` for
   * the small-schema path or `'f:' + fingerprint(allowedTableIds)` when
   * the per-question filter step fires.
   */
  protected async ensureAutoContext(): Promise<void> {
    const ctx = this.context;
    const userMessage = (this.parameters as { userMessage: string }).userMessage;
    const slot = ctx.catalogKey ?? 'default';

    // 1) Project the catalog. The catalog itself is cached at the catalog
    //    layer per `(datasetKey, catalogCacheKey)`; we read it cheap.
    const catalogCacheKey = `auto-${slot}`;
    const { catalog } = await getCatalogStore(ctx.connections, catalogCacheKey, undefined, ctx.datasetKey!);
    const { schema, statsByCol, rowCountByTable } = catalogProjection(catalog);
    if (schema.length === 0) return undefined;

    // 2) Filter step (per-question) when the schema exceeds budget.
    const callLLM: PromptPassCallLLM = (m, c) =>
      this.orchestrator.callLLM(m, c, this.id, { maxTokens: 4096 });
    const model = getLighterModel();

    let effectiveSchema = schema;
    let cacheSuffix: string;
    if (estimateSchemaChars(schema) > AUTO_CONTEXT_MAX_CHARS && userMessage) {
      const allowed = await filterSchemaByQuestion(schema, userMessage, ctx.contextDocs, model, callLLM);
      if (allowed.size > 0) {
        effectiveSchema = schema.filter(
          (c) => allowed.has(`${c.connection}.${c.schema}.${c.table}`),
        );
        cacheSuffix = `f:${fingerprint(allowed)}`;
      } else {
        cacheSuffix = 'full';
      }
    } else {
      cacheSuffix = 'full';
    }
    const cacheKey = `${ctx.datasetKey}:${slot}:${cacheSuffix}`;

    // 3) Cache lookup. CRITICAL: between `.get()` and `.set()` there must
    //    be NO awaits — otherwise two parallel rows for the same dataset
    //    both miss, both dispatch, and we waste an agent run. All the
    //    heavy lifting (connectors, catalog summary, dispatch) happens
    //    inside the in-flight Promise we insert into the cache before
    //    any of those awaits. Concurrent rows that hit `.get()` after
    //    the insert see the in-flight Promise and share its result.
    const dispatchId = gen_id();
    let payloadPromise = autoContextStore.get(cacheKey);
    const wasCacheMiss = !payloadPromise;
    if (wasCacheMiss) {
      payloadPromise = (async () => {
        // Build connectors + catalog summary INSIDE the Promise.
        const connectorsByName = new Map<string, NodeConnector>();
        const dialectsByName = new Map<string, string>();
        for (const entry of ctx.connections ?? []) {
          if (!entry.config) continue;
          const c = await getOrCreateBenchmarkConnector(
            entry.name, entry.dialect, entry.config, { datasetKey: ctx.datasetKey },
          );
          connectorsByName.set(entry.name, c);
          dialectsByName.set(entry.name, entry.dialect);
        }
        const fetchSample = makeFetchTableSample(effectiveSchema, statsByCol, connectorsByName, dialectsByName);
        const summary = await buildCatalogSummary(
          effectiveSchema, statsByCol, rowCountByTable, fetchSample,
        );
        const catalogSummaryText = renderCatalogSummary(summary);

        const synth = buildAutoContextSynthAssistant(dispatchId, catalogSummaryText);
        await this.orchestrator.dispatch(synth, this);
        // Wrapper is now in this.toolThread (the orchestrator pushed the
        // synth + wrapped toolResult pair onto it during dispatch).
        const wrapper = this.toolThread.find(
          (m) => 'role' in m && m.role === 'toolResult' && m.toolCallId === dispatchId,
        ) as ToolResultMessage | undefined;
        const result = extractAutoContextPayload(wrapper);
        if (!result.ok) {
          throw new Error(
            `AutoContextAgent produced no valid <AutoContext> payload (reason=${result.reason}). Final agent text:\n${result.finalText.slice(0, 1500)}`,
          );
        }
        return result.payload;
      })().catch((err) => {
        autoContextStore.delete(cacheKey);
        throw err;
      });
      // Synchronous set — race-locks against concurrent rows.
      autoContextStore.set(cacheKey, payloadPromise);
    }

    // After the miss-branch insert above (or because of an existing
    // entry), payloadPromise is guaranteed defined.
    const payload = await payloadPromise!;

    if (!wasCacheMiss) {
      // Cache hit: dispatch ran on whichever agent populated the cache
      // (a different row, possibly still in flight). This row's
      // toolThread is empty of AutoContext — synthesize the (synth,
      // wrapper) pair and push so `getSystemPrompt()` finds it the same
      // way it would on a cache-miss row.
      this.toolThread.push(
        buildAutoContextSynthAssistant(dispatchId, '<cached AutoContext>'),
        buildAutoContextCacheHitWrapper(dispatchId, payload),
      );
    }
  }

  /** Render the AutoContext block from the `AutoContextAgent` toolResult
   *  currently in `this.toolThread`, if any. `ensureAutoContext()` is
   *  responsible for making sure that wrapper is present (either via
   *  dispatch on cache miss, or by synthesizing + pushing on cache hit). */
  protected renderGeneratedContext(): string | undefined {
    const wrapper = this.toolThread.find(
      (m) =>
        'role' in m
        && m.role === 'toolResult'
        && m.toolName === AutoContextAgent.schema.name,
    ) as ToolResultMessage | undefined;
    const r = extractAutoContextPayload(wrapper);
    if (!r.ok) return undefined;
    return renderAutoContextPayload(r.payload, AUTO_CONTEXT_MAX_CHARS);
  }

  protected getSystemPrompt(): string {
    const ToolCls = this.constructor as typeof BenchmarkAnalystAgent;
    const toolNames = ToolCls.tools.map((t) => `\`${t.name}\``).join(', ');
    const visibleConnections = publicConnectionMetadata(this.context.connections);
    const dialects = extractDialects(this.context.connections ?? []);
    const dialectHints = renderDialectHints(dialects);
    const generatedContext = this.renderGeneratedContext();

    return `You are ${ToolCls.schema.name}, an expert data analyst agent. Your task is to analyze the questions, and give very specific answers.
You have access to the following tools: ${toolNames}.

Connections available to you:
${JSON.stringify(visibleConnections)}

${dialectHints}

## Analysis guidelines:
  - Carefully consider the question and the data connections you have access to. Be concise, specific and accurate in responses.
  - Two context sections appear below: \`UserContext\` (authoritative human-written dataset documentation) and \`GeneratedContext\` (schema notes, verified joins, sample rows, and example queries computed from the actual data). \`UserContext\` is authoritative for column meanings, business rules, and how to interpret the question. \`GeneratedContext\` is authoritative for what the data actually looks like (joins, encodings, format quirks). When they disagree on intent, prefer \`UserContext\`; when \`GeneratedContext\` reveals a quirk not mentioned in \`UserContext\`, use it. SearchDBSchema is only for details neither section surfaces.
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
