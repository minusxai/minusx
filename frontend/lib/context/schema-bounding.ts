// Memory bounding for a context's COMPUTED schema fields (fullSchema / parentSchema), applied at
// LOAD time in the context loader. A single large connection (e.g. 1963 tables) makes each field
// ~4 MB of columnar JSON; the loader recomputes and ships both into every API response, the Redux
// store, and chat payloads on every read — the production OOM. These helpers strip the columnar bulk
// (and, for the editor menu, cap the table list) before the schema is stored/serialized/shipped.
//
// This is a SEPARATE concern from `context-agent-view.ts` (which shapes what the agent sees/edits in
// markup, and deliberately drops the schema there). The loader still needs the resolved schema in the
// content — just bounded — so these live in their own module rather than coupling to the agent view.

import { CONTEXT_BUDGETS } from '@/lib/context/context-budgets';

// Char budget at which a context's schema fields are degraded: under it → keep columns; over → drop
// columns (names only); for the editor MENU (parentSchema) only, still over → cap the table list.
export const PARENT_SCHEMA_BUDGET_CHARS = CONTEXT_BUDGETS.contextParentSchemaChars;

/**
 * Reduce a DatabaseWithSchema[] to a NAMES-ONLY table-of-contents (connection → schema → table, no
 * columns), capped to `budget` chars. Tables are kept in order until the budget is exhausted; schemas
 * (and connections) left with no kept tables are pruned. Returns the capped TOC plus total/kept table
 * counts so the caller can note when it truncated. Pass `Infinity` to keep EVERY table (names-only).
 */
function capSchemaToc(schema: unknown[], budget: number): { capped: unknown[]; total: number; kept: number } {
  let used = 0;
  let total = 0;
  let kept = 0;
  let truncated = false;
  const capped: unknown[] = [];
  for (const db of schema) {
    const d = db as { schemas?: unknown[] };
    const keptSchemas: unknown[] = [];
    for (const s of d.schemas ?? []) {
      const sc = s as { tables?: { table: string }[] };
      const keptTables: { table: string }[] = [];
      for (const t of sc.tables ?? []) {
        total++;
        const cost = (t.table?.length ?? 0) + 2; // ~JSON quoting/comma overhead per name
        if (!truncated && used + cost <= budget) {
          keptTables.push({ table: t.table });
          used += cost;
          kept++;
        } else {
          truncated = true;
        }
      }
      if (keptTables.length > 0) keptSchemas.push({ ...(s as object), tables: keptTables });
    }
    if (keptSchemas.length > 0) capped.push({ ...(db as object), schemas: keptSchemas });
  }
  return { capped, total, kept };
}

/**
 * Estimate the serialized size of a schema in O(1) extra space, exiting as soon as `limit` is
 * exceeded. Used instead of `JSON.stringify(...).length` so bounding a multi-MB schema never
 * materializes a multi-MB string (which would defeat the memory fix). Slightly OVER-estimates
 * (constant per-node overhead), so "estimate ≤ budget" is a conservative "definitely small" test.
 */
function estimatedSchemaChars(schema: unknown[], limit: number): number {
  let n = 0;
  for (const db of schema) {
    const d = db as { databaseName?: string; schemas?: unknown[] };
    n += (d.databaseName?.length ?? 0) + 24;
    for (const s of d.schemas ?? []) {
      const sc = s as { schema?: string; tables?: unknown[] };
      n += (sc.schema?.length ?? 0) + 24;
      for (const t of sc.tables ?? []) {
        const tb = t as { table?: string; columns?: unknown[] };
        n += (tb.table?.length ?? 0) + 16;
        for (const c of tb.columns ?? []) {
          const col = c as { name?: string; type?: string };
          n += (col.name?.length ?? 0) + (col.type?.length ?? 0) + 28;
        }
        if (n > limit) return n; // early exit — no need to keep counting a huge schema
      }
    }
  }
  return n;
}

/**
 * Graceful degradation for `parentSchema` (the menu of tables available to whitelist) against a char
 * budget:
 *  1. fits as-is → keep it WITH columns,
 *  2. names-only fits → drop columns, keep every table name,
 *  3. still too big → cap the table names to the budget + a note pointing at SearchDBSchema.
 */
function shapeParentSchema(parentSchema: unknown[], budget: number): { value: unknown[]; note?: string } {
  if (estimatedSchemaChars(parentSchema, budget) <= budget) return { value: parentSchema };
  const namesOnly = capSchemaToc(parentSchema, Number.POSITIVE_INFINITY).capped;
  if (estimatedSchemaChars(namesOnly, budget) <= budget) return { value: namesOnly };
  const { capped, total, kept } = capSchemaToc(parentSchema, budget);
  return {
    value: capped,
    note: `Showing ${kept} of ${total} tables available to whitelist — the schema is too large to list in full. Use the SearchDBSchema tool to find any table not listed here.`,
  };
}

/**
 * Bound a context's RESOLVED `fullSchema` for memory WITHOUT ever dropping a table. Strips columns
 * (the bulk) when the schema is large, but keeps EVERY table name. Critical because a child context
 * inherits from its parent's `fullSchema` — table-capping the parent would silently hide tables from
 * children. (Whitelisting + inheritance are table-level, so names are sufficient; columns come on
 * demand via SearchDBSchema.) Keeps columns for small schemas (no change).
 */
export function boundFullSchema(schema: unknown, budget: number = PARENT_SCHEMA_BUDGET_CHARS): unknown {
  if (!Array.isArray(schema)) return schema;
  if (estimatedSchemaChars(schema, budget) <= budget) return schema;        // small → keep columns
  return capSchemaToc(schema, Number.POSITIVE_INFINITY).capped;             // large → names-only, ALL tables
}

/**
 * Bound a context's `parentSchema` (the available-to-whitelist MENU) for memory — graceful
 * degradation (keep columns when small; names-only or table-capped when huge). The cap is safe here
 * because `parentSchema` is a display menu, NOT an inheritance source (children inherit from
 * `fullSchema` — see boundFullSchema).
 */
export function boundSchema(schema: unknown, budget: number = PARENT_SCHEMA_BUDGET_CHARS): unknown {
  if (!Array.isArray(schema)) return schema;
  return shapeParentSchema(schema, budget).value;
}
