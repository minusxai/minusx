/**
 * DetachViz — the agent-side detach (RFC §21.10). Converts a question's RECIPE chart
 * into its materialized, fully-editable spec (kind:'vega' | 'vega-lite') in Redux, then
 * returns the file's CURRENT markup so the agent can EditFile the spec. The original
 * recipe is kept in `detachedFrom` (reversible). The heavy lifting is the pure
 * `detachRecipe`; this is the Redux/file-state bridge around it.
 */
import { getStore } from '@/store/store';
import { selectMergedContent } from '@/store/filesSlice';
import { editFile as editFileOp, buildCurrentFileStr } from '@/lib/file-state/file-state';
import { detachRecipe } from '@/lib/viz/detach';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';
import type { FrontendToolHandler } from './types';

const fail = (error: string) => ({ content: { success: false, error }, details: { success: false, error } });

export const detachVizHandler: FrontendToolHandler = async (args) => {
  const { fileId } = args;
  const state = getStore().getState();
  const fileState = state.files.files[fileId];
  if (fileState?.type !== 'question') return fail('DetachViz only works on question files.');

  const content = selectMergedContent(state, fileId) as { viz?: VizEnvelope } | undefined;
  const viz = content?.viz;
  if (!viz) return fail('This question has no V2 viz envelope to detach.');

  const kind = (viz.source as unknown as { kind?: string })?.kind;
  if (kind !== 'recipe') {
    // Already a raw spec (or hand-authored) — nothing to detach; hand back the markup so
    // the agent can edit source.spec directly.
    const built = buildCurrentFileStr(state, fileId);
    return {
      content: {
        success: true,
        message: `Viz is already a raw ${kind ?? 'unknown'} spec (not a recipe) — edit source.spec directly with EditFile.`,
        ...(built.success ? { currentMarkup: built.fullFileStr } : {}),
      },
      details: { success: true },
    };
  }

  let detached: VizEnvelope;
  try {
    detached = detachRecipe(viz);
  } catch (e) {
    return fail(`Detach failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  await editFileOp({ fileId, changes: { content: { viz: detached } } });

  const specKind = (detached.source as unknown as { kind: string }).kind;
  const built = buildCurrentFileStr(getStore().getState(), fileId);
  const message =
    `Chart detached to an editable kind:'${specKind}' spec (now a Custom viz). ` +
    `Edit source.spec with EditFile to customize anything the recipe params couldn't. ` +
    `Build your EditFile oldMatch from the currentMarkup below (the app-state markup is now stale). ` +
    `The original recipe is kept in detachedFrom, so this is reversible.`;
  return {
    content: {
      success: true,
      message,
      ...(built.success ? { currentMarkup: built.fullFileStr } : {}),
    },
    details: { success: true },
  };
};
