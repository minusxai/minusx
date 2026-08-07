/**
 * Server freeze site: the freeze-at-use walk (lib/viz/recipe-freeze-core.ts)
 * plus the full envelope validation the client cannot run (the Vega-Lite
 * package schema stays out of the browser bundle). Called from
 * FilesAPI.createFile/saveFile for question and notebook content, with loaders
 * injected so this module never imports files.server.
 *
 * Column kinds are not known at save (no query runs here), so `{{slot:kind}}`
 * falls back to each slot's first `accepts` kind; the viz panel re-freezes with
 * real columns on any rebind. The browser tool handlers freeze the same way at
 * edit-apply time (viz-recipe-freeze-client.ts), so a save normally receives an
 * already-frozen source and this runs as the backstop for headless writers.
 */
import {
  freezeVizRecipesInContentCore,
  type VizRecipeLoaders,
} from '@/lib/viz/recipe-freeze-core';
import { validateVizEnvelope } from '@/lib/viz/validate';
import { formatVizIssues } from '@/lib/viz/types';
import type { FileType } from '@/lib/types';

export type { VizRecipeLoaders };

export type FreezeContentResult =
  | { ok: true; content: unknown }
  | { ok: false; error: string };

export async function freezeVizRecipesInContent(
  type: FileType,
  content: unknown,
  folder: string,
  loaders: VizRecipeLoaders,
): Promise<FreezeContentResult> {
  const result = await freezeVizRecipesInContentCore(type, content, folder, loaders);
  if (!result.ok) return result;
  // Full envelope validation on each substituted spec (data policy + grammar).
  // No columns here, so field checks skip — the panel/tools validate those with
  // the real result before save.
  for (const viz of result.frozen) {
    const validated = validateVizEnvelope(viz, undefined);
    if (!validated.ok) {
      return { ok: false, error: `viz recipe materialized an invalid spec: ${formatVizIssues(validated.issues)}` };
    }
  }
  return { ok: true, content: result.content };
}
