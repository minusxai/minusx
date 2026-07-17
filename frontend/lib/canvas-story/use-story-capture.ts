'use client';

import { useEffect, useRef } from 'react';
import { snapdom } from '@zumer/snapdom';
import { registerCanvasStoryCapture } from '@/lib/canvas-story/capture-registry';
import { STORY_DPR, type StoryRasterResult } from '@/lib/canvas-story/types';

/**
 * Snapdom-free captures for canvas stories.
 *
 * Islands are live DOM (charts, params) — the one part the raster can't cover. They
 * are rasterized AT IDLE into a bitmap cache, sequentially with yields, on settle
 * timers rather than mutation observers (charts animate constantly; observing them
 * re-triggers serialization in a loop and locks the main thread). Capture time is
 * then pure canvas composition: the registered provider draws any story region
 * straight from the source bitmaps (story raster + island caches) into the caller's
 * context — no snapdom and no full-story intermediate canvas on the capture path.
 */
export function useStoryCapture(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  bitmapRef: React.RefObject<ImageBitmap | null>,
  result: StoryRasterResult | null,
  islandEls: Record<number, HTMLElement | null>,
): void {
  const islandBitmapsRef = useRef<Record<number, ImageBitmap>>({});
  const rasterizeGenRef = useRef(0);

  useEffect(() => () => {
    for (const b of Object.values(islandBitmapsRef.current)) b.close();
    islandBitmapsRef.current = {};
  }, []);

  useEffect(() => {
    const gen = ++rasterizeGenRef.current;
    const els = Object.entries(islandEls).filter((entry): entry is [string, HTMLElement] => !!entry[1]);
    if (!els.length) return;
    let cancelled = false;
    const pass = async () => {
      for (const [key, el] of els) {
        if (cancelled || rasterizeGenRef.current !== gen) return;
        // Never cache an island that is still loading — a spinner frozen into the
        // bitmap would appear in every capture until the next pass (or forever,
        // after the last one). Skipped islands keep their previous bitmap, or fall
        // back to the raster-only region until a later pass catches them settled.
        if (el.querySelector('.chakra-spinner, [aria-busy="true"]')) continue;
        try {
          // embedFonts: island text uses document-level webfonts (next/font Inter,
          // JetBrains Mono) — without embedding, snapdom's clone can't resolve the
          // families and captured charts fall back to the UA serif.
          const c = await snapdom.toCanvas(el, { scale: STORY_DPR, dpr: 1, embedFonts: true });
          const bitmap = await createImageBitmap(c);
          islandBitmapsRef.current[Number(key)]?.close(); // release the stale bitmap
          islandBitmapsRef.current[Number(key)] = bitmap;
        } catch { /* capture falls back to raster-only for this island */ }
        await new Promise(r => setTimeout(r, 32)); // yield between islands
      }
    };
    // Backoff schedule: early pass for cached-fast charts, later passes for slow
    // queries — the spinner guard above makes extra passes cheap no-ops once settled.
    const timers = [1500, 6000, 15000, 30000].map(ms => setTimeout(() => { void pass(); }, ms));
    return () => { cancelled = true; timers.forEach(clearTimeout); };
  }, [islandEls]);

  useEffect(() => {
    return registerCanvasStoryCapture({
      surface: () => canvasRef.current,
      size: () => {
        const bitmap = bitmapRef.current;
        return bitmap ? { width: bitmap.width, height: bitmap.height } : null;
      },
      drawRegion: (ctx, sx, sy, sw, sh, dx, dy, dw, dh) => {
        const bitmap = bitmapRef.current;
        if (!bitmap || !result) return false;
        const kx = dw / sw;
        const ky = dh / sh;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(dx, dy, dw, dh);
        ctx.drawImage(bitmap, sx, sy, sw, sh, dx, dy, dw, dh);
        for (const e of result.embeds) {
          const cached = islandBitmapsRef.current[e.index];
          if (!cached) continue;
          const ix = e.x * STORY_DPR, iy = e.y * STORY_DPR, iw = e.w * STORY_DPR, ih = e.h * STORY_DPR;
          const ox0 = Math.max(sx, ix), oy0 = Math.max(sy, iy);
          const ox1 = Math.min(sx + sw, ix + iw), oy1 = Math.min(sy + sh, iy + ih);
          if (ox1 <= ox0 || oy1 <= oy0) continue;
          const bx = cached.width / iw, by = cached.height / ih;
          ctx.drawImage(
            cached,
            (ox0 - ix) * bx, (oy0 - iy) * by, (ox1 - ox0) * bx, (oy1 - oy0) * by,
            dx + (ox0 - sx) * kx, dy + (oy0 - sy) * ky, (ox1 - ox0) * kx, (oy1 - oy0) * ky,
          );
        }
        return true;
      },
    });
  }, [canvasRef, bitmapRef, result]);
}
