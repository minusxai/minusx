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

// Version fields the agent authors and may edit via EditFile.
const EDITABLE_VERSION_FIELDS = ['whitelist', 'docs', 'metrics', 'annotations', 'description'] as const;
// Server-computed fields: re-derived on load, stripped on save — ignore them when bounding edits.
const COMPUTED_CONTEXT_FIELDS = immutableSet([
  'fullSchema', 'parentSchema', 'fullDocs', 'fullMetrics', 'fullAnnotations', 'fullSkills',
]);

/** Reduce a DatabaseWithSchema[] to NAMES ONLY (connection → schema → table), dropping columns. */
function toSchemaToc(schema: unknown[]): unknown[] {
  return schema.map((db) => {
    const d = db as { schemas?: unknown[] };
    return {
      ...(db as object),
      schemas: d.schemas?.map((s) => {
        const sc = s as { tables?: { table: string }[] };
        return { ...(s as object), tables: sc.tables?.map((t) => ({ table: t.table })) };
      }),
    };
  });
}

/**
 * Shape a context's content for the agent's read/edit markup:
 *  - drop `fullSchema` (the RESOLVED own schema — derivable; the whitelisted table list is already in
 *    the prompt schema, the same capped TOC every page gets),
 *  - reduce `parentSchema` (the available-to-whitelist menu) to NAMES ONLY — column detail on demand
 *    via SearchDBSchema,
 *  - keep the inherited menus (fullDocs/fullMetrics/fullAnnotations/fullSkills) so the agent knows
 *    what it can inherit, and the authored versions (whitelist/docs/…) it edits.
 * Returns a shallow clone; never mutates the input. No-op for non-context content.
 */
export function shapeContextForAgent<T>(content: T): T {
  if (!content || typeof content !== 'object') return content;
  const out = { ...(content as Record<string, unknown>) };
  if ('fullSchema' in out) delete out.fullSchema;
  if (Array.isArray(out.parentSchema)) out.parentSchema = toSchemaToc(out.parentSchema);
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
