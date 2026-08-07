/**
 * Browser freeze site for workspace viz-recipe references: the same
 * freeze-at-use walk as the server save path (lib/viz/recipe-freeze-core.ts),
 * run by the EditFile handler at APPLY time. Freezing before the edit stages
 * means the chart renders immediately (the renderer never resolves files) and
 * an unresolvable reference rejects atomically with the available catalog —
 * feedback the agent can act on in-loop. The server freeze remains the backstop
 * for headless writers.
 */
import { freezeVizRecipesInContentCore, type FreezeContentResult } from '@/lib/viz/recipe-freeze-core';
import { readFilesByCriteria } from '@/lib/file-state/file-state';
import type { FileType } from '@/lib/types';
import type { VizRecipeContent } from '@/lib/validation/atlas-schemas';

export type { FreezeContentResult };

export async function freezeVizRecipesClient(
  type: FileType,
  content: unknown,
  folder: string,
): Promise<FreezeContentResult> {
  let augmented: Awaited<ReturnType<typeof readFilesByCriteria>> = [];
  return freezeVizRecipesInContentCore(type, content, folder, {
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
  });
}
