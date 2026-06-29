// What the AGENT sees + may edit on a context file.
//
// A context carries server-COMPUTED fields the loader re-hydrates each read: `fullSchema` (the
// resolved own schema = parentSchema ∩ own whitelist), `parentSchema` (the menu of what's available
// to whitelist), and the inherited menus `fullDocs`/`fullMetrics`/`fullAnnotations`/`fullSkills`.
// Dumping the whole schema cache (esp. `parentSchema` WITH columns) into the markup every turn is the
// "too large / all sorts of issues" the user hit. These helpers shape the agent's VIEW and bound its
// EDITS so it sees what it needs (current whitelist/docs + the available/inheritable menus) without
// the columnar bulk, and edits only the authored fields.

import { immutableSet } from '@/lib/utils/immutable-collections';
import { CONTEXT_BUDGETS } from '@/lib/context/context-budgets';

// Char budget governing how much of `parentSchema` (the menu of tables available to whitelist) the
// agent's edit markup carries. Graceful degradation: under budget → full (with columns); over →
// names only; still over → capped names + a SearchDBSchema note.
const PARENT_SCHEMA_BUDGET_CHARS = CONTEXT_BUDGETS.contextParentSchemaChars;

// Version fields the agent authors and may edit via EditFile.
const EDITABLE_VERSION_FIELDS = ['whitelist', 'docs', 'metrics', 'annotations', 'description'] as const;
// Server-computed fields: re-derived on load, stripped on save — ignore them when bounding edits.
const COMPUTED_CONTEXT_FIELDS = immutableSet([
  'fullSchema', 'parentSchema', 'fullDocs', 'fullMetrics', 'fullAnnotations', 'fullSkills',
]);

/**
 * Reduce a DatabaseWithSchema[] to a NAMES-ONLY table-of-contents (connection → schema → table, no
 * columns), capped to `budget` chars. Tables are kept in order until the budget is exhausted; schemas
 * (and connections) left with no kept tables are pruned. Returns the capped TOC plus total/kept table
 * counts so the caller can note when it truncated.
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
 * Graceful degradation for `parentSchema` (the menu of tables available to whitelist) against a char
 * budget:
 *  1. fits as-is → keep it WITH columns (full fidelity — agent can document + whitelist without a
 *     SearchDBSchema round-trip),
 *  2. names-only fits → drop columns, keep every table name,
 *  3. still too big → cap the table names to the budget + a note pointing at SearchDBSchema.
 */
function shapeParentSchema(parentSchema: unknown[], budget: number): { value: unknown[]; note?: string } {
  if (JSON.stringify(parentSchema).length <= budget) return { value: parentSchema };
  const namesOnly = capSchemaToc(parentSchema, Number.POSITIVE_INFINITY).capped;
  if (JSON.stringify(namesOnly).length <= budget) return { value: namesOnly };
  const { capped, total, kept } = capSchemaToc(parentSchema, budget);
  return {
    value: capped,
    note: `Showing ${kept} of ${total} tables available to whitelist — the schema is too large to list in full. Use the SearchDBSchema tool to find any table not listed here.`,
  };
}

/**
 * Shape a context's content for the agent's read/edit markup:
 *  - drop `fullSchema` (the RESOLVED own schema — derivable; it's a subset of `parentSchema`, and the
 *    whitelisted table list is already in the prompt schema every page gets),
 *  - degrade `parentSchema` (the available-to-whitelist menu) against a budget (see shapeParentSchema)
 *    — full with columns when small, names-only or capped when large; column detail otherwise comes
 *    on demand via SearchDBSchema,
 *  - keep the inherited menus (fullDocs/fullMetrics/fullAnnotations/fullSkills) so the agent knows
 *    what it can inherit, and the authored versions (whitelist/docs/…) it edits.
 * Returns a shallow clone; never mutates the input. No-op for non-context content.
 */
export function shapeContextForAgent<T>(content: T): T {
  if (!content || typeof content !== 'object') return content;
  const out = { ...(content as Record<string, unknown>) };
  if ('fullSchema' in out) delete out.fullSchema;
  if (Array.isArray(out.parentSchema)) {
    const { value, note } = shapeParentSchema(out.parentSchema, PARENT_SCHEMA_BUDGET_CHARS);
    out.parentSchema = value;
    if (note) out.parentSchemaNote = note;
  }
  return out as T;
}

/** Drop the editable + computed fields, leaving only the fields an EditFile must NOT touch. */
function contextEditInvariant(content: unknown): unknown {
  if (!content || typeof content !== 'object') return content;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(content as Record<string, unknown>)) {
    if (COMPUTED_CONTEXT_FIELDS.has(k) || k === 'docs') continue; // computed (ignored) + legacy top-level docs (editable)
    out[k] = v;
  }
  if (Array.isArray(out.versions)) {
    out.versions = (out.versions as Record<string, unknown>[]).map((v) => {
      const vv: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) {
        if ((EDITABLE_VERSION_FIELDS as readonly string[]).includes(k)) continue;
        vv[k] = val;
      }
      return vv;
    });
  }
  return out;
}

/**
 * True if an EditFile on a context changed ONLY a version's authored fields (whitelist, docs,
 * metrics, annotations, description). Version identity and the published pointer must be unchanged;
 * the server-computed menus are ignored (re-derived on load, so round-trip noise never false-rejects).
 */
export function contextEditWithinBounds(before: unknown, after: unknown): boolean {
  return JSON.stringify(contextEditInvariant(before)) === JSON.stringify(contextEditInvariant(after));
}
