import 'server-only';

import { Type, type Static, type Tool } from '@mariozechner/pi-ai';
import { MXTool, type ToolResponse } from '@/orchestrator/types';
import type { BenchmarkAnalystContext } from '../../types';

/**
 * Structured output schema for `AutoContextAgent`. The agent runs a tool-use
 * loop, validates joins via `ExecuteQuery`, and calls this single finisher
 * tool with everything it learned. The tool's `run()` is a no-op echo —
 * the parent reads the structured payload off the `toolResult`'s `details`
 * field and renders it to markdown.
 */
const FinishAutoContextParams = Type.Object({
  tables: Type.Array(
    Type.Object({
      connection: Type.String(),
      schema: Type.String(),
      table: Type.String(),
      tableNote: Type.String({
        description: 'One short paragraph describing what this table represents and any data-shape quirks (nested fields, encoded enums, format variants) visible from the samples.',
      }),
      columns: Type.Array(
        Type.Object({
          name: Type.String(),
          note: Type.String({
            description: 'Per-column note grounded in the samples + stats. Note value formats, units, distributions, NULL meaning, encoded structure (JSON, comma-separated lists, prefixed IDs). Skip the column entirely if there is nothing useful to say.',
          }),
        }),
        {
          description: 'Annotated columns. Names MUST match column names in the catalog summary.',
        },
      ),
      joins: Type.Array(
        Type.Object({
          fromColumn: Type.String(),
          toTable: Type.String({
            description: 'Either `<table>` (same connection + schema) or `<connection>.<schema>.<table>` for cross-connection joins.',
          }),
          toColumn: Type.String(),
          evidence: Type.String({
            description: 'One short sentence stating how this join was confirmed (e.g. "COUNT(*) JOIN returned 4823 rows", "WHERE IN probe found 87/100 values"). Do not fabricate — only list joins you actually validated via ExecuteQuery.',
          }),
        }),
        {
          description: 'Verified foreign-key / reference relationships touching this table.',
        },
      ),
    }),
  ),
  examples: Type.Array(
    Type.Object({
      description: Type.String({ description: 'One-line description of what this query demonstrates.' }),
      connection: Type.String(),
      query: Type.String(),
      rows: Type.Array(Type.Record(Type.String(), Type.Unknown()), {
        description: 'Up to 5 result rows. The agent has already validated this query via ExecuteQuery — include only the rows it actually saw.',
      }),
    }),
    {
      description: 'Execution-validated example queries that demonstrate the verified findings. Cap at 5.',
    },
  ),
});

export type AutoContextPayload = Static<typeof FinishAutoContextParams>;

const FINISH_AUTO_CONTEXT_DESCRIPTION = `Finalises the AutoContext run. Call this exactly once, at the end of your turn, with the structured catalog summary you assembled: per-table notes, per-column notes, verified joins, and execution-validated example queries.

Only include joins you actually validated with ExecuteQuery (e.g. a COUNT(*) JOIN or a WHERE IN probe). Only include example queries whose result rows you observed via ExecuteQuery. Do not fabricate evidence.`;

export const FINISH_AUTO_CONTEXT_SCHEMA: Tool<typeof FinishAutoContextParams> = {
  name: 'FinishAutoContext',
  description: FINISH_AUTO_CONTEXT_DESCRIPTION,
  parameters: FinishAutoContextParams,
};

export interface FinishAutoContextDetails extends Record<string, unknown> {
  type: 'auto_context';
  payload: AutoContextPayload;
}

/**
 * No-op finisher: echoes its structured args back as the tool's content and
 * stashes the parsed payload under `details.payload`. The parent agent
 * reads it off the `toolResult` to render markdown.
 */
export class FinishAutoContext extends MXTool<
  typeof FinishAutoContextParams,
  BenchmarkAnalystContext,
  FinishAutoContextDetails
> {
  static readonly schema: Tool<typeof FinishAutoContextParams> = FINISH_AUTO_CONTEXT_SCHEMA;

  async run(): Promise<ToolResponse<FinishAutoContextDetails>> {
    const payload = this.parameters as AutoContextPayload;
    return {
      content: [{
        type: 'text',
        text: `AutoContext finalised: ${payload.tables.length} table(s), ${payload.tables.reduce((n, t) => n + t.joins.length, 0)} join(s), ${payload.examples.length} example(s).`,
      }],
      details: { type: 'auto_context', payload },
      isError: false,
    };
  }
}
