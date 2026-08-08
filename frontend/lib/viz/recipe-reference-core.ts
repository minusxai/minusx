/**
 * The LIVE-reference materialization walk over a file's viz envelopes, shared
 * by the read-time loader (lib/data/loaders/viz-recipe-loader.server.ts), the
 * server save gate (lib/data/helpers/viz-recipe-refs.server.ts, which adds
 * full envelope validation) and the browser tool handlers
 * (lib/tools/handlers/viz-recipe-refs-client.ts, the apply-time validation).
 * Client-safe: no validate.ts import — the heavyweight grammar check stays
 * server-side.
 *
 * A `viz` envelope may reference a recipe three ways:
 *  - a shipped registry id (`minusx/funnel@1`) — rendered from the code
 *    registry, never touched here;
 *  - an absolute `.viz` file path (`/org/bullet`);
 *  - a bare name (`bullet`), resolved against the file's folder with
 *    nearest-ancestor-wins shadowing over workspace files and built-ins.
 */
import { isFileRecipePath, materializeFileRecipe } from './recipe-file';
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

/** The envelope slots a file type carries: question → content.viz, notebook → each cell. */
function envelopeHolders(type: FileType, content: Record<string, unknown>): Array<Record<string, unknown>> {
  if (type === 'question') return [content];
  if (type === 'notebook' && Array.isArray(content.cells)) {
    return (content.cells as Array<Record<string, unknown>>).filter((c) => c && typeof c === 'object');
  }
  return [];
}

/** A LIVE workspace-recipe source: any recipe id outside the shipped `minusx/` namespace. */
export function isWorkspaceRecipeSource(source: unknown): source is VizSourceRecipe {
  if (!source || typeof source !== 'object') return false;
  const s = source as { kind?: unknown; recipe?: unknown };
  return s.kind === 'recipe' && typeof s.recipe === 'string' && !getTemplate(s.recipe) && !s.recipe.startsWith('minusx/');
}

/** The names resolvable from `folder` (workspace files + built-ins + shipped ids). */
export function availableRecipeNames(files: VizRecipeFileMeta[], folder: string): string[] {
  return [...resolveVizRecipes(files, folder).keys(), ...Object.keys(VIZ_TEMPLATES)];
}

/** Read-time computed fields a loader attaches to a recipe SOURCE — never persisted. */
export const RECIPE_COMPUTED_FIELDS = ['spec', 'grammar', 'unresolved'] as const;

/** A recipe source as materialization leaves it: the reference plus the computed fields. */
export type MaterializedRecipeSource = VizSourceRecipe & {
  spec?: Record<string, unknown>;
  grammar?: 'vega-lite@6' | 'vega@6';
  unresolved?: string;
};

/**
 * Strip the loader-computed materialization off every recipe source so storage
 * stays reference-only. Clone-on-write; returns the input when nothing matched.
 */
export function stripVizRecipeComputedFields(type: FileType, content: unknown): unknown {
  if (!content || typeof content !== 'object') return content;
  const holders = envelopeHolders(type, content as Record<string, unknown>);
  const touched = holders.some((h) => {
    const source = (h.viz as { source?: Record<string, unknown> } | null | undefined)?.source;
    return source?.kind === 'recipe' && RECIPE_COMPUTED_FIELDS.some((f) => f in source);
  });
  if (!touched) return content;
  const next = JSON.parse(JSON.stringify(content)) as Record<string, unknown>;
  for (const holder of envelopeHolders(type, next)) {
    const source = (holder.viz as { source?: Record<string, unknown> } | null | undefined)?.source;
    if (source?.kind !== 'recipe') continue;
    for (const field of RECIPE_COMPUTED_FIELDS) delete source[field];
  }
  return next;
}

/**
 * READ-TIME materialization: attach the substituted spec to every workspace
 * recipe reference as computed fields (`spec`, `grammar`), or mark it
 * `unresolved` when the recipe no longer exists / fails to materialize — the
 * UI renders a table fallback and the stored reference survives. Never throws:
 * a broken recipe must not make its charts unloadable.
 */
export async function materializeVizRecipeRefsInContent(
  type: FileType,
  content: unknown,
  folder: string,
  loaders: VizRecipeLoaders,
): Promise<unknown> {
  if (!content || typeof content !== 'object') return content;
  if (type !== 'question' && type !== 'notebook') return content;
  const wanting = envelopeHolders(type, content as Record<string, unknown>).filter((h) => {
    const viz = h.viz as { source?: unknown } | null | undefined;
    return viz && typeof viz === 'object' && isWorkspaceRecipeSource(viz.source);
  });
  if (wanting.length === 0) return content;

  let files: VizRecipeFileMeta[];
  try {
    files = await loaders.listVizFiles();
  } catch {
    return content; // resolution unavailable — leave references bare (UI falls back)
  }
  const next = JSON.parse(JSON.stringify(content)) as Record<string, unknown>;
  for (const holder of envelopeHolders(type, next)) {
    const viz = holder.viz as { source?: unknown } | null | undefined;
    if (!viz || typeof viz !== 'object' || !isWorkspaceRecipeSource(viz.source)) continue;
    const source = viz.source as VizSourceRecipe & Record<string, unknown>;

    let recipeContent: VizRecipeContent | null = null;
    if (isFileRecipePath(source.recipe)) {
      const file = files.find((f) => f.path === source.recipe);
      if (file) recipeContent = await loaders.loadVizContent(file.id).catch(() => null);
    } else {
      const resolved = resolveVizRecipes(files, folder).get(source.recipe);
      if (resolved?.source === 'builtin') recipeContent = resolved.content;
      else if (resolved) recipeContent = await loaders.loadVizContent(resolved.fileId).catch(() => null);
    }
    if (!recipeContent) {
      source.unresolved = 'not-found';
      continue;
    }
    const materialized = materializeFileRecipe(recipeContent, source.bindings, source.params ?? null);
    if (!materialized.ok) {
      source.unresolved = materialized.error;
      continue;
    }
    source.spec = materialized.spec;
    source.grammar = materialized.engine === 'vega' ? 'vega@6' : 'vega-lite@6';
  }
  return next;
}
