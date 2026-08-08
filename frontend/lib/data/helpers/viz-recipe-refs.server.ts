/**
 * Save gate for LIVE workspace-recipe references. Storage is reference-only:
 * computed materialization (loader-attached `spec`/`grammar`/`unresolved`) is
 * STRIPPED, and the reference is validated strictly —
 *  - an unknown recipe name/path rejects with the resolvable catalog (a typo
 *    must fail at authoring, not render as a silent table later);
 *  - a reference that resolves but cannot materialize (missing binding,
 *    undeclared token) rejects with that reason;
 *  - the materialized spec is grammar-checked (the Vega-Lite package schema is
 *    server-only, which is why this half lives here and not in the client gate).
 * Rendering never depends on this: the read-time loader
 * (lib/data/loaders/viz-recipe-loader.server.ts) re-materializes on every load,
 * so recipe edits propagate to every referencing chart, and a recipe deleted
 * AFTER save degrades that chart to a table fallback instead of an error.
 */
import {
  availableRecipeNames,
  materializeVizRecipeRefsInContent,
  stripVizRecipeComputedFields,
  isWorkspaceRecipeSource,
  type MaterializedRecipeSource,
  type VizRecipeLoaders,
} from '@/lib/viz/recipe-reference-core';
import { validateVizEnvelope } from '@/lib/viz/validate';
import { formatVizIssues } from '@/lib/viz/types';
import type { FileType } from '@/lib/types';

export type { VizRecipeLoaders };

export type RecipeGateResult =
  | { ok: true; content: unknown }
  | { ok: false; error: string };

export async function validateAndStripVizRecipeRefs(
  type: FileType,
  content: unknown,
  folder: string,
  loaders: VizRecipeLoaders,
): Promise<RecipeGateResult> {
  const stripped = stripVizRecipeComputedFields(type, content);
  if (type !== 'question' && type !== 'notebook') return { ok: true, content: stripped };

  // Dry-run materialization over the stripped content; strictness comes from
  // inspecting the outcome rather than a second resolution walk.
  const materialized = await materializeVizRecipeRefsInContent(type, stripped, folder, loaders) as Record<string, unknown>;
  const holders: Array<Record<string, unknown>> = type === 'question'
    ? [materialized]
    : ((materialized as { cells?: Array<Record<string, unknown>> }).cells ?? []);
  for (const holder of holders) {
    const viz = holder?.viz as { source?: Record<string, unknown> } | null | undefined;
    if (!viz?.source || !isWorkspaceRecipeSource(viz.source)) continue;
    const source = viz.source as MaterializedRecipeSource;
    if (source.unresolved === 'not-found') {
      const files = await loaders.listVizFiles().catch(() => []);
      return {
        ok: false,
        error: `unknown viz recipe "${source.recipe}" — available: ${availableRecipeNames(files, folder).join(', ')}`,
      };
    }
    if (source.unresolved) {
      return { ok: false, error: `viz recipe "${source.recipe}": ${source.unresolved}` };
    }
    const validated = validateVizEnvelope({ ...viz, source: { kind: 'vega-lite', grammar: 'vega-lite@6', spec: source.spec, detachedFrom: null, ...(source.grammar === 'vega@6' ? { kind: 'vega', grammar: 'vega@6', assets: null } : {}) } }, undefined);
    if (!validated.ok) {
      return { ok: false, error: `viz recipe "${source.recipe}" materializes an invalid spec: ${formatVizIssues(validated.issues)}` };
    }
  }
  return { ok: true, content: stripped };
}
