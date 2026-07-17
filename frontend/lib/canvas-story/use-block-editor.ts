'use client';

import { useCallback, useMemo, useState } from 'react';
import { getBlockContext, replaceBlockHtml, type BlockAncestor, type BlockRef } from '@/lib/canvas-story/edit-blocks';
import type { StoryBlockBox, StoryRasterResult } from '@/lib/canvas-story/types';

/**
 * Canvas text editing: click a text block on the raster → an overlay contenteditable
 * opens over its box (see BlockEditorOverlay in CanvasStoryView); committing maps the
 * edit back into the story HTML (edit-blocks.ts) and emits the updated source — the
 * same `onStoryChange` contract the DOM path's contentEditable uses. The raster then
 * re-renders from the new source, so the surface stays WYSIWYG.
 */

export interface ActiveBlockEdit {
  ref: BlockRef;
  box: StoryBlockBox;
  /** The block's current outerHTML — the editor seed. */
  html: string;
  /** Ancestor chain (outermost first) — rebuilt in the overlay for cascade context. */
  ancestors: BlockAncestor[];
}

export interface BlockEditor {
  active: ActiveBlockEdit | null;
  /** Hit-test (layout px) and open the editor for the smallest block at the point. */
  openAt: (x: number, y: number) => boolean;
  commit: (newOuterHtml: string) => void;
  cancel: () => void;
}

export function useBlockEditor(
  enabled: boolean,
  result: StoryRasterResult | null,
  storyHtml: string,
  onStoryChange: ((html: string) => void) | undefined,
): BlockEditor {
  const [active, setActive] = useState<ActiveBlockEdit | null>(null);

  // Committing one block re-rasters the story; blocks BELOW the edit may shift. The
  // exposed active edit derives its box from the CURRENT raster geometry (matched by
  // ref) so an open overlay tracks the block's new position; the seed box is the
  // fallback when the ref no longer matches (e.g. the open block itself was edited).
  const liveActive = useMemo(() => {
    if (!active || !result) return active;
    const match = result.blocks.find(
      b => b.tag === active.ref.tag && b.text === active.ref.text && b.occurrence === active.ref.occurrence,
    );
    return match ? { ...active, box: match } : active;
  }, [active, result]);

  const openAt = useCallback((x: number, y: number): boolean => {
    if (!enabled || !result) return false;
    const hit = result.blocks
      .filter(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h)
      .sort((a, b) => a.w * a.h - b.w * b.h)[0];
    if (!hit) return false;
    const ref: BlockRef = { tag: hit.tag, text: hit.text, occurrence: hit.occurrence };
    const ctx = getBlockContext(storyHtml, ref);
    if (!ctx) return false;
    setActive({ ref, box: hit, html: ctx.html, ancestors: ctx.ancestors });
    return true;
  }, [enabled, result, storyHtml]);

  const commit = useCallback((newOuterHtml: string) => {
    setActive(current => {
      // An untouched block commits nothing: the doc round-trip normalizes markup,
      // so even a no-op edit would otherwise register as an unsaved change.
      if (current && newOuterHtml !== current.html) {
        const updated = replaceBlockHtml(storyHtml, current.ref, newOuterHtml);
        if (updated !== null && updated !== storyHtml) onStoryChange?.(updated);
      }
      return null;
    });
  }, [storyHtml, onStoryChange]);

  const cancel = useCallback(() => setActive(null), []);

  return { active: liveActive, openAt, commit, cancel };
}
