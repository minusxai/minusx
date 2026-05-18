import 'server-only';

import { Type, type Tool, type TSchema } from '@mariozechner/pi-ai';
import { MXAgent } from '@/orchestrator/types';
import { ChainedExecuteQuery } from '../../db-tools';
import type { BenchmarkAnalystContext } from '../../types';
import { publicConnectionMetadata } from '../../types';
import { getLighterModel } from '../data-tool-base';
import { FinishAutoContext } from './finish-tool';

const AutoContextAgentParams = Type.Object({
  /** Catalog summary built by the parent (schema + stats + sample rows per
   *  table). The agent reads this as its only input and uses ExecuteQuery
   *  to probe joins / validate examples. Question-agnostic so the per-
   *  `(datasetKey, slot)` cache is safe to share across rows.
   *
   *  Named `userMessage` so it slots into `MXAgent.buildUserContent`'s
   *  default behaviour (wraps as a single user-message text block). */
  userMessage: Type.String(),
});

const AUTO_CONTEXT_SYSTEM_PROMPT_TEMPLATE = (
  connectionsJson: string,
  contextDocs: string | undefined,
) => `You are AutoContextAgent. Your job is to produce an orientation block that downstream analysts will use to answer questions against the connections below — verified joins, per-column notes grounded in the actual data, and a few execution-validated example queries.

You receive the catalog summary as your user message: per-table column types, per-column stats (\`nDistinct\`, \`nullCount\`, \`top values\`, \`min/max\`), and a small sample of rows.

You have two tools:
1. **ExecuteQuery** — run read-only SQL or Mongo queries against any listed connection. Use it to confirm joins (e.g. \`SELECT COUNT(*) FROM a JOIN b ON a.x = b.y\`, \`SELECT COUNT(DISTINCT col) FROM t WHERE col IN (...)\`) and to validate the result rows of any example query you plan to surface.
2. **FinishAutoContext** — call exactly once at the end with your structured output.

## How to work
- Read the catalog summary. Identify candidate joins from column names + stats: \`<table>_id\` ↔ \`<table>.id\`, shared identifier columns, sparse-subset inclusion (small dedup'd table inside a larger one). Skip obvious dead ends: low-uniqueness categorical columns, narrative text fields, status enums.
- For each plausible join, run one ExecuteQuery probe to confirm or reject it. A simple \`SELECT COUNT(*) FROM a JOIN b ON a.x = b.y LIMIT 1\` (or \`SELECT COUNT(DISTINCT a.x) FROM a WHERE a.x IN (SELECT b.y FROM b LIMIT N)\` for sparse cases) is enough. Don't fabricate joins you didn't verify.
- For each table, write one short tableNote describing what it represents + any data-shape quirks visible from samples (nested fields, encoded enums, format variants). For each column with a non-obvious shape (encoded JSON, comma-separated lists, prefixed IDs, units, NULL meaning), write a short note. Skip columns that need no commentary.
- Propose up to 5 example queries that demonstrate the most useful joins or shapes. Run each via ExecuteQuery; include only those that succeed with at least one row. Trim large rows.
- Budget: aim for **at most ~15 ExecuteQuery probes total** across the whole run. Stop probing once you have enough evidence.
- When done, call **FinishAutoContext** exactly once with the structured payload. Do not write any prose response — your only output is that single tool call.

## Connections available
${connectionsJson}

${contextDocs ? `## Data documentation\n${contextDocs}` : ''}
`;

/**
 * Lighter-model agent that produces a structured AutoContext payload.
 * Spawned by `BenchmarkAnalystAgent` via `orchestrator.dispatch()` once per
 * `(datasetKey, slot)`; result is cached at the parent layer and reused
 * across rows of the same dataset.
 */
export class AutoContextAgent extends MXAgent<
  typeof AutoContextAgentParams,
  BenchmarkAnalystContext
> {
  static readonly schema: Tool<typeof AutoContextAgentParams> = {
    name: 'AutoContextAgent',
    description: 'Orientation agent: validates joins, writes per-column notes, and proposes example queries. Returns a structured AutoContext payload via FinishAutoContext.',
    parameters: AutoContextAgentParams,
  };
  static readonly tools: Tool<TSchema>[] = [
    ChainedExecuteQuery.schema,
    FinishAutoContext.schema,
  ];
  // Re-read on every access so tests that swap the lighter model via
  // `setLighterModel` (and benchmark startup flips between provider stubs
  // and real providers) take effect without re-importing the class.
  static get model() { return getLighterModel(); }

  protected override getSystemPrompt(): string {
    const visibleConnections = publicConnectionMetadata(this.context.connections);
    return AUTO_CONTEXT_SYSTEM_PROMPT_TEMPLATE(
      JSON.stringify(visibleConnections),
      this.context.contextDocs,
    );
  }
}
