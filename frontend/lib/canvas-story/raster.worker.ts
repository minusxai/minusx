/**
 * Story raster Web Worker: takumi layout + paint runs HERE, off the main thread —
 * the initial raster of a long story (hundreds of ms; seconds on old hardware)
 * no longer blocks scrolling/input. The worker owns its own wasm renderer and
 * font registrations; the PNG buffer transfers back zero-copy.
 */
import { createRenderer, registerFontFaceCssCore } from '@/lib/canvas-story/renderer-core';
import { renderStoryRaster } from '@/lib/canvas-story/raster';
import type { StoryRasterInput, StoryRendererEngine } from '@/lib/canvas-story/types';

interface RasterRequest {
  id: number;
  input: StoryRasterInput;
  fontCss?: string;
}

let rendererPromise: Promise<StoryRendererEngine> | null = null;
// eslint-disable-next-line no-restricted-syntax -- worker-scoped module: one instance per Worker, never shared across requests
const registeredFonts = new Set<string>();

function getRenderer(): Promise<StoryRendererEngine> {
  if (!rendererPromise) rendererPromise = createRenderer();
  return rendererPromise;
}

self.onmessage = async (e: MessageEvent<RasterRequest>) => {
  const { id, input, fontCss } = e.data;
  try {
    const renderer = await getRenderer();
    if (fontCss) await registerFontFaceCssCore(renderer, fontCss, registeredFonts);
    const result = await renderStoryRaster(renderer, input);
    (self as unknown as Worker).postMessage({ id, ok: true, result }, [result.png.buffer as ArrayBuffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: String(err) });
  }
};
