/**
 * Browser-side viz recipe resolution for the render/edit surfaces: which
 * recipes the current file's folder resolves (selector catalog), the
 * definition behind a chart's LIVE reference or frozen provenance (panel
 * rebinding), and client-side materialization of a staged reference the server
 * loader hasn't seen yet. Same shadowing rules as the server
 * (lib/viz/recipe-resolve.ts) over Redux-loaded `.viz` files plus the built-in
 * set.
 */
import { useEffect, useMemo } from 'react';
import { useAppSelector } from '@/store/hooks';
import { selectFilesByCriteria } from '@/lib/store/file-selectors';
import { readFilesByCriteria } from '@/lib/file-state/file-state';
import { resolveVizRecipes } from '@/lib/viz/recipe-resolve';
import { BUILTIN_VIZ_RECIPES } from '@/lib/viz/builtin-recipes';
import { isFileRecipePath, materializeFileRecipe } from '@/lib/viz/recipe-file';
import type { VizEnvelope, VizRecipeContent, VizSourceRecipe } from '@/lib/validation/atlas-schemas';

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

export function useVizRecipes(
  folderPath: string | null | undefined,
  options?: { /** Skip the catalog fetch (still reads whatever Redux already holds). */ enabled?: boolean },
): UseVizRecipesResult {
  const enabled = options?.enabled ?? true;
  // Load every .viz file once (metadata + content into Redux); reactive below.
  useEffect(() => {
    if (!enabled) return;
    readFilesByCriteria({ criteria: { paths: ['/'], type: 'viz', depth: -1 } }).catch(() => {});
  }, [enabled]);

  const vizFiles = useAppSelector(
    (state) => selectFilesByCriteria(state, { type: 'viz' }),
    (a, b) => a.length === b.length && a.every((f, i) => f === b[i]),
  );

  return useMemo(() => {
    const byPath = new Map(vizFiles.map((f) => [f.path, f]));
    const resolvedMap = folderPath
      ? resolveVizRecipes(vizFiles.map((f) => ({ id: f.id as number, name: f.name, path: f.path })), folderPath)
      : null;
    const resolved = resolvedMap
      ? [...resolvedMap.values()]
      : Object.entries(BUILTIN_VIZ_RECIPES).map(([name, content]) => ({ name, source: 'builtin' as const, content }));
    const available = resolved
      .map((r) => r.source === 'builtin'
        ? { name: r.name, description: r.content.description, address: r.name }
        : { name: r.name, description: (byPath.get(r.path)?.content as VizRecipeContent | undefined)?.description ?? '', address: r.path })
      .sort((a, b) => a.name.localeCompare(b.name));
    // A bare name resolves through the folder's shadowing (a LIVE reference may
    // record a bare name); with no folder in hand only built-ins can answer it.
    const contentFor = (address: string): VizRecipeContent | undefined => {
      if (isFileRecipePath(address)) return byPath.get(address)?.content as VizRecipeContent | undefined;
      const r = resolvedMap?.get(address);
      if (r) return r.source === 'builtin' ? r.content : (byPath.get(r.path)?.content as VizRecipeContent | undefined);
      return BUILTIN_VIZ_RECIPES[address];
    };
    return { available, contentFor };
  }, [vizFiles, folderPath]);
}

/** A live workspace-recipe reference (never a shipped `minusx/` id). */
function liveRecipeSource(envelope: VizEnvelope | null | undefined): (VizSourceRecipe & { spec?: unknown; grammar?: string }) | null {
  const source = envelope?.source as (VizSourceRecipe & { spec?: unknown }) | undefined;
  if (!source || (source as { kind?: string }).kind !== 'recipe') return null;
  if (typeof source.recipe !== 'string' || source.recipe.startsWith('minusx/')) return null;
  return source;
}

export type LiveVizEnvelope = {
  /** The envelope to render — computed materialization attached when needed. */
  envelope: VizEnvelope | null;
  /** Set when a live reference cannot materialize — the surface renders a table fallback. */
  unresolved: string | null;
};

/**
 * Render-side materialization of a LIVE workspace-recipe reference. Saved
 * content arrives with the loader's computed `spec` and passes through
 * untouched (identity-stable); a staged reference (an agent edit not yet
 * saved) materializes here from the Redux-loaded catalog. A reference that
 * cannot materialize — recipe deleted, renamed, or bindings incomplete —
 * reports `unresolved`, and the caller degrades to a table instead of an
 * error card.
 */
export function useLiveVizEnvelope(
  envelope: VizEnvelope | null | undefined,
  filePath: string | null | undefined,
): LiveVizEnvelope {
  const source = liveRecipeSource(envelope);
  const needsCatalog = !!source && !source.spec;
  const folderPath = filePath ? (filePath.substring(0, filePath.lastIndexOf('/')) || '/') : null;
  const { contentFor } = useVizRecipes(needsCatalog ? folderPath : null, { enabled: needsCatalog });
  return useMemo(() => {
    if (!envelope) return { envelope: null, unresolved: null };
    if (!source) return { envelope, unresolved: null };
    if (source.spec) return { envelope, unresolved: null };
    const content = contentFor(source.recipe);
    if (!content) return { envelope, unresolved: `recipe "${source.recipe}" not found` };
    const materialized = materializeFileRecipe(content, source.bindings, source.params ?? null);
    if (!materialized.ok) return { envelope, unresolved: materialized.error };
    return {
      envelope: {
        ...envelope,
        source: {
          ...(envelope.source as unknown as Record<string, unknown>),
          spec: materialized.spec,
          grammar: materialized.engine === 'vega' ? 'vega@6' : 'vega-lite@6',
        },
      } as unknown as VizEnvelope,
      unresolved: null,
    };
  }, [envelope, source, contentFor]);
}
