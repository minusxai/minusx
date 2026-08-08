/**
 * Browser validation site for LIVE workspace viz-recipe references: the same
 * dry-run materialization walk as the server save gate
 * (lib/data/helpers/viz-recipe-refs.server.ts), run by the EditFile handler
 * at APPLY time so an unresolvable reference rejects atomically with the
 * available catalog — feedback the agent can act on in-loop. Nothing is
 * rewritten: the reference stays stored as-is, and rendering materializes it
 * (loader-computed on load, client-side for staged edits).
 */
import {
  availableRecipeNames,
  materializeVizRecipeRefsInContent,
  isWorkspaceRecipeSource,
  stripVizRecipeComputedFields,
  type MaterializedRecipeSource,
  type VizRecipeLoaders,
} from '@/lib/viz/recipe-reference-core';
import { readFilesByCriteria } from '@/lib/file-state/file-state';
import type { FileType } from '@/lib/types';
import type { VizRecipeContent } from '@/lib/validation/atlas-schemas';

export type ClientRecipeCheck = { ok: true } | { ok: false; error: string };

/** Loaders over the Redux-loaded file listing (same shape the server injects). */
function reduxLoaders(): { loaders: VizRecipeLoaders } {
  let augmented: Awaited<ReturnType<typeof readFilesByCriteria>> = [];
  const loaders: VizRecipeLoaders = {
    listVizFiles: async () => {
      augmented = await readFilesByCriteria({ criteria: { paths: ['/'], type: 'viz', depth: -1 } });
      return augmented.map((a) => ({
        id: a.fileState.id as number,
        name: a.fileState.name,
        path: a.fileState.path,
      }));
    },
    loadVizContent: async (fileId: number) =>
      (augmented.find((a) => a.fileState.id === fileId)?.fileState.content as VizRecipeContent | undefined) ?? null,
  };
  return { loaders };
}

export async function validateVizRecipeRefsClient(
  type: FileType,
  content: unknown,
  folder: string,
): Promise<ClientRecipeCheck> {
  const { loaders } = reduxLoaders();
  const stripped = stripVizRecipeComputedFields(type, content);
  const materialized = await materializeVizRecipeRefsInContent(type, stripped, folder, loaders) as Record<string, unknown>;
  const holders: Array<Record<string, unknown>> = type === 'question'
    ? [materialized]
    : ((materialized as { cells?: Array<Record<string, unknown>> }).cells ?? []);
  for (const holder of holders) {
    const raw = (holder?.viz as { source?: Record<string, unknown> } | null | undefined)?.source;
    if (!raw || !isWorkspaceRecipeSource(raw)) continue;
    const source = raw as MaterializedRecipeSource;
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
  }
  return { ok: true };
}
