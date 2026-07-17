'use client';

/**
 * Snapdom-free island capture. An island's CHART pixels come straight off its
 * live <canvas> (vega renders with the canvas renderer inside canvas stories —
 * see canvas-render-context). What remains is the island's HTML chrome (card,
 * title, single-value text): this module serializes that subtree with INLINED
 * computed styles and rasterizes it through takumi — the same engine that
 * renders the story — lazily, at capture time. No DOM screenshot library.
 */

import { getStoryRenderer } from '@/lib/canvas-story/renderer.client';
import { renderStoryRaster } from '@/lib/canvas-story/raster';
import { storyDpr } from '@/lib/canvas-story/types';

/** A live pixel source inside the island (vega/echarts canvas), island-relative CSS px. */
export interface IslandCanvasBox {
  el: HTMLCanvasElement;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface IslandRaster {
  /** Rasterized HTML chrome at the story dpr (canvas elements left as blank boxes). */
  chrome: ImageBitmap;
  /** Island size in CSS px at raster time. */
  width: number;
  height: number;
}

/** Style properties takumi understands — copied per element from computed style. */
const COPY_PROPS: Array<[string, string]> = [
  ['display', 'display'], ['flex-direction', 'flexDirection'], ['align-items', 'alignItems'],
  ['justify-content', 'justifyContent'], ['gap', 'gap'], ['flex-grow', 'flexGrow'], ['flex-shrink', 'flexShrink'],
  ['padding-top', 'paddingTop'], ['padding-right', 'paddingRight'], ['padding-bottom', 'paddingBottom'], ['padding-left', 'paddingLeft'],
  ['margin-top', 'marginTop'], ['margin-right', 'marginRight'], ['margin-bottom', 'marginBottom'], ['margin-left', 'marginLeft'],
  ['color', 'color'], ['background-color', 'backgroundColor'],
  ['font-family', 'fontFamily'], ['font-size', 'fontSize'], ['font-weight', 'fontWeight'], ['font-style', 'fontStyle'],
  ['line-height', 'lineHeight'], ['letter-spacing', 'letterSpacing'], ['text-align', 'textAlign'],
  ['text-transform', 'textTransform'], ['white-space', 'whiteSpace'],
  ['border-radius', 'borderRadius'], ['border-top-width', 'borderTopWidth'], ['border-top-style', 'borderTopStyle'], ['border-top-color', 'borderTopColor'],
  ['border-bottom-width', 'borderBottomWidth'], ['border-right-width', 'borderRightWidth'], ['border-left-width', 'borderLeftWidth'],
  ['opacity', 'opacity'], ['overflow', 'overflow'],
];

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string): string => esc(s).replace(/"/g, '&quot;');

function inlineStyle(el: Element, extra = ''): string {
  const cs = getComputedStyle(el);
  const parts: string[] = [];
  for (const [cssName] of COPY_PROPS) {
    const v = cs.getPropertyValue(cssName);
    if (v && v !== 'normal' && v !== 'none' && v !== 'auto' && v !== 'rgba(0, 0, 0, 0)') {
      parts.push(`${cssName}: ${v}`);
    }
  }
  return `${parts.join('; ')}${extra ? `; ${extra}` : ''}`;
}

function serializeNode(node: Node, hostRect: DOMRect, canvases: IslandCanvasBox[]): string {
  if (node.nodeType === Node.TEXT_NODE) return esc(node.textContent ?? '');
  if (!(node instanceof Element)) return '';
  const cs = getComputedStyle(node);
  if (cs.display === 'none' || cs.visibility === 'hidden') return '';
  const rect = node.getBoundingClientRect();

  if (node instanceof HTMLCanvasElement) {
    canvases.push({ el: node, x: rect.left - hostRect.left, y: rect.top - hostRect.top, w: rect.width, h: rect.height });
    return `<div style="width: ${rect.width}px; height: ${rect.height}px; flex-shrink: 0"></div>`;
  }
  if (node instanceof SVGElement) {
    // Rare fallback (vega uses the canvas renderer inside canvas stories) — reserve space.
    return `<div style="width: ${rect.width}px; height: ${rect.height}px; flex-shrink: 0"></div>`;
  }

  const children = [...node.childNodes].map(c => serializeNode(c, hostRect, canvases)).join('');
  // Fixed width on the outermost sizing wrappers keeps takumi's layout aligned with
  // the live DOM even where unsupported CSS (grid templates etc.) sized the original.
  return `<div style="${escAttr(inlineStyle(node))}">${children}</div>`;
}

/**
 * Serialize the island subtree (styles inlined) and note live canvas positions.
 * Pure DOM-read; rasterization happens in {@link rasterizeIslandChrome}.
 */
export function serializeIsland(host: HTMLElement): { html: string; canvases: IslandCanvasBox[]; width: number; height: number } {
  const rect = host.getBoundingClientRect();
  const canvases: IslandCanvasBox[] = [];
  const inner = [...host.childNodes].map(c => serializeNode(c, rect, canvases)).join('');
  const html = `<div style="width: ${Math.ceil(rect.width)}px; min-height: ${Math.ceil(rect.height)}px">${inner}</div>`;
  return { html, canvases, width: rect.width, height: rect.height };
}

/** Rasterize the island's HTML chrome via takumi. Lazy — call at capture time. */
export async function rasterizeIslandChrome(host: HTMLElement): Promise<IslandRaster & { canvases: IslandCanvasBox[] }> {
  const { html, canvases, width, height } = serializeIsland(host);
  const renderer = await getStoryRenderer();
  const raster = await renderStoryRaster(renderer, {
    html,
    stylesheets: [],
    width: Math.max(1, Math.ceil(width)),
    dpr: storyDpr(),
  });
  const chrome = await createImageBitmap(new Blob([raster.png as BlobPart], { type: 'image/png' }));
  return { chrome, canvases, width, height };
}
