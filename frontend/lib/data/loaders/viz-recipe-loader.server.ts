/**
 * Read-time materialization of LIVE workspace-recipe references (question and
 * notebook loader). Attaches computed `spec`/`grammar` to every recipe source —
 * or `unresolved` when the recipe is gone, which the UI renders as a table
 * fallback — so recipe edits propagate to every referencing chart on its next
 * load and storage stays reference-only (the save gate strips these fields).
 *
 * Resolution is SYSTEM-scoped through DocumentDB, deliberately not the loading
 * user's listing permissions: whoever may see the chart sees it rendered —
 * share guests and restricted viewers included — exactly as a stored spec
 * would have behaved. Drafts never resolve (an unsaved recipe is not
 * published vocabulary).
 */
import { DocumentDB } from '@/lib/database/documents-db';
import { materializeVizRecipeRefsInContent } from '@/lib/viz/recipe-reference-core';
import type { VizRecipeContent } from '@/lib/validation/atlas-schemas';
import type { CustomLoader } from './types';

export const vizRecipeLoader: CustomLoader = async (file, _user, options) => {
  if (!file.content || options?.skipEnrichment) return file;
  if (file.type !== 'question' && file.type !== 'notebook') return file;

  const folder = file.path.substring(0, file.path.lastIndexOf('/')) || '/';
  const content = await materializeVizRecipeRefsInContent(file.type, file.content, folder, {
    listVizFiles: async () => {
      const rows = await DocumentDB.listAll('viz', undefined, undefined, false);
      return rows
        .filter((r) => !r.draft)
        .map((r) => ({ id: r.id, name: r.name, path: r.path }));
    },
    loadVizContent: async (fileId: number) => {
      const row = await DocumentDB.getById(fileId);
      return (row?.content as VizRecipeContent | undefined) ?? null;
    },
  });
  return { ...file, content: content as typeof file.content };
};
