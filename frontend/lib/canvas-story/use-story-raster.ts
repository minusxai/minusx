'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { renderStoryRaster } from '@/lib/canvas-story/raster';
import { getStoryRenderer, registerFontFaceCss } from '@/lib/canvas-story/renderer.client';
import { STORY_DPR, type StoryRasterResult } from '@/lib/canvas-story/types';
import { sanitizeAgentHtml } from '@/lib/html/sanitize-agent-html';
import { resolveImportFontCss } from '@/lib/html/resolve-story-fonts';

/**
 * Rasterize a story to a bitmap at the measured container width, fluidly.
 *
 * Owns the whole surface lifecycle: container measurement (ResizeObserver), width
 * quantization, sanitization, font resolution/registration, the takumi raster, and
 * bitmap decoding. The FIRST raster is gated on a real measurement so the story
 * renders exactly once at the right width (no nominal-width flash + re-render).
 *
 * Layout runs at the container width quantized UP to 16px steps (resize-thrash
 * guard); `scale` (≤1) shrinks it to fill the container edge-to-edge, matching the
 * fluid DOM path. All returned geometry is in layout px — multiply by `scale` for
 * on-screen px.
 */
export interface StoryRasterState {
  /** Attach to the story's positioning container (measured for fluid width). */
  containerRef: (el: HTMLDivElement | null) => void;
  /** Raster geometry (runs, embeds, dimensions); null until the first render lands. */
  result: StoryRasterResult | null;
  /** The decoded story bitmap; read at draw/capture time. */
  bitmapRef: React.RefObject<ImageBitmap | null>;
  /** True when the pipeline failed — callers flip to the DOM fallback. */
  failed: boolean;
  /** On-screen px per layout px (≤1). */
  scale: number;
}

export function useStoryRaster(html: string, compiledCss: string | null | undefined, nominalWidth: number): StoryRasterState {
  const bitmapRef = useRef<ImageBitmap | null>(null);
  const [result, setResult] = useState<StoryRasterResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const [containerW, setContainerW] = useState<number | null>(null);

  // Measure at commit time (callback ref) so the FIRST raster already uses the real
  // width. Unmeasurable environments (jsdom reports 0) fall back to the nominal width.
  const containerRef = useCallback((el: HTMLDivElement | null) => {
    setContainerEl(el);
    if (el) setContainerW(el.getBoundingClientRect().width || nominalWidth);
  }, [nominalWidth]);

  useEffect(() => {
    if (!containerEl || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w) setContainerW(w);
    });
    ro.observe(containerEl);
    return () => ro.disconnect();
  }, [containerEl]);

  useEffect(() => () => { bitmapRef.current?.close(); bitmapRef.current = null; }, []);

  const layoutWidth = containerW ? Math.ceil(containerW / 16) * 16 : nominalWidth;
  const scale = containerW ? containerW / layoutWidth : 1;

  useEffect(() => {
    if (containerW === null) return; // wait for the measured width — render once, correctly
    let cancelled = false;
    (async () => {
      const renderer = await getStoryRenderer();
      const clean = sanitizeAgentHtml(html);
      const importUrls = [...clean.matchAll(/@import\s+url\((['"]?)([^)'"]+)\1\)/g)].map(m => m[2]);
      const fontCss = importUrls.length ? await resolveImportFontCss(importUrls) : '';
      if (fontCss) await registerFontFaceCss(renderer, fontCss);
      const raster = await renderStoryRaster(renderer, {
        html: clean,
        stylesheets: [compiledCss ?? '', fontCss].filter(Boolean),
        width: layoutWidth,
        dpr: STORY_DPR,
      });
      if (cancelled) return;
      const bitmap = await createImageBitmap(new Blob([raster.png as BlobPart], { type: 'image/png' }));
      if (cancelled) return;
      bitmapRef.current?.close(); // release the previous raster's pixel memory eagerly
      bitmapRef.current = bitmap;
      setResult(raster);
    })().catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [html, compiledCss, layoutWidth, containerW]);

  return { containerRef, result, bitmapRef, failed, scale };
}
