/**
 * The freeze-at-use walk over a file's viz envelopes, shared by BOTH freeze
 * sites: the server save path (lib/data/helpers/viz-recipe-freeze.server.ts,
 * which adds full envelope validation) and the browser tool handlers
 * (lib/tools/handlers/viz-recipe-freeze-client.ts, so a staged agent edit
 * renders frozen immediately instead of erroring until save). Client-safe:
 * no validate.ts import — the heavyweight grammar check stays server-side.
 *
 * A `viz` envelope may reference a recipe three ways:
 *  - a shipped registry id (`minusx/funnel@1`) — a LIVE reference, left untouched;
 *  - an absolute `.viz` file path (`/org/bullet`);
 *  - a bare name (`bullet`), resolved against the file's folder with
 *    nearest-ancestor-wins shadowing over workspace files and built-ins.
 */
import { freezeFileRecipe, isFileRecipePath } from './recipe-file';
import { resolveVizRecipes, type VizRecipeFileMeta } from './recipe-resolve';
import { getTemplate, VIZ_TEMPLATES } from './viz-templates';
import type { VizRecipeContent, VizSourceRecipe } from '@/lib/validation/atlas-schemas';
import type { FileType } from '@/lib/types';

export interface VizRecipeLoaders {
  /** Every `.viz` file visible to the acting user (all folders; ancestry filters). */
  listVizFiles(): Promise<VizRecipeFileMeta[]>;
  /** Load one `.viz` file's content by id. */
  loadVizContent(fileId: number): Promise<VizRecipeContent | null>;
}

export type FreezeContentResult =
  | { ok: true; content: unknown; frozen: Array<Record<string, unknown>> }
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
export function needsFreeze(source: unknown): source is VizSourceRecipe {
  if (!source || typeof source !== 'object') return false;
  const s = source as { kind?: unknown; recipe?: unknown };
  return s.kind === 'recipe' && typeof s.recipe === 'string' && !getTemplate(s.recipe) && !s.recipe.startsWith('minusx/');
}

/**
 * Freeze every workspace-recipe viz reference in `content` (immutable — returns
 * a new content object when anything froze, with `frozen` pointing at the new
 * envelope objects so a caller can validate exactly those). `folder` is the
 * edited file's directory, the resolution scope for bare names.
 */
export async function freezeVizRecipesInContentCore(
  type: FileType,
  content: unknown,
  folder: string,
  loaders: VizRecipeLoaders,
): Promise<FreezeContentResult> {
  if (!content || typeof content !== 'object') return { ok: true, content, frozen: [] };
  if (type !== 'question' && type !== 'notebook') return { ok: true, content, frozen: [] };

  const holders = envelopeHolders(type, content as Record<string, unknown>);
  const wanting = holders.filter((h) => {
    const viz = h.viz as { source?: unknown } | null | undefined;
    return viz && typeof viz === 'object' && needsFreeze(viz.source);
  });
  if (wanting.length === 0) return { ok: true, content, frozen: [] };

  const files = await loaders.listVizFiles();
  const next = JSON.parse(JSON.stringify(content)) as Record<string, unknown>;
  const frozen: Array<Record<string, unknown>> = [];

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

    const result = freezeFileRecipe(recipeContent, {
      path: provenancePath,
      bindings: source.bindings,
      params: source.params ?? null,
      columnFormats: source.columnFormats ?? null,
    });
    if (!result.ok) {
      return { ok: false, error: `viz recipe "${source.recipe}": ${result.error}` };
    }
    (holder.viz as Record<string, unknown>).source = result.source;
    frozen.push(holder.viz as Record<string, unknown>);
  }

  return { ok: true, content: next, frozen };
}
