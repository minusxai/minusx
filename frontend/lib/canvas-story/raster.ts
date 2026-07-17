import { buildStoryNodeTree, stripStyleProp } from '@/lib/canvas-story/node-tree';
import { resolveContainerQueries } from '@/lib/canvas-story/resolve-container-queries';
import { resolveFluidCss } from '@/lib/canvas-story/resolve-fluid-css';
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

/**
 * takumi ignores `ch` units entirely (a `max-width: 24ch` is a no-op), so measure-
 * constrained headlines and prose (`max-w-[62ch]`) render full-width — a large wrap
 * divergence from the DOM. Translate to the standard approximation 1ch ≈ 0.5em.
 */
export function normalizeChUnits(css: string): string {
  return css.replace(/(\d*\.?\d+)ch\b/g, (_, n: string) => `${parseFloat(n) * 0.5}em`);
}

export async function renderStoryRaster(
  renderer: StoryRendererEngine,
  input: StoryRasterInput,
): Promise<StoryRasterResult> {
  const { node, extractedStylesheets } = buildStoryNodeTree(input.html, input.embedSizes, input.width);
  const options = {
    width: input.width * input.dpr,
    devicePixelRatio: input.dpr,
    format: 'png' as const,
    stylesheets: [...input.stylesheets, ...extractedStylesheets]
      .map(css => resolveFluidCss(normalizeChUnits(neutralizeBalancedTextWrap(resolveContainerQueries(css, input.width))), input.width)),
  };
  // Resilience net: takumi hard-throws on any inline style value it can't parse,
  // which would push the whole story to the DOM fallback over one declaration.
  // Parse the offending property out of the error, strip it everywhere, retry.
  let png: Uint8Array | Buffer | undefined;
  for (let attempt = 0; ; attempt++) {
    try {
      png = await renderer.render(node, options);
      break;
    } catch (err) {
      const prop = attempt < 6 ? String(err).match(/invalid value for (\w+)/)?.[1] : undefined;
      if (!prop) throw err;
      stripStyleProp(node as { style?: Record<string, unknown>; children?: unknown[] }, prop);
    }
  }
  const measured = (await renderer.measure(node, options)) as MeasuredNodeLike;
  const { runs, embeds, blocks } = extractGeometry(node as never, measured, input.dpr);
  return {
    png: png instanceof Uint8Array ? png : new Uint8Array(png),
    width: measured.width / input.dpr,
    height: measured.height / input.dpr,
    runs,
    embeds,
    blocks,
    dpr: input.dpr,
  };
}
