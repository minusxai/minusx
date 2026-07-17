'use client';

import { useEffect, useRef } from 'react';
import { registerCanvasStoryCapture } from '@/lib/canvas-story/capture-registry';
import { rasterizeIslandChrome, type IslandCanvasBox } from '@/lib/canvas-story/island-raster';
import { STORY_DPR, type StoryRasterResult } from '@/lib/canvas-story/types';

/**
 * Snapdom-free captures for canvas stories — images come straight from canvases.
 *
 * The story surface is already a bitmap. Islands contribute two kinds of pixels:
 *  - charts: vega draws with its CANVAS renderer inside canvas stories
 *    (canvas-render-context), so capture reads the live chart <canvas> directly;
 *  - HTML chrome (card, title, single-value text): rasterized LAZILY at capture
 *    time through takumi (island-raster.ts) and cached until the island changes.
 *
 * `prepare()` builds the pending chrome rasters (async, capture-time only);
 * `drawRegion()` then composites synchronously: story bitmap → island chrome →
 * live chart canvases. Nothing here serializes the DOM to images.
 */

interface ChromeEntry {
  chrome: ImageBitmap;
  canvases: IslandCanvasBox[];
  width: number;
  height: number;
}

export function useStoryCapture(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  bitmapRef: React.RefObject<ImageBitmap | null>,
  result: StoryRasterResult | null,
  islandEls: Record<number, HTMLElement | null>,
): void {
  const chromeCache = useRef<Map<number, ChromeEntry>>(new Map());

  // Chrome rasters go stale whenever the islands or layout change; rebuild lazily.
  useEffect(() => {
    const cache = chromeCache.current;
    for (const e of cache.values()) e.chrome.close();
    cache.clear();
  }, [islandEls, result]);

  useEffect(() => () => {
    for (const e of chromeCache.current.values()) e.chrome.close();
    chromeCache.current.clear();
  }, []);

  useEffect(() => {
    return registerCanvasStoryCapture({
      surface: () => canvasRef.current,
      size: () => {
        const bitmap = bitmapRef.current;
        return bitmap ? { width: bitmap.width, height: bitmap.height } : null;
      },
      prepare: async () => {
        for (const [key, el] of Object.entries(islandEls)) {
          const idx = Number(key);
          if (!el || chromeCache.current.has(idx)) continue;
          try {
            chromeCache.current.set(idx, await rasterizeIslandChrome(el));
          } catch { /* island contributes live canvases only */ }
        }
      },
      drawRegion: (ctx, sx, sy, sw, sh, dx, dy, dw, dh) => {
        const bitmap = bitmapRef.current;
        if (!bitmap || !result) return false;
        const kx = dw / sw;
        const ky = dh / sh;
        // Map a story-space device-px rect to the destination and draw via cb.
        const place = (x: number, y: number, w: number, h: number) =>
          [dx + (x - sx) * kx, dy + (y - sy) * ky, w * kx, h * ky] as const;

        ctx.save();
        ctx.beginPath();
        ctx.rect(dx, dy, dw, dh);
        ctx.clip();

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(dx, dy, dw, dh);
        ctx.drawImage(bitmap, sx, sy, sw, sh, dx, dy, dw, dh);

        for (const e of result.embeds) {
          const host = islandEls[e.index];
          const ix = e.x * STORY_DPR, iy = e.y * STORY_DPR, iw = e.w * STORY_DPR, ih = e.h * STORY_DPR;
          if (ix + iw < sx || ix > sx + sw || iy + ih < sy || iy > sy + sh) continue;

          const entry = chromeCache.current.get(e.index);
          if (entry) {
            ctx.drawImage(entry.chrome, ...place(ix, iy, entry.width * STORY_DPR, entry.height * STORY_DPR));
          }
          // Live chart pixels, straight off each chart's own canvas. Positions come
          // from the prepared entry when available, else read synchronously now.
          const boxes: IslandCanvasBox[] = entry?.canvases ?? (host
            ? [...host.querySelectorAll('canvas')].map(c => {
                const hr = host.getBoundingClientRect();
                const cr = c.getBoundingClientRect();
                return { el: c, x: cr.left - hr.left, y: cr.top - hr.top, w: cr.width, h: cr.height };
              })
            : []);
          for (const b of boxes) {
            if (!b.el.isConnected || b.el.width === 0) continue;
            ctx.drawImage(b.el, ...place(ix + b.x * STORY_DPR, iy + b.y * STORY_DPR, b.w * STORY_DPR, b.h * STORY_DPR));
          }
        }

        ctx.restore();
        return true;
      },
    });
  }, [canvasRef, bitmapRef, result, islandEls]);
}
