/**
 * Recipe "detach" — the full-control escape hatch (RFC §21.10).
 *
 * Recipes carry a curated handful of params (the common 80%). For anything beyond that,
 * DETACH the chart: materialize the recipe into its grammar spec and freeze that spec
 * into the envelope as a raw source (`kind: 'vega'` for native-Vega recipes, `kind:
 * 'vega-lite'` for VL ones). From then on there is no template — the spec is a plain
 * field the agent edits directly (any mark, signal, projection, layer), so no new recipe
 * param is ever needed for the long tail. One-way: the recipe was scaffolding to reach a
 * good spec fast.
 */
import { materializeRecipe } from './viz-templates';
import { VIZ_GRAMMAR_VEGA, VIZ_GRAMMAR_VEGA_LITE } from '@/lib/validation/atlas-schemas';
import type { VizEnvelope, VizSourceRecipe } from '@/lib/validation/atlas-schemas';

/**
 * Freeze a recipe envelope into a raw-spec envelope. Non-recipe sources are returned
 * unchanged (idempotent — detaching a detached chart is a no-op). Throws if the recipe
 * fails to materialize (e.g. a missing required binding) — the caller surfaces it.
 */
export function detachRecipe(envelope: VizEnvelope): VizEnvelope {
  const source = envelope.source as unknown as { kind: string };
  if (source.kind !== 'recipe') return envelope;

  const recipeSource = source as unknown as VizSourceRecipe;
  const materialized = materializeRecipe(recipeSource);
  if (!materialized.ok) throw new Error(materialized.error);

  // `detachedFrom` keeps the exact recipe source so the chart can be re-attached (reset),
  // discarding any custom spec edits — a soft undo of the one-way detach.
  const detached = materialized.engine === 'vega'
    ? {
        kind: 'vega' as const,
        grammar: VIZ_GRAMMAR_VEGA,
        spec: materialized.spec,
        assets: materialized.assets ?? null,
        detachedFrom: recipeSource,
      }
    : {
        kind: 'vega-lite' as const,
        grammar: VIZ_GRAMMAR_VEGA_LITE,
        spec: materialized.spec,
        detachedFrom: recipeSource,
      };

  return { ...envelope, source: detached } as unknown as VizEnvelope;
}

/** Can this envelope be re-attached to its source recipe? (Only detached-from-recipe charts.) */
export function canReattach(envelope: VizEnvelope): boolean {
  const source = envelope.source as unknown as { detachedFrom?: unknown };
  return source?.detachedFrom != null;
}

/**
 * Reverse a detach: restore the original recipe source, discarding the custom spec (and
 * any edits to it). No-op if the envelope wasn't detached from a recipe.
 */
export function reattachRecipe(envelope: VizEnvelope): VizEnvelope {
  const source = envelope.source as unknown as { detachedFrom?: VizSourceRecipe | null };
  if (source?.detachedFrom == null) return envelope;
  return { ...envelope, source: source.detachedFrom } as unknown as VizEnvelope;
}
