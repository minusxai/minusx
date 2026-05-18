import 'server-only';

import { Type, type Tool, type TSchema } from '@mariozechner/pi-ai';
import { MXAgent } from '@/orchestrator/types';
import { ChainedExecuteQuery } from '../../db-tools';
import type { BenchmarkAnalystContext } from '../../types';
import { publicConnectionMetadata } from '../../types';
import { getLighterModel } from '../data-tool-base';

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
) => `You are AutoContextAgent. Your job: produce an orientation block that downstream analysts will use to answer questions against the connections below — verified joins, per-column notes grounded in actual data, and a few execution-validated example queries.

Your user message is the catalog summary: per-table column types, per-column stats (\`nDistinct\`, \`nullCount\`, \`top values\`, \`min/max\`), and a small sample of rows.

You have one tool:
- **ExecuteQuery** — run read-only SQL or Mongo queries against any listed connection. Use it to confirm joins (\`SELECT COUNT(*) FROM a JOIN b ON a.x = b.y LIMIT 1\`, \`SELECT COUNT(DISTINCT a.x) FROM a WHERE a.x IN (SELECT b.y FROM b LIMIT N)\`) and to validate result rows of example queries.

## How to work
1. Read the catalog summary. Identify candidate joins from column names + stats: \`<table>_id\` ↔ \`<table>.id\`, shared identifier columns, sparse-subset inclusion. Skip obvious dead ends: low-uniqueness categorical columns, narrative text, status enums.
2. For each plausible join, run ONE ExecuteQuery probe to confirm. Don't list joins you didn't verify.
3. For each table, write one short tableNote describing what it represents + data-shape quirks visible from samples (nested fields, encoded enums, format variants). Per-column notes: only where there's a non-obvious shape (encoded JSON, comma-separated lists, prefixed IDs, units, NULL meaning). Skip columns that need no commentary.
4. Propose up to 5 example queries; run each via ExecuteQuery; include only those that succeed with at least one row.
5. Budget: at most ~15 ExecuteQuery probes total. Stop probing once you have enough evidence.

## Final response format — IMPORTANT
When you're done probing, emit a SINGLE final response containing **only** this tag, with valid JSON inside. No prose before or after. No markdown code fences. No explanation.

<AutoContext>
{
  "tables": [
    {
      "connection": "<conn-name>",
      "schema": "<schema-name>",
      "table": "<table-name>",
      "tableNote": "one paragraph describing the table + quirks",
      "columns": [
        { "name": "<col>", "note": "short note on shape/format/units; empty string if no commentary" }
      ],
      "joins": [
        { "fromColumn": "<col>", "toTable": "<table or conn.schema.table>", "toColumn": "<col>", "evidence": "COUNT(*) JOIN returned N rows" }
      ]
    }
  ],
  "examples": [
    {
      "description": "one-line description",
      "connection": "<conn-name>",
      "query": "SELECT ...",
      "rows": [ { "<col>": <value>, ... } ]
    }
  ]
}
</AutoContext>

Strict rules:
- The response MUST contain exactly one \`<AutoContext>...</AutoContext>\` block and nothing else.
- The JSON MUST parse. Use valid JSON (double-quoted keys, no trailing commas, no comments).
- Only include \`joins\` you validated via ExecuteQuery. Only include \`examples\` whose rows you actually observed via ExecuteQuery.
- Cap each example's \`rows\` array at 5 entries.

## Connections available
${connectionsJson}

${contextDocs ? `## Data documentation\n${contextDocs}` : ''}
`;

/**
 * Lighter-model agent that produces a structured AutoContext payload.
 * Spawned by `BenchmarkAnalystAgent` via `orchestrator.dispatch()` once per
 * `(datasetKey, slot)`; result is cached at the parent layer and reused
 * across rows of the same dataset.
 *
 * The agent emits its structured output as plain text wrapped in
 * `<AutoContext>{...json...}</AutoContext>` (not a finisher tool call) —
 * lighter models are more reliable at producing tagged JSON than at
 * triggering a designated tool. The parent parses the tag in
 * `runAutoContextAgent`.
 */
export class AutoContextAgent extends MXAgent<
  typeof AutoContextAgentParams,
  BenchmarkAnalystContext
> {
  static readonly schema: Tool<typeof AutoContextAgentParams> = {
    name: 'AutoContextAgent',
    description: 'Orientation agent: validates joins, writes per-column notes, and proposes example queries. Returns a structured AutoContext payload as tagged JSON in its final response.',
    parameters: AutoContextAgentParams,
  };
  static readonly tools: Tool<TSchema>[] = [
    ChainedExecuteQuery.schema,
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
