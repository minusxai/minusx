/**
 * AutoContext — the AutoContextAgent + its `SubmitSchemaInfo` finisher tool.
 *
 * Phase 2 of the AutoContext pipeline (see `auto-context.ts` for the
 * overview): a lighter-model agent reads the rendered catalog (produced by
 * `catalog-render.ts`), explores it via `ExecuteQuery`, and submits its
 * structured annotations exactly once via `SubmitSchemaInfo`. The raw
 * payload is parsed + verified downstream in `generation.ts`.
 */
import 'server-only';

import { Type } from 'typebox';
import type { Static, TSchema } from 'typebox';
import type { Tool } from '@/orchestrator/llm';
import {
  MXAgent,
  MXTool,
  type ToolResponse,
} from '@/orchestrator/types';
import { ChainedExecuteQuery } from '../../db-tools';
import type { BenchmarkAnalystContext } from '../../types';
import { publicConnectionMetadata } from '../../types';
import { getLighterModel } from '../data-tool-base';

// ─── SubmitSchemaInfo tool ───────────────────────────────────────────────────

/** Short alphanumeric ID matching `^[gstc][0-9]+$`. */
const ID_PATTERN = '^[gstc][0-9]+$';

const AnnotationSchema = Type.Object({
  id: Type.String({
    pattern: ID_PATTERN,
    description: 'ID of an element (table or column) from the input catalog.',
  }),
  description: Type.Optional(
    Type.String({
      description:
        'Short note — ONLY for unstructured text, JSON blobs, encoded enums, or surprising formats. Include a verbatim example value when describing a format. Skip if name + type + stats already make the element self-evident.',
    }),
  ),
  join: Type.Optional(
    Type.Object({
      to: Type.String({
        pattern: ID_PATTERN,
        description: 'ID of the column this one joins to.',
      }),
    }),
  ),
});

const SubmitSchemaInfoParams = Type.Object({
  annotations: Type.Array(AnnotationSchema, {
    description: 'One entry per element you have something useful to say about. Skip self-evident ones.',
  }),
});

/** Parsed annotation as it arrives from the agent. */
export type Annotation = Static<typeof AnnotationSchema>;

/** Validated structured output from the agent. */
export interface AutoContextPayload {
  annotations: Annotation[];
}

interface SubmitSchemaInfoDetails extends Record<string, unknown> {
  type: 'auto_context';
  payload: AutoContextPayload;
}

const SUBMIT_SCHEMA_INFO_DESCRIPTION = `Submit your annotations for the catalog. Call this exactly once at the end of your turn, with the structured list of:
- Descriptions for elements (tables / columns) whose meaning isn't obvious from name + type + stats. Focus on unstructured text columns, JSON blobs, encoded enums, prefix-laden IDs, and any format with delimiters or quirks. Include a verbatim example value from the data when describing a format.
- Joins between columns you verified via ExecuteQuery probes (COUNT(*) returned ≥ 1 row).

Use the IDs from the catalog input. Do NOT include entries for elements that need no commentary — fewer, higher-signal annotations are better than verbose boilerplate.`;

/** Finisher tool the agent calls exactly once with its structured payload. */
export class SubmitSchemaInfo extends MXTool<
  typeof SubmitSchemaInfoParams,
  BenchmarkAnalystContext,
  SubmitSchemaInfoDetails
> {
  static readonly schema: Tool<typeof SubmitSchemaInfoParams> = {
    name: 'SubmitSchemaInfo',
    description: SUBMIT_SCHEMA_INFO_DESCRIPTION,
    parameters: SubmitSchemaInfoParams,
  };

  async run(): Promise<ToolResponse<SubmitSchemaInfoDetails>> {
    const payload = this.parameters as AutoContextPayload;
    const annCount = payload.annotations.length;
    const joinCount = payload.annotations.filter((a) => a.join).length;
    const descCount = payload.annotations.filter((a) => a.description).length;
    return {
      content: [
        {
          type: 'text',
          text: `AutoContext submitted: ${annCount} annotation(s) — ${descCount} description(s), ${joinCount} join(s).`,
        },
      ],
      details: { type: 'auto_context', payload },
      isError: false,
    };
  }
}

// ─── AutoContextAgent ────────────────────────────────────────────────────────

const AutoContextAgentParams = Type.Object({
  userMessage: Type.String({
    description:
      "Catalog hierarchy with short IDs at every level. The agent reads this as orientation input and emits annotations via SubmitSchemaInfo.",
  }),
});

const SYSTEM_PROMPT_TEMPLATE = (
  connectionsJson: string,
  contextDocs: string | undefined,
) => `You are AutoContextAgent. Your job: produce orientation notes for a downstream analyst that will answer questions against the database connections shown below.

The analyst already knows: connection names, schemas, table names, column names, column types, and per-column statistics (nDistinct, nullCount, topValues, min/max). Don't restate any of that. Your only job is to add two things the analyst can't infer from name + type + stats alone:

  1. **Descriptions** for elements (columns or tables) where the meaning, encoding, or format isn't obvious.
  2. **Joins** — column-to-column foreign key relationships you verified.

## Input

Your \`userMessage\` is the catalog hierarchy with short IDs at every level:

  [g0] users_db
    [s0] main
      [t0] users (12,345 rows)
        [c0]  id        INTEGER  nDistinct=12345
        [c1]  email     VARCHAR  nDistinct=12340
        [c2]  locations VARCHAR  nDistinct=820  top=["palo alto, san mateo", ...]
  [g1] catalog_db
    ...

Use these IDs in your output. Don't invent IDs.

The data documentation below the connection list (## Data documentation) may describe domain conventions, encodings, or join semantics. **Read it first and let it guide your exploration** — descriptions and join candidates often become obvious from the docs.

## Tools

**ExecuteQuery** — run read-only SQL or Mongo queries against any listed connection. Use it freely.

  **Sequential-only contract — read carefully.** A single ExecuteQuery call runs its \`queries\` array **sequentially**; query #2+ must reference an earlier query's labeled result via \`$<label>.<column>\`. **Independent probes (e.g. sampling two different tables that don't depend on each other) MUST go in separate ExecuteQuery tool calls** — putting them in one call's \`queries\` array will fail with "does not reference an earlier label". To parallelize, emit multiple ExecuteQuery tool calls in the same turn; the runtime executes them concurrently.

  Quick rule:
   - One probe → one query → one ExecuteQuery call.
   - Two related probes where #2 needs values from #1 → both in the same ExecuteQuery call, with \`$label.column\` chaining.
   - Two independent probes (no data dependency) → two separate ExecuteQuery tool calls in the same turn.

  - **Sample inspection.** Before describing a column's format or probing a join, fetch a few rows to see actual values (one query per ExecuteQuery call):
        SELECT col FROM t WHERE col IS NOT NULL LIMIT 5

  - **Same-connection join probe.** One query:
        SELECT COUNT(*) FROM <fromTable> a JOIN <toTable> b
        ON a.<fromCol> = b.<toCol> LIMIT 1
    List the join only if the probe returned ≥ 1 row.

  - **Cross-connection join probe.** Use sequential-mode chaining — the second query references the first via \`$label.column\`, which expands to a literal list. Works across any pair of connections:
        queries: [
          { connection: "<src_conn>",
            query: "SELECT DISTINCT <fromCol> FROM <fromTable> LIMIT 200",
            label: "src" },
          { connection: "<dst_conn>",
            query: "SELECT COUNT(*) FROM <dst_table> WHERE <toCol> IN ($src.<fromCol>)" }
        ],
        sequential: true
    List the join only if the count > 0.

  - **Drop a join** if the probe returns 0 rows or errors. The downstream analyst trusts everything you list — phantom joins poison its queries.

Soft probe budget: ~15 ExecuteQuery calls total. Spend them where they change your output.

**SubmitSchemaInfo** — submit your final structured annotations. You're done once this tool call returns successfully. Thinking and prose are fine in between — the agent run continues until SubmitSchemaInfo is invoked.

## How to work

1. Read the catalog and the data documentation.

2. For each table, decide what (if anything) is non-obvious. Fetch a few rows if you want to confirm a hunch about format or encoding.

3. Identify candidate joins. Heuristics:
   - Columns whose name matches another table's column (within the same connection or across connections).
   - \`<entity>_id\` ↔ \`<entity>.id\` patterns.
   - Columns whose top values look like identifiers from another table.
   - Hints in the data documentation.

4. Probe every join you intend to list. Same-connection or cross-connection. Drop joins whose probe doesn't return data.

5. Write descriptions only for elements that need them:
   - **Describe** columns with unstructured text, JSON blobs, encoded enums, prefix-laden IDs, delimited lists, non-ISO date strings, or any format whose structure isn't visible from type + stats.
   - **Describe** a table only when there's something to say beyond its column list — e.g. "one row per trading day", "denormalized join of X and Y for reporting".
   - **Don't describe** elements that are self-evident from name + type + stats. Boilerplate hurts.

6. Every format description must include a verbatim example value, quoted:
   - Good: \`Comma-separated city list, e.g. "palo alto, san mateo"\`
   - Bad:  \`Contains a list of cities\`

7. Self-check before calling SubmitSchemaInfo: drop any join whose probe didn't actually return data; drop any description that just restates name + type. Submit what's genuinely useful.

## Output format

Call SubmitSchemaInfo exactly once with annotations:

  {
    "annotations": [
      { "id": "c2", "description": "Comma-separated city list, e.g. \\"palo alto, san mateo\\"" },
      { "id": "c14", "join": { "to": "c2" } },
      { "id": "t08", "description": "Daily OHLCV bars; one row per trading day, ISO date strings" }
    ]
  }

Rules:
- Every \`id\` and \`join.to\` must be a short alphanumeric ID (^[gstc][0-9]+$) from the catalog input. The tool will reject other shapes.
- An annotation may have \`description\`, \`join\`, both, or neither. Entries with neither are silently dropped.
- Do not get carried away with tons of ExecuteQuery probes and annotations. Focus on the few that appear most interesting or non-obvious.

## Connections available
${connectionsJson}

${contextDocs ? `## Data documentation\n${contextDocs}` : ''}
`;

/**
 * Lighter-model agent that produces structured AutoContext annotations.
 * Dispatched by `BenchmarkAnalystAgent` via `orchestrator.dispatch()`; result
 * cached at the parent layer and reused across rows of the same dataset/slot.
 */
export class AutoContextAgent extends MXAgent<
  typeof AutoContextAgentParams,
  BenchmarkAnalystContext
> {
  static readonly schema: Tool<typeof AutoContextAgentParams> = {
    name: 'AutoContextAgent',
    description:
      'Orientation agent: explores the catalog, verifies joins via ExecuteQuery probes, and submits annotations via SubmitSchemaInfo.',
    parameters: AutoContextAgentParams,
  };
  static readonly tools: Tool<TSchema>[] = [
    ChainedExecuteQuery.schema,
    SubmitSchemaInfo.schema,
  ];
  // Re-read on every access so tests / startup hooks that swap the lighter
  // model via `setLighterModel` take effect without re-importing the class.
  static get model() { return getLighterModel(); }
  // Bigger output cap — the structured `SubmitSchemaInfo` call can run >4K
  // tokens for wide-schema datasets where many columns have annotations.
  static readonly callOptions = { maxTokens: 16384 };

  protected override getSystemPrompt(): string {
    const visibleConnections = publicConnectionMetadata(this.context.connections);
    return SYSTEM_PROMPT_TEMPLATE(
      JSON.stringify(visibleConnections),
      this.context.contextDocs,
    );
  }
}
