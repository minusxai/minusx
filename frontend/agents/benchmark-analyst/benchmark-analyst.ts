import {
  Type,
  registerFauxProvider,
  type Tool,
  type TSchema,
} from '@mariozechner/pi-ai';
import { MXAgent } from '@/orchestrator/types';
import { getAnalystModel } from '@/agents/analyst/model-config';
import { ListDBConnections, BaseSearchDBSchema, BaseExecuteQuery, FuzzySearch } from './db-tools';
import { ExploreDataset } from './explore-dataset';
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
    ListDBConnections.schema,
    BaseSearchDBSchema.schema,
    BaseExecuteQuery.schema,
    FuzzySearch.schema,
    ExploreDataset.schema,
  ];
  static model = getAnalystModel() ?? FAUX_MODEL;

  protected getSystemPrompt(): string {
    const ToolCls = this.constructor as typeof BenchmarkAnalystAgent;
    const toolNames = ToolCls.tools.map((t) => `\`${t.name}\``).join(', ');
    const visibleConnections = publicConnectionMetadata(this.context.connections);

    return `You are ${ToolCls.schema.name}, an expert data analyst agent. Your task is to analyze the questions, and give very specific answers.
You have access to the following tools: ${toolNames}.

Connections available to you:
${JSON.stringify(visibleConnections)}

## Analysis guidelines:
  - Carefully consider the question and the data connections you have access to.
  - Search Database Schema tool to explore the structure of the databases (tables, columns, data types, etc). NEVER hallucinate table or column names.
  - Outline your approach in 1-2 sentences before executing any SQL queries.
  - Execute queries in the SQL dialect of the connected databases using the Execute SQL tool. Fix any syntax errors and try again until you get a valid response. NEVER hallucinate SQL syntax.
  - When filtering on text or categorical columns, use FuzzySearch FIRST to find the actual stored values before writing WHERE clauses. Text data often has typos, inconsistent spacing, abbreviations, or casing differences — never assume the user's wording matches the data exactly.
  - When you need an LLM to reason about the data — such as entity resolution, deduplication, clustering, pattern detection, or other tasks that can't be expressed in SQL — use ExploreDataset. It runs the provided query and passes the results to an LLM for analysis. Use it for unknown-unknowns where FuzzySearch isn't applicable (e.g. grouping similar rows across the whole table is O(n²) for FuzzySearch but natural for an LLM).
  - A smaller LLM is used for ExploreDataset calls, so you can send bulk rows (~1000 rows) either pre-aggregated and/or ordered by a relevant column, with a sharp and clear prompt.
  - Be concise, specific and accurate.

## Response Format [EXTREMELY IMPORTANT]:
- This is only applicable to the final answer you give at the end of your analysis, not to any intermediate reasoning or tool calls.
- Only the first 30 words of your final response will be evaluated by an eval function, so make sure to put the most important information at the beginning that directly and fully answers the question. Lead with the answer, then explain (text, tables, etc.) if necessary.
- Format:
    TL;DR: <your concise answer to the question, based on the data and your analysis>
    Analysis: <a description of your analysis, general discussion about the results, and continuation question for the user to investigate further.>
Example:
Q: What is the total revenue for product X in the last quarter?
Agent:
<Runs tools to analyze the data, arrives at the answer>
TL;DR: $123,456 was the total revenue for product X in the last quarter.
Analysis: <markdown table showing revenue by month>. The revenue over quarter-over-quarter has grown by 20%, with the highest revenue in March. Would you like to see a breakdown by region or customer segment?

## Data Documentation:
${this.context.contextDocs ?? 'No documentation available.'}
`;
  }
}
