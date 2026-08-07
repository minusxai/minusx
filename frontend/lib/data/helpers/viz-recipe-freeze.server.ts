/**
 * Freeze-at-use for workspace viz recipes, applied on EVERY save path.
 *
 * A `viz` envelope may reference a recipe three ways:
 *  - a shipped registry id (`minusx/funnel@1`) — a LIVE reference, left untouched
 *    (app code cannot be deleted, so the reference is stable);
 *  - an absolute `.viz` file path (`/org/bullet`);
 *  - a bare name (`bullet`), resolved against the SAVED FILE's folder with
 *    nearest-ancestor-wins shadowing over workspace files and built-ins.
 *
 * File/built-in references are FROZEN here: the template is substituted and the
 * envelope's source becomes a self-contained `vega`/`vega-lite` spec carrying the
 * full reference in `detachedFrom` (recipe = the file path, or the bare built-in
 * name). Saved charts therefore never depend on the recipe file's continued
 * existence; editing a recipe changes only charts frozen after the edit.
 *
 * Column kinds are not known at save (no query runs here), so `{{slot:kind}}`
 * falls back to each slot's first `accepts` kind; the viz panel re-freezes with
 * real columns on any rebind. This mirrors the static V1→V2 converter's
 * deliberate under-typing: `nominal` renders plainer, never wrong.
 *
 * FilesAPI injects the two loaders, so this module never imports files.server.
 */
import { freezeFileRecipe, isFileRecipePath } from '@/lib/viz/recipe-file';
import { resolveVizRecipes, type VizRecipeFileMeta } from '@/lib/viz/recipe-resolve';
import { getTemplate, VIZ_TEMPLATES } from '@/lib/viz/viz-templates';
import { validateVizEnvelope } from '@/lib/viz/validate';
import { formatVizIssues } from '@/lib/viz/types';
import type { VizRecipeContent, VizSourceRecipe } from '@/lib/validation/atlas-schemas';
import type { FileType } from '@/lib/types';

export interface VizRecipeLoaders {
  /** Every `.viz` file visible to the acting user (all folders; ancestry filters). */
  listVizFiles(): Promise<VizRecipeFileMeta[]>;
  /** Load one `.viz` file's content by id. */
  loadVizContent(fileId: number): Promise<VizRecipeContent | null>;
}

export type FreezeContentResult =
  | { ok: true; content: unknown; frozeAny: boolean }
  | { ok: false; error: string };

/** The envelope slots a file type carries: question → content.viz, notebook → each cell. */
function envelopeHolders(type: FileType, content: Record<string, unknown>): Array<Record<string, unknown>> {
  if (type === 'question') return [content];
  if (type === 'notebook' && Array.isArray(content.cells)) {
    return (content.cells as Array<Record<string, unknown>>).filter((c) => c && typeof c === 'object');
  }
  return [];
}

/** A recipe source needing freeze: any id outside the shipped `minusx/` namespace. */
function needsFreeze(source: unknown): source is VizSourceRecipe {
  if (!source || typeof source !== 'object') return false;
  const s = source as { kind?: unknown; recipe?: unknown };
  return s.kind === 'recipe' && typeof s.recipe === 'string' && !getTemplate(s.recipe) && !s.recipe.startsWith('minusx/');
}

/**
 * Freeze every workspace-recipe viz reference in `content` (immutable — returns
 * a new content object when anything froze). `folder` is the SAVED file's
 * directory, the resolution scope for bare names.
 */
export async function freezeVizRecipesInContent(
  type: FileType,
  content: unknown,
  folder: string,
  loaders: VizRecipeLoaders,
): Promise<FreezeContentResult> {
  if (!content || typeof content !== 'object') return { ok: true, content, frozeAny: false };
  if (type !== 'question' && type !== 'notebook') return { ok: true, content, frozeAny: false };

  const holders = envelopeHolders(type, content as Record<string, unknown>);
  const wanting = holders.filter((h) => {
    const viz = h.viz as { source?: unknown } | null | undefined;
    return viz && typeof viz === 'object' && needsFreeze(viz.source);
  });
  if (wanting.length === 0) return { ok: true, content, frozeAny: false };

  const files = await loaders.listVizFiles();
  const next = JSON.parse(JSON.stringify(content)) as Record<string, unknown>;

  for (const holder of envelopeHolders(type, next)) {
    const viz = holder.viz as { source?: unknown } | null | undefined;
    if (!viz || typeof viz !== 'object' || !needsFreeze(viz.source)) continue;
    const source = viz.source as VizSourceRecipe;

    // Resolve: absolute path → that exact file; bare name → shadowing rules.
    let recipeContent: VizRecipeContent | null = null;
    let provenancePath = source.recipe;
    if (isFileRecipePath(source.recipe)) {
      const file = files.find((f) => f.path === source.recipe);
      if (file) recipeContent = await loaders.loadVizContent(file.id);
    } else {
      const resolved = resolveVizRecipes(files, folder).get(source.recipe);
      if (resolved?.source === 'builtin') {
        recipeContent = resolved.content;
      } else if (resolved) {
        provenancePath = resolved.path;
        recipeContent = await loaders.loadVizContent(resolved.fileId);
      }
    }
    if (!recipeContent) {
      const available = [...resolveVizRecipes(files, folder).keys(), ...Object.keys(VIZ_TEMPLATES)];
      return { ok: false, error: `unknown viz recipe "${source.recipe}" — available: ${available.join(', ')}` };
    }

    const frozen = freezeFileRecipe(recipeContent, {
      path: provenancePath,
      bindings: source.bindings,
      params: source.params ?? null,
      columnFormats: source.columnFormats ?? null,
    });
    if (!frozen.ok) {
      return { ok: false, error: `viz recipe "${source.recipe}": ${frozen.error}` };
    }
    // Full envelope validation on the substituted spec (data policy + grammar).
    // No columns here, so field checks skip — the panel/tools validate those with
    // the real result before save.
    const validated = validateVizEnvelope({ ...viz, source: frozen.source }, undefined);
    if (!validated.ok) {
      return { ok: false, error: `viz recipe "${source.recipe}" materialized an invalid spec: ${formatVizIssues(validated.issues)}` };
    }
    (holder.viz as Record<string, unknown>).source = frozen.source;
  }

  return { ok: true, content: next, frozeAny: true };
}
