'use client';

/**
 * Main-thread client for the raster worker. `rasterStory` prefers the worker
 * (keeps takumi's layout+paint off the main thread); any worker failure —
 * bundler quirks, wasm-in-worker restrictions, test environments — falls back
 * to the in-page renderer permanently for the session, with the same result.
 */
import { getStoryRenderer, registerFontFaceCss } from '@/lib/canvas-story/renderer.client';
import { renderStoryRaster } from '@/lib/canvas-story/raster';
import type { StoryRasterInput, StoryRasterResult } from '@/lib/canvas-story/types';

let worker: Worker | null = null;
let workerBroken = false;
let seq = 0;
// eslint-disable-next-line no-restricted-syntax -- client-only module ('use client'): per-tab in-flight request table
const pending = new Map<number, { resolve: (r: StoryRasterResult) => void; reject: (e: unknown) => void }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./raster.worker.ts', import.meta.url));
    worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; result?: StoryRasterResult; error?: string }>) => {
      const entry = pending.get(e.data.id);
      if (!entry) return;
      pending.delete(e.data.id);
      if (e.data.ok && e.data.result) entry.resolve(e.data.result);
      else entry.reject(new Error(e.data.error ?? 'worker raster failed'));
    };
    worker.onerror = (e) => {
      for (const entry of pending.values()) entry.reject(e.error ?? new Error(e.message || 'worker error'));
      pending.clear();
    };
  }
  return worker;
}

function viaWorker(input: StoryRasterInput, fontCss?: string): Promise<StoryRasterResult> {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, input, fontCss });
  });
}

/** Raster a story — in the worker when possible, on the main thread otherwise. */
export async function rasterStory(input: StoryRasterInput, fontCss?: string): Promise<StoryRasterResult> {
  if (!workerBroken && typeof Worker !== 'undefined') {
    try {
      return await viaWorker(input, fontCss);
    } catch (err) {
      workerBroken = true;
      console.warn('[canvas-story] worker raster unavailable — using main thread:', err);
    }
  }
  const renderer = await getStoryRenderer();
  if (fontCss) await registerFontFaceCss(renderer, fontCss);
  return renderStoryRaster(renderer, input);
}
