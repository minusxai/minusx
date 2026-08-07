/**
 * Interactive editing of FROZEN file-recipe charts (client-safe, pure).
 *
 * A chart made from a workspace recipe stores a substituted spec plus the full
 * reference in `detachedFrom` (recipe = file path, or a built-in's bare name).
 * With the recipe definition in hand — the panel injects it, resolved via
 * Redux file state or `BUILTIN_VIZ_RECIPES` — the chart stays BINDABLE: zones
 * from the declared slots, and every rebind re-substitutes and re-freezes.
 * Rendering never resolves anything; these helpers only run in edit surfaces.
 */
import type { VizEnvelope, VizSourceRecipe } from '@/lib/validation/atlas-schemas';
import { freezeFileRecipe, isFileRecipePath, type VizRecipeContent } from './recipe-file';
import { immutableSet } from '@/lib/utils/immutable-collections';
import type { VizResultColumn } from './types';

/**
 * The reference a frozen file-recipe source carries, or null. Shipped-recipe
 * detachments (`minusx/…`) are NOT file recipes — their editing story is
 * reattachRecipe, not rebinding.
 */
export function getFileRecipeRef(envelope: VizEnvelope): VizSourceRecipe | null {
  const source = envelope?.source as { kind?: string; detachedFrom?: VizSourceRecipe | null } | undefined;
  if (!source || (source.kind !== 'vega-lite' && source.kind !== 'vega')) return null;
  const ref = source.detachedFrom;
  if (!ref || typeof ref.recipe !== 'string' || ref.recipe.startsWith('minusx/')) return null;
  return ref;
}

/**
 * Re-substitute with new bindings and re-freeze, preserving the envelope's other
 * fields. An incomplete binding set (a just-emptied slot) keeps the PREVIOUS
 * spec — visibly stale until the slots are complete again — because a frozen
 * source has no way to render an unbound state.
 */
export function rebindFileRecipe(
  envelope: VizEnvelope,
  content: VizRecipeContent,
  bindings: Record<string, string | string[]>,
  columns?: VizResultColumn[],
): VizEnvelope {
  const ref = getFileRecipeRef(envelope);
  if (!ref) return envelope;
  const next = freezeFileRecipe(content, {
    path: ref.recipe,
    bindings,
    params: ref.params ?? null,
    columnFormats: ref.columnFormats ?? null,
  }, columns);
  if (!next.ok) {
    // Keep the stale spec; record the in-progress bindings on provenance.
    const source = envelope.source as { detachedFrom?: VizSourceRecipe | null };
    return {
      ...envelope,
      source: { ...envelope.source, detachedFrom: { ...(source.detachedFrom as VizSourceRecipe), bindings } },
    } as VizEnvelope;
  }
  return { ...envelope, source: next.source } as VizEnvelope;
}

export type ApplyFileRecipeResult =
  | { ok: true; envelope: VizEnvelope }
  | { ok: false; error: string };

const KIND_OK = immutableSet(['nominal', 'quantitative', 'temporal']);

/**
 * Selector flow: auto-bind the declared slots from the result columns (first
 * unused column whose kind a slot accepts; multi slots take every remaining
 * match) and freeze. `address` is what provenance records — the file path, or
 * a built-in's bare name.
 */
export function applyFileRecipeSelection(
  content: VizRecipeContent,
  address: string,
  columns: VizResultColumn[],
): ApplyFileRecipeResult {
  const used = new Set<string>();
  const kindOf = (c: VizResultColumn) => (KIND_OK.has(c.kind) ? c.kind : 'nominal');
  const bindings: Record<string, string | string[]> = {};
  for (const slot of content.bindings) {
    const matches = columns.filter((c) => !used.has(c.name) && (slot.accepts as readonly string[]).includes(kindOf(c)));
    if (matches.length === 0) {
      return { ok: false, error: `no result column fits slot "${slot.name}" (accepts ${slot.accepts.join('|')})` };
    }
    if (slot.multi) {
      bindings[slot.name] = matches.map((c) => c.name);
      matches.forEach((c) => used.add(c.name));
    } else {
      bindings[slot.name] = matches[0].name;
      used.add(matches[0].name);
    }
  }
  const frozenSource = freezeFileRecipe(content, { path: address, bindings }, columns);
  if (!frozenSource.ok) return frozenSource;
  return {
    ok: true,
    envelope: { version: 2, source: frozenSource.source } as unknown as VizEnvelope,
  };
}

export { isFileRecipePath };
