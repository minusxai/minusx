/**
 * Browser-side viz recipe resolution for the edit surfaces: which recipes the
 * current file's folder resolves (selector catalog), and the definition behind
 * a frozen chart's provenance (panel rebinding). Same shadowing rules as the
 * server (lib/viz/recipe-resolve.ts) over Redux-loaded `.viz` files plus the
 * built-in set.
 */
import { useEffect, useMemo } from 'react';
import { useAppSelector } from '@/store/hooks';
import { selectFilesByCriteria } from '@/lib/store/file-selectors';
import { readFilesByCriteria } from '@/lib/file-state/file-state';
import { resolveVizRecipes } from '@/lib/viz/recipe-resolve';
import { BUILTIN_VIZ_RECIPES } from '@/lib/viz/builtin-recipes';
import { isFileRecipePath } from '@/lib/viz/recipe-file';
import type { VizRecipeContent } from '@/lib/validation/atlas-schemas';

export interface AvailableVizRecipe {
  /** Display + reference name (basename / built-in key). */
  name: string;
  description: string;
  /** What a selection/provenance records: the file path, or the bare built-in name. */
  address: string;
}

export interface UseVizRecipesResult {
  /** The folder's resolved catalog, name-sorted. */
  available: AvailableVizRecipe[];
  /** The definition behind an address (frozen provenance or a selection). */
  contentFor(address: string): VizRecipeContent | undefined;
}

export function useVizRecipes(folderPath: string | null | undefined): UseVizRecipesResult {
  // Load every .viz file once (metadata + content into Redux); reactive below.
  useEffect(() => {
    readFilesByCriteria({ criteria: { paths: ['/'], type: 'viz', depth: -1 } }).catch(() => {});
  }, []);

  const vizFiles = useAppSelector(
    (state) => selectFilesByCriteria(state, { type: 'viz' }),
    (a, b) => a.length === b.length && a.every((f, i) => f === b[i]),
  );

  return useMemo(() => {
    const byPath = new Map(vizFiles.map((f) => [f.path, f]));
    const resolved = folderPath
      ? [...resolveVizRecipes(vizFiles.map((f) => ({ id: f.id as number, name: f.name, path: f.path })), folderPath).values()]
      : Object.entries(BUILTIN_VIZ_RECIPES).map(([name, content]) => ({ name, source: 'builtin' as const, content }));
    const available = resolved
      .map((r) => r.source === 'builtin'
        ? { name: r.name, description: r.content.description, address: r.name }
        : { name: r.name, description: (byPath.get(r.path)?.content as VizRecipeContent | undefined)?.description ?? '', address: r.path })
      .sort((a, b) => a.name.localeCompare(b.name));
    const contentFor = (address: string): VizRecipeContent | undefined =>
      isFileRecipePath(address)
        ? (byPath.get(address)?.content as VizRecipeContent | undefined)
        : BUILTIN_VIZ_RECIPES[address];
    return { available, contentFor };
  }, [vizFiles, folderPath]);
}
