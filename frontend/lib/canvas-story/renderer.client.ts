'use client';

/**
 * Main-thread takumi renderer singleton (construction shared with the raster
 * worker via renderer-core.ts). Used as the worker-unavailable fallback and by
 * capture-time island chrome rasterization.
 */
import { createRenderer, registerFontFaceCssCore } from '@/lib/canvas-story/renderer-core';
import { StoryRendererEngine } from '@/lib/canvas-story/types';

let rendererPromise: Promise<StoryRendererEngine> | null = null;

export function getStoryRenderer(): Promise<StoryRendererEngine> {
  if (!rendererPromise) rendererPromise = createRenderer();
  return rendererPromise;
}

// eslint-disable-next-line no-restricted-syntax -- client-only module ('use client'): per-browser-tab font dedup cache, never runs server-side
const registeredFontUrls = new Set<string>();

/** Register story-declared fonts (see renderer-core.registerFontFaceCssCore). */
export async function registerFontFaceCss(renderer: StoryRendererEngine, fontCss: string): Promise<void> {
  return registerFontFaceCssCore(renderer, fontCss, registeredFontUrls);
}
