/**
 * Renders the agent's whitelisted schema (a flat schema → table-name list) into
 * the prompt string, with a CHARACTER BUDGET safety rail.
 *
 * The schema injected into the system prompt is only a table-of-contents
 * (schema names + table names — no columns; see `flattenSchemaForPrompt` in
 * `agent-args.server.ts`). A rogue/large database can still have tens of
 * thousands of tables and blow the context window. This function walks the
 * schema in order, including names until the budget is exhausted, then appends a
 * note telling the agent how many more exist and to use the SearchDBSchema tool.
 *
 * It is applied right before JSON-stringification at the prompt boundary, so the
 * full schema array is still available upstream for tool filtering
 * (`whitelistedTables`) — only the prompt text is capped.
 */
import { CONTEXT_BUDGETS } from '@/lib/context/context-budgets';

export type SchemaEntry = { schema: string; tables: string[] };

export interface RenderSchemaPromptOptions {
  /** Max characters of schema/table names to include before truncating. */
  budgetChars?: number;
  /** Pretty-print the JSON (indent 2). Default false. */
  pretty?: boolean;
  /** Text returned when schema is null/undefined (NOT empty array). Default ''. */
  emptyText?: string;
}

/** Default character budget for the schema table-of-contents in the prompt.
 *  Sourced from the central context-budget dashboard. */
export const DEFAULT_SCHEMA_PROMPT_BUDGET_CHARS = CONTEXT_BUDGETS.schemaTocChars;

export function renderSchemaForPrompt(
  schema: SchemaEntry[] | null | undefined,
  options: RenderSchemaPromptOptions = {},
): string {
  const { budgetChars = DEFAULT_SCHEMA_PROMPT_BUDGET_CHARS, pretty = false, emptyText = '' } = options;

  if (schema == null) return emptyText;

  const included: SchemaEntry[] = [];
  let used = 0;
  let truncated = false;
  let droppedTables = 0;
  let droppedSchemas = 0;

  for (const entry of schema) {
    const keptTables: string[] = [];
    for (const table of entry.tables) {
      // +2 approximates the JSON quoting/comma overhead per table name.
      const cost = table.length + 2;
      if (!truncated && used + cost <= budgetChars) {
        keptTables.push(table);
        used += cost;
      } else {
        truncated = true;
        droppedTables++;
      }
    }
    if (keptTables.length > 0) {
      included.push({ schema: entry.schema, tables: keptTables });
      used += entry.schema.length;
    } else {
      // Whole schema omitted (no tables fit the budget).
      droppedSchemas++;
    }
  }

  const json = pretty ? JSON.stringify(included, null, 2) : JSON.stringify(included);
  if (!truncated) return json;

  let note = `\n[Schema truncated to fit context: ${droppedTables} more table(s)`;
  if (droppedSchemas > 0) note += ` across ${droppedSchemas} more schema(s)`;
  note += ` not shown. Use the SearchDBSchema tool to explore the rest of the schema.]`;
  return json + note;
}
