import { buildStoryNodeTree } from '@/lib/canvas-story/node-tree';
import { resolveContainerQueries } from '@/lib/canvas-story/resolve-container-queries';
import { extractGeometry } from '@/lib/canvas-story/geometry';
import { StoryRasterInput, StoryRasterResult, StoryRendererEngine, MeasuredNodeLike } from '@/lib/canvas-story/types';

/**
 * Render a story to a single PNG raster + interaction geometry.
 * Engine-agnostic: pass a @takumi-rs/core Renderer (tests/server) or a
 * @takumi-rs/wasm Renderer (browser, see renderer.client.ts). The engines'
 * render/measure are called directly — takumi-js's convenience wrapper is
 * deliberately NOT used: its auto backend resolution drags bundler-specific
 * wasm imports into the client graph, which Turbopack can't resolve.
 */
/**
 * Force greedy line wrapping: takumi's render honors `text-wrap: balance|pretty`
 * but measure() always wraps greedily, so balanced text would RENDER with one set
 * of wrap points while the measured runs report another — selection bands and
 * embed geometry then disagree with the pixels. Neutralizing the property makes
 * both passes wrap identically.
 */
export function neutralizeBalancedTextWrap(css: string): string {
  return css.replace(/(text-wrap(?:-style)?\s*:\s*)(balance|pretty)/gi, '$1initial');
}

export async function renderStoryRaster(
  renderer: StoryRendererEngine,
  input: StoryRasterInput,
): Promise<StoryRasterResult> {
  const { node, extractedStylesheets } = buildStoryNodeTree(input.html);
  const options = {
    width: input.width * input.dpr,
    devicePixelRatio: input.dpr,
    format: 'png' as const,
    stylesheets: [...input.stylesheets, ...extractedStylesheets]
      .map(css => neutralizeBalancedTextWrap(resolveContainerQueries(css, input.width))),
  };
  const png = await renderer.render(node, options);
  const measured = (await renderer.measure(node, options)) as MeasuredNodeLike;
  const { runs, embeds } = extractGeometry(node as never, measured, input.dpr);
  return {
    png: png instanceof Uint8Array ? png : new Uint8Array(png),
    width: measured.width / input.dpr,
    height: measured.height / input.dpr,
    runs,
    embeds,
  };
}
