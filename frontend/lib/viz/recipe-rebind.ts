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

/** Plain words for the accept kinds — user-facing, never the grammar vocabulary. */
const KIND_WORDS: Record<string, string> = {
  nominal: 'text',
  quantitative: 'number',
  temporal: 'date',
};

type AutoBindResult =
  | { ok: true; bindings: Record<string, string | string[]> }
  | { ok: false; slot: VizRecipeContent['bindings'][number]; exhausted: boolean };

/**
 * The one greedy auto-bind walk (first unused column whose kind a slot accepts;
 * multi slots take every remaining match). Selection, applicability greying,
 * and failure toasts all read THIS, so they can never disagree about fit.
 */
function autoBindRecipe(content: VizRecipeContent, columns: VizResultColumn[]): AutoBindResult {
  const used = new Set<string>();
  const kindOf = (c: VizResultColumn) => (KIND_OK.has(c.kind) ? c.kind : 'nominal');
  const bindings: Record<string, string | string[]> = {};
  for (const slot of content.bindings) {
    const accepted = (c: VizResultColumn) => (slot.accepts as readonly string[]).includes(kindOf(c));
    const matches = columns.filter((c) => !used.has(c.name) && accepted(c));
    if (matches.length === 0) {
      // "Nothing left" (columns of the right kind exist but earlier slots took
      // them) reads very differently from "this result has none" — say which.
      return { ok: false, slot, exhausted: columns.some(accepted) };
    }
    if (slot.multi) {
      bindings[slot.name] = matches.map((c) => c.name);
      matches.forEach((c) => used.add(c.name));
    } else {
      bindings[slot.name] = matches[0].name;
      used.add(matches[0].name);
    }
  }
  return { ok: true, bindings };
}

/**
 * Why this recipe cannot apply to this result, in words a chart user
 * understands — or null when it fits. Drives the greyed-out Workspace tiles
 * (hover title) and the failure toast.
 */
export function explainRecipeFit(content: VizRecipeContent, columns: VizResultColumn[]): string | null {
  if (columns.length === 0) return 'Run the query first — recipes bind to the result columns.';
  const bound = autoBindRecipe(content, columns);
  if (bound.ok) return null;
  const words = bound.slot.accepts.map((k) => KIND_WORDS[k] ?? k).join(' or ');
  const tail = bound.exhausted
    ? 'every matching column is already assigned to another slot'
    : 'this result has none';
  return `Needs a ${words} column for “${bound.slot.label}” — ${tail}.`;
}

/**
 * Selector flow: auto-bind the declared slots from the result columns and
 * freeze. `address` is what provenance records — the file path, or a built-in's
 * bare name. Failures carry the same human phrasing as `explainRecipeFit`.
 */
export function applyFileRecipeSelection(
  content: VizRecipeContent,
  address: string,
  columns: VizResultColumn[],
): ApplyFileRecipeResult {
  const unfit = explainRecipeFit(content, columns);
  if (unfit) return { ok: false, error: unfit };
  const bound = autoBindRecipe(content, columns);
  if (!bound.ok) return { ok: false, error: explainRecipeFit(content, columns) ?? 'recipe does not fit this result' };
  const frozenSource = freezeFileRecipe(content, { path: address, bindings: bound.bindings }, columns);
  if (!frozenSource.ok) return frozenSource;
  return {
    ok: true,
    envelope: { version: 2, source: frozenSource.source } as unknown as VizEnvelope,
  };
}

export { isFileRecipePath };
