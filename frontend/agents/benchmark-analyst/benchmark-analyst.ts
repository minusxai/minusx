import {
  Type,
  registerFauxProvider,
  type Tool,
  type TSchema,
} from '@mariozechner/pi-ai';
import { MXAgent } from '@/orchestrator/types';
import { getAnalystModel } from '@/agents/analyst/model-config';
import { CatalogSearchDBSchema, ChainedExecuteQuery, FuzzyMatch } from './db-tools';
import { SubmitAnswer } from './submit-answer';
import { ExploreDataset } from './explore-dataset';
import { FetchHandleV2 } from './v2/fetch-handle';
import { renderDialectHints, extractDialects } from './v2/dialect-hints';
import { type BenchmarkAnalystContext, publicConnectionMetadata } from './types';

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
 * AutoContext orchestration lives in `v2/auto-context/auto-context.ts`.
 * The benchmark runner runs it as a pre-step via `runAutoContextForSlot`
 * and passes the rendered markdown via `ctx.autoContextRendered` or
 * `ctx.autoContextBySlot`. This class reads it in `getSystemPrompt()`.
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
    SubmitAnswer.schema,
  ];
  static model = getAnalystModel() ?? FAUX_MODEL;

  protected getSystemPrompt(): string {
    const ToolCls = this.constructor as typeof BenchmarkAnalystAgent;
    const toolNames = ToolCls.tools.map((t) => `\`${t.name}\``).join(', ');
    const visibleConnections = publicConnectionMetadata(this.context.connections);
    const dialects = extractDialects(this.context.connections ?? []);
    const dialectHints = renderDialectHints(dialects);
    const MAX_AUTOCTX_CHARS = 30_000;
    const rawGeneratedContext = this.context.autoContextRendered
      ?? this.context.autoContextBySlot?.[this.context.catalogKey ?? 'default'];
    const generatedContext = rawGeneratedContext && rawGeneratedContext.length > MAX_AUTOCTX_CHARS
      ? rawGeneratedContext.slice(0, MAX_AUTOCTX_CHARS) + '\n\n... (truncated)'
      : rawGeneratedContext;

    return `You are ${ToolCls.schema.name}, an expert data analyst agent. Your task is to analyze the questions, and give very specific answers.
You have access to the following tools: ${toolNames}.

Connections available to you:
${JSON.stringify(visibleConnections)}

${dialectHints}

## Analysis guidelines:
  - Carefully consider the question and the data connections you have access to. Be concise, specific and accurate in responses.
  - Two context sections appear below: \`UserContext\` (authoritative human-written dataset documentation) and \`GeneratedContext\` (schema layout, descriptions for non-self-evident columns, and verified joins computed from the actual data). \`UserContext\` is authoritative for column meanings, business rules, and how to interpret the question. \`GeneratedContext\` is authoritative for what the data actually looks like (joins, encodings, format quirks). When they disagree on intent, prefer \`UserContext\`; when \`GeneratedContext\` reveals a quirk not mentioned in \`UserContext\`, use it. SearchDBSchema is only for details neither section surfaces.
  - DO NOT use world-knowledge or assumptions about the data. Rely ENTIRELY on the provided data.
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
- Before ending, you MUST call \`SubmitAnswer\` with a compact answer string formatted for the eval validator.
- The eval function receives the \`SubmitAnswer\` string verbatim and scans it for specific names, numbers, and their proximity. Format rules:
  - Put names/entities IMMEDIATELY adjacent to their values (no filler words between). Example: \`Product X $123,456\` not \`Product X has a revenue of $123,456\`.
  - For lists of items, put each on its own line (like a markdown table).
  - Use *exact* and *full* names from the data; DO NOT get lazy and abbreviate anything (names, days of week, months, etc.). The eval does exact/fuzzy string matching.
  - Include all requested data points — the validator checks each one - every questionPart needs to be answered.
Example:
Q: What is the total revenue for product X?
<Tools calls, reasoning, and analysis>
SubmitAnswer: "Product X | $123,456"

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
