'use client';

import { useEffect } from 'react';
import type { StoryEmbedBox } from '@/lib/canvas-story/types';
import { immutableSet } from '@/lib/utils/immutable-collections';

/**
 * WYSIWYG feedback for inline islands (inline numbers, param controls): their real
 * size is unknowable until the live component mounts and its data loads, so the
 * raster first reserves a default box. Once the island settles, its content is
 * measured and reported (in layout px); the caller re-rasters with the override so
 * the surrounding text reflows around the TRUE size — like the DOM's in-flow spans.
 *
 * Settle-timer driven (no observers — see use-story-capture for why), tolerance-
 * gated so the measure → re-raster → measure cycle converges after one pass.
 */
const INLINE_KINDS = immutableSet(['number-inline', 'param']);
const TOLERANCE_PX = 2;

export function useIslandMeasurement(
  embeds: StoryEmbedBox[],
  islandEls: Record<number, HTMLElement | null>,
  scale: number,
  current: Record<number, { width: number; height: number }> | undefined,
  onChange: (sizes: Record<number, { width: number; height: number }>) => void,
): void {
  useEffect(() => {
    const inline = embeds.filter(e => INLINE_KINDS.has(e.kind));
    if (!inline.length) return;
    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      const next = { ...(current ?? {}) };
      let changed = false;
      for (const e of inline) {
        const child = islandEls[e.index]?.firstElementChild;
        if (!child) continue;
        const rect = child.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        const w = Math.ceil(rect.width / scale);
        const h = Math.ceil(rect.height / scale);
        if (Math.abs(w - e.w) > TOLERANCE_PX || Math.abs(h - e.h) > TOLERANCE_PX) {
          next[e.index] = { width: w, height: h };
          changed = true;
        }
      }
      if (changed) onChange(next);
    };
    const t1 = setTimeout(measure, 1200); // after data lands
    const t2 = setTimeout(measure, 5000); // slow queries
    return () => { cancelled = true; clearTimeout(t1); clearTimeout(t2); };
  }, [embeds, islandEls, scale, current, onChange]);
}
