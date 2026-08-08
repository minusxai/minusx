/**
 * Interactive editing of LIVE file-recipe charts (client-safe, pure).
 *
 * A chart made from a workspace recipe stores a REFERENCE
 * ({kind:'recipe', recipe: name-or-path, bindings}); materialization attaches
 * the substituted spec as computed fields (`spec`/`grammar` — the file loader
 * server-side, the panel client-side) which the save gate strips. With the
 * recipe definition in hand — the panel injects it, resolved via Redux file
 * state or the built-in template registry — the chart stays BINDABLE: zones from the
 * declared slots, and every rebind rewrites `bindings` and re-materializes the
 * computed preview. A frozen source that recorded its file-recipe provenance in
 * `detachedFrom` (the inspector's detach flow) rebinds the same way, staying a
 * frozen spec.
 */
import type { VizEnvelope, VizSourceRecipe } from '@/lib/validation/atlas-schemas';
import { freezeFileRecipe, isFileRecipePath, materializeFileRecipe, type VizRecipeContent } from './recipe-file';
import { immutableSet } from '@/lib/utils/immutable-collections';
import type { VizResultColumn } from './types';

/**
 * The file-recipe reference an envelope carries, or null: either a LIVE
 * `kind:'recipe'` source outside the shipped `minusx/` namespace, or a frozen
 * spec whose `detachedFrom` records a file recipe. Shipped-recipe detachments
 * (`minusx/…`) are NOT file recipes — their editing story is reattachRecipe.
 */
export function getFileRecipeRef(envelope: VizEnvelope): VizSourceRecipe | null {
  const source = envelope?.source as
    | { kind?: string; recipe?: unknown; detachedFrom?: VizSourceRecipe | null }
    | undefined;
  if (!source) return null;
  if (source.kind === 'recipe') {
    if (typeof source.recipe !== 'string' || source.recipe.startsWith('minusx/')) return null;
    return source as unknown as VizSourceRecipe;
  }
  if (source.kind !== 'vega-lite' && source.kind !== 'vega') return null;
  const ref = source.detachedFrom;
  if (!ref || typeof ref.recipe !== 'string' || ref.recipe.startsWith('minusx/')) return null;
  return ref;
}

/** Attach the computed materialization to a reference source (render-ready preview). */
function withComputedSpec(
  source: VizSourceRecipe,
  content: VizRecipeContent,
  columns?: VizResultColumn[],
): VizSourceRecipe {
  const materialized = materializeFileRecipe(content, source.bindings, source.params ?? null, columns);
  const next = { ...source } as VizSourceRecipe & { spec?: unknown; grammar?: string; unresolved?: string };
  delete next.unresolved;
  if (materialized.ok) {
    next.spec = materialized.spec;
    next.grammar = materialized.engine === 'vega' ? 'vega@6' : 'vega-lite@6';
  }
  return next;
}

/**
 * Rewrite the bindings, preserving the envelope's other fields. A LIVE
 * reference keeps its `kind:'recipe'` shape and re-materializes the computed
 * preview; a frozen `detachedFrom` source re-freezes. An incomplete binding set
 * (a just-emptied slot) keeps the PREVIOUS spec — visibly stale until the
 * slots are complete again — because neither shape can render an unbound state.
 */
export function rebindFileRecipe(
  envelope: VizEnvelope,
  content: VizRecipeContent,
  bindings: Record<string, string | string[]>,
  columns?: VizResultColumn[],
): VizEnvelope {
  const ref = getFileRecipeRef(envelope);
  if (!ref) return envelope;

  const sourceKind = (envelope.source as { kind?: string }).kind;
  if (sourceKind === 'recipe') {
    const materialized = materializeFileRecipe(content, bindings, ref.params ?? null, columns);
    const prev = envelope.source as unknown as VizSourceRecipe & { spec?: unknown; grammar?: string };
    const next: Record<string, unknown> = { ...prev, bindings };
    if (materialized.ok) {
      next.spec = materialized.spec;
      next.grammar = materialized.engine === 'vega' ? 'vega@6' : 'vega-lite@6';
      delete next.unresolved;
    }
    // else: keep the previous computed spec (stale) — bindings record progress.
    return { ...envelope, source: next } as unknown as VizEnvelope;
  }

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
 * (hover tooltip) and the failure toast.
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
 * build a LIVE reference envelope. `address` is what the reference records —
 * the file path, or a built-in's bare name — so recipe edits keep propagating
 * to this chart. The computed spec rides along for immediate render (stripped
 * at save). Failures carry the same human phrasing as `explainRecipeFit`.
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
  const reference: VizSourceRecipe = {
    kind: 'recipe',
    recipe: address,
    bindings: bound.bindings,
    params: null,
    columnFormats: null,
  } as unknown as VizSourceRecipe;
  const source = withComputedSpec(reference, content, columns);
  if (!(source as { spec?: unknown }).spec) {
    return { ok: false, error: explainRecipeFit(content, columns) ?? 'recipe does not fit this result' };
  }
  return {
    ok: true,
    envelope: { version: 2, source } as unknown as VizEnvelope,
  };
}

export { isFileRecipePath };
