/**
 * Recipe resolution: which viz recipes are available in a folder, and which file
 * wins when names collide. Pure path math over a file listing — no I/O.
 *
 * Resolution order (weakest to strongest): built-in defaults (`BUILTIN_VIZ_RECIPES`,
 * app data, present everywhere) < root-folder files < … < the folder itself. A file
 * shadows anything weaker with the same NAME (the file's basename — identity has no
 * other source). Sibling folders never see each other's recipes, and a parent never
 * sees a child's: only ancestors-or-self contribute.
 *
 * Charts store LIVE references, so resolution runs at every materialization — moving,
 * renaming or deleting a recipe file changes what future charts resolve, never what
 * saved charts render.
 */
import type { VizRecipeContent } from '@/lib/validation/atlas-schemas';
import { BUILTIN_VIZ_RECIPES } from './builtin-recipes';

/** The slice of file metadata resolution needs (FilesAPI getFiles rows carry more). */
export interface VizRecipeFileMeta {
  id: number;
  name: string;
  path: string;
}

/** Where a resolved recipe comes from: a workspace file, or the built-in set. */
export type ResolvedVizRecipe =
  | { name: string; source: 'file'; path: string; fileId: number }
  | { name: string; source: 'builtin'; content: VizRecipeContent };

/**
 * Resolve the recipe set visible from `folder`: every built-in plus every `.viz`
 * file in an ancestor-or-self folder, nearest folder winning per name.
 */
export function resolveVizRecipes(
  files: VizRecipeFileMeta[],
  folder: string,
): Map<string, ResolvedVizRecipe> {
  const target = folder.length > 1 && folder.endsWith('/') ? folder.slice(0, -1) : folder;
  const resolved = new Map<string, ResolvedVizRecipe>();
  for (const [name, content] of Object.entries(BUILTIN_VIZ_RECIPES)) {
    resolved.set(name, { name, source: 'builtin', content });
  }
  // Specificity = the owning folder's depth; a nearer (deeper) ancestor wins.
  // Built-ins sit below every file, so any ancestor-or-self file replaces one.
  const specificity = new Map<string, number>();
  for (const file of files) {
    const dir = file.path.substring(0, file.path.lastIndexOf('/')) || '/';
    const isAncestorOrSelf = dir === target || (target.startsWith(dir === '/' ? '/' : dir + '/'));
    if (!isAncestorOrSelf) continue;
    const depth = dir.split('/').filter(Boolean).length;
    const prev = specificity.get(file.name);
    if (prev !== undefined && prev >= depth) continue;
    specificity.set(file.name, depth);
    resolved.set(file.name, { name: file.name, source: 'file', path: file.path, fileId: file.id });
  }
  return resolved;
}

/** Resolve one recipe by name from `folder` (undefined when nothing resolves). */
export function resolveVizRecipe(
  files: VizRecipeFileMeta[],
  folder: string,
  name: string,
): ResolvedVizRecipe | undefined {
  return resolveVizRecipes(files, folder).get(name);
}
