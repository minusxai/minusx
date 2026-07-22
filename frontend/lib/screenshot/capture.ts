/**
 * Plain (non-hook) screenshot capture — the core of useScreenshot, callable from
 * ANYWHERE (tool handlers, region-select) by passing `colorMode` explicitly instead
 * of reading it from Redux via a hook. `useScreenshot` delegates here so there is a
 * single capture implementation.
 *
 * Browser-only. Every path is SERIALIZATION capture (Story_Design_V2 §4 — snapdom is gone):
 *  - SVG-rendered stories serialize their live `<svg>` surface (lib/story-surface/serialize) —
 *    the capture IS the renderer the user is looking at.
 *  - Everything else (dashboards/questions/notebooks/reports — main-document React whose CSS
 *    lives in the parent document's stylesheets) goes through the generic element serializer
 *    (serialize-element.ts): clone into `<svg><foreignObject>` with all same-origin document
 *    CSS inlined, fixup pass applied, images/fonts as data: URIs.
 * Both rasterize through the same percent-encoded data:-URL pipeline (svgToImage) — never a
 * Blob URL, which taints the canvas in Chromium/WebKit.
 */
import { findStorySvg, serializeStorySvg, svgToImage } from '@/lib/story-surface/serialize';
import { findSurfaceSvg, serializeSurfaceSvg } from './serialize-surface';
import { serializeElementToSvg } from './serialize-element';
import { waitForFileViewReady } from './readiness';
import { AGENT_IMAGE_MAX_PX, AGENT_IMAGE_PIXEL_RATIO, AGENT_IMAGE_JPEG_QUALITY } from './constants';
import { drawMarkerGutter } from './draw-markers';
import type { ScreenshotOptions } from './types';

export type CaptureOptions = ScreenshotOptions & { colorMode: 'light' | 'dark' };

const bgFor = (colorMode: 'light' | 'dark'): string => (colorMode === 'dark' ? '#0D1117' : '#FAFBFC');

const mimeFor = (format: ScreenshotOptions['format']): string => (format === 'png' ? 'image/png' : 'image/jpeg');

/**
 * Draw a rasterized SVG image to an output canvas at `scale` (of its CSS size), background filled,
 * optional marker gutter, and encode to a Blob. Shared tail of both capture paths.
 */
async function rasterToBlob(
  img: HTMLImageElement,
  cssWidth: number,
  cssHeight: number,
  scale: number,
  opts: CaptureOptions,
): Promise<Blob> {
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(cssWidth * scale));
  out.height = Math.max(1, Math.round(cssHeight * scale));
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  ctx.fillStyle = opts.backgroundColor ?? bgFor(opts.colorMode);
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(img, 0, 0, out.width, out.height);
  const final = opts.markers ? drawMarkerGutter(out, { docHeightCssPx: cssHeight, colorMode: opts.colorMode }) : out;
  return canvasToBlob(final, mimeFor(opts.format), opts.quality ?? AGENT_IMAGE_JPEG_QUALITY);
}

/**
 * Full-element capture from an SVG-rendered story: serialize the live `<svg>` surface (styles cloned
 * in, fonts inlined, scroll baked) and let the browser rasterize it. Returns null when `element`
 * doesn't host one — dashboards/questions/notebooks fall through to the generic element serializer.
 */
async function captureFromSvgStory(element: HTMLElement, opts: CaptureOptions): Promise<Blob | null> {
  const svg = findStorySvg(element);
  if (!svg) return null;
  const cssWidth = svg.getBoundingClientRect().width || svg.width.baseVal.value;
  const cssHeight = svg.getBoundingClientRect().height || svg.height.baseVal.value;
  if (!cssWidth || !cssHeight) return null;
  const scale = opts.maxWidth != null ? opts.maxWidth / cssWidth : (opts.pixelRatio ?? 0.75);
  const img = await svgToImage(await serializeStorySvg(svg));
  return rasterToBlob(img, cssWidth, cssHeight, scale, opts);
}

/**
 * Crop directly from an SVG-rendered story: serialize the live surface and cut the selection out of
 * it. Containment check: coordinates here are relative to the STORY SVG's box, so a selection
 * straying outside it (page chrome, chat panel) must fall through to the generic path rather than
 * be cropped against the wrong origin. Returns null when no SVG story hosts the selection.
 */
async function cropFromSvgStory(
  selection: { x: number; y: number; width: number; height: number },
  opts: CaptureOptions & { target?: HTMLElement },
  maxOutputPx: number,
): Promise<Blob | null> {
  const host = opts.target ?? (typeof document !== 'undefined' ? document.body : null);
  if (!host) return null;
  const svg = findStorySvg(host);
  if (!svg) return null;
  const box = svg.getBoundingClientRect();
  const inside = selection.x >= box.left && selection.y >= box.top
    && selection.x + selection.width <= box.right && selection.y + selection.height <= box.bottom;
  if (!inside) return null;
  if (!box.width || !box.height) return null;

  const img = await svgToImage(await serializeStorySvg(svg));
  // The rasterized image is the SVG at its intrinsic size; map viewport → image space through the
  // svg's own box (NOT the page target), then downscale to the output cap.
  const ratio = (img.naturalWidth || box.width) / box.width;
  const sx = (selection.x - box.left) * ratio;
  const sy = (selection.y - box.top) * ratio;
  const sw = selection.width * ratio;
  const sh = selection.height * ratio;
  const { w, h } = cappedOutputDims(sw, sh, maxOutputPx);
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = opts.backgroundColor ?? bgFor(opts.colorMode);
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  return canvasToBlob(out, mimeFor(opts.format), opts.quality ?? AGENT_IMAGE_JPEG_QUALITY);
}

/**
 * Full capture from a main-document live-svg surface (Renderer_v2 Phase 4, B2): the dashboard's
 * content already lives in `<svg data-mx-surface-svg><foreignObject>`, so serialize THAT live svg
 * (document CSS inlined) rather than re-wrapping a clone. Null when `element` hosts no surface.
 */
async function captureFromSvgSurface(element: HTMLElement, opts: CaptureOptions): Promise<Blob | null> {
  const svg = findSurfaceSvg(element);
  if (!svg) return null;
  const box = svg.getBoundingClientRect();
  const cssWidth = box.width || svg.width.baseVal.value;
  const cssHeight = box.height || svg.height.baseVal.value;
  if (!cssWidth || !cssHeight) return null;
  const scale = opts.maxWidth != null ? opts.maxWidth / cssWidth : (opts.pixelRatio ?? 0.75);
  const img = await svgToImage(await serializeSurfaceSvg(svg));
  return rasterToBlob(img, cssWidth, cssHeight, scale, opts);
}

/** Render a single DOM element to an image Blob (jpeg by default). */
export async function captureElementBlob(element: HTMLElement, opts: CaptureOptions): Promise<Blob> {
  // SVG story renderer: the story is already an <svg> — serialize the LIVE surface and let the
  // browser rasterize it, so the capture is the same renderer the user is looking at.
  const fromSvg = await captureFromSvgStory(element, opts);
  if (fromSvg) return fromSvg;
  // Main-document live-svg surface (dashboards): same principle, styles from the parent document.
  const fromSurface = await captureFromSvgSurface(element, opts);
  if (fromSurface) return fromSurface;
  // Generic app-page path: serialize the element with the parent document's CSS inlined. Always
  // scale the RASTER (drawImage), never the element — no reflow. maxWidth → scale to hit that
  // width; else use pixelRatio (default 0.75).
  const cssWidth = element.offsetWidth || element.getBoundingClientRect().width || 1;
  const cssHeight = element.offsetHeight || element.getBoundingClientRect().height || 1;
  const scale = opts.maxWidth != null ? opts.maxWidth / cssWidth : (opts.pixelRatio ?? 0.75);
  const svgString = await serializeElementToSvg(element, {
    backgroundColor: opts.backgroundColor ?? bgFor(opts.colorMode),
    filter: opts.filter,
  });
  const img = await svgToImage(svgString);
  return rasterToBlob(img, cssWidth, cssHeight, scale, opts);
}

/**
 * Capture an element at its FULL height — temporarily expands every scrollable
 * descendant (and the root) to its scrollHeight so scrolled-off content is included,
 * then restores the original styles (even on failure).
 */
export async function captureElementFullHeightBlob(element: HTMLElement, opts: CaptureOptions): Promise<Blob> {
  const scrollables = Array.from(element.querySelectorAll('*')).filter(el => {
    const s = window.getComputedStyle(el);
    const scrolls = s.overflow === 'auto' || s.overflow === 'scroll' || s.overflowY === 'auto' || s.overflowY === 'scroll';
    return scrolls && (el as HTMLElement).scrollHeight > (el as HTMLElement).clientHeight;
  }) as HTMLElement[];

  const saved = scrollables.map(el => ({ el, height: el.style.height, maxHeight: el.style.maxHeight, overflow: el.style.overflow, overflowY: el.style.overflowY }));
  const rootSaved = { height: element.style.height, maxHeight: element.style.maxHeight, overflow: element.style.overflow, overflowY: element.style.overflowY };
  const expand = (el: HTMLElement) => { el.style.height = `${el.scrollHeight}px`; el.style.maxHeight = 'none'; el.style.overflow = 'visible'; el.style.overflowY = 'visible'; };
  const restore = (el: HTMLElement, s: { height: string; maxHeight: string; overflow: string; overflowY: string }) => { el.style.height = s.height; el.style.maxHeight = s.maxHeight; el.style.overflow = s.overflow; el.style.overflowY = s.overflowY; };

  try {
    scrollables.forEach(expand);
    if (element.scrollHeight > element.clientHeight) expand(element);
    await new Promise(r => setTimeout(r, 100)); // let layout settle
    return await captureElementBlob(element, opts);
  } finally {
    saved.forEach(({ el, ...s }) => restore(el, s));
    restore(element, rootSaved);
  }
}

/**
 * Map a viewport-space selection rect to the SOURCE crop rect within a captured
 * image of `target`. Subtracting the target's getBoundingClientRect() top-left maps
 * viewport coords → the captured image's own coordinate space, which works whether the
 * target is `document.body` (scrolled: box.top is negative) or a specific element.
 * Pure (no DOM) so it's unit-testable; captureRegionBlob is the browser glue around it.
 */
export function cropSourceRect(
  selection: { x: number; y: number; width: number; height: number },
  targetBox: { left: number; top: number },
  pixelRatio: number,
): { sx: number; sy: number; sw: number; sh: number } {
  return {
    sx: Math.max(0, (selection.x - targetBox.left) * pixelRatio),
    sy: Math.max(0, (selection.y - targetBox.top) * pixelRatio),
    sw: Math.max(1, selection.width * pixelRatio),
    sh: Math.max(1, selection.height * pixelRatio),
  };
}

/**
 * Cap output dimensions so the longest side is ≤ maxPx, preserving aspect ratio. Keeps a region
 * crop from becoming a multi-megapixel image on a retina screen (2× device pixel ratio, no width
 * limit). Pure → unit-testable.
 */
export function cappedOutputDims(sw: number, sh: number, maxPx: number): { w: number; h: number } {
  const longest = Math.max(sw, sh);
  const scale = longest > maxPx ? maxPx / longest : 1;
  return { w: Math.max(1, Math.round(sw * scale)), h: Math.max(1, Math.round(sh * scale)) };
}

/**
 * Pick the output scale for a region capture so we never produce an image FINER than the final
 * output cap needs: scale so the cropped selection lands ~at `maxOutputPx` on its longest side,
 * never exceeding the device cap (no upscaling past the screen). Pure → unit-testable.
 */
export function regionPixelRatio(
  selection: { width: number; height: number },
  maxOutputPx: number,
  deviceCap: number,
): number {
  const longest = Math.max(1, selection.width, selection.height);
  return Math.min(deviceCap, maxOutputPx / longest);
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('canvas.toBlob failed'))), type, quality));
}

/**
 * Capture a user-selected viewport REGION as an image Blob: serialize `target` (default
 * document.body), rasterize, then crop to `selection` (viewport coords). Used by the
 * drag-select context tool. `opts.filter` should exclude the selection overlay itself.
 */
export async function captureRegionBlob(
  selection: { x: number; y: number; width: number; height: number },
  opts: CaptureOptions & { target?: HTMLElement; targetBox?: { left: number; top: number }; maxOutputPx?: number },
): Promise<Blob> {
  const target = opts.target ?? document.body;
  // Snapshot the crop reference frame BEFORE the async render. `selection` is in viewport coords
  // captured at drag time; reading the target's rect AFTER the render lets any layout drift in
  // between — page scroll, the pending-upload chip reflow — slide the crop. Prefer a caller-provided
  // box captured synchronously at selection time; otherwise read it here, still pre-render.
  const targetBox = opts.targetBox ?? target.getBoundingClientRect();
  const maxOutputPx = opts.maxOutputPx ?? AGENT_IMAGE_MAX_PX;
  // `opts.pixelRatio` (when given) is the device cap, not the render ratio: the OUTPUT is sized no
  // finer than the cap needs, so a large selection lands ~at maxOutputPx instead of device DPR.
  const deviceCap = opts.pixelRatio ?? Math.min(AGENT_IMAGE_PIXEL_RATIO, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  const pixelRatio = regionPixelRatio(selection, maxOutputPx, deviceCap);
  // SVG story renderer: crop straight from the serialized live surface when the selection lies
  // fully inside it. Null (not an SVG story, e.g. a dashboard) → generic serialization capture.
  const fromSvg = await cropFromSvgStory(selection, opts, maxOutputPx);
  if (fromSvg) return fromSvg;
  // Generic path: the serialized SVG rasterizes at its intrinsic CSS size (ratio 1), so the crop
  // rect is in CSS px; the OUTPUT canvas applies pixelRatio (SVG images redraw vector-sharp when
  // drawImage scales them, so this loses no fidelity).
  const svgString = await serializeElementToSvg(target, {
    backgroundColor: opts.backgroundColor ?? bgFor(opts.colorMode),
    filter: opts.filter,
  });
  const img = await svgToImage(svgString);
  const { sx, sy, sw, sh } = cropSourceRect(selection, targetBox, 1);
  // Cap the OUTPUT as a safety net — with pixelRatio applied the crop is already ~maxOutputPx.
  const { w, h } = cappedOutputDims(sw * pixelRatio, sh * pixelRatio, maxOutputPx);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get a 2D canvas context for cropping');
  ctx.fillStyle = opts.backgroundColor ?? bgFor(opts.colorMode);
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  return canvasToBlob(canvas, mimeFor(opts.format), opts.quality ?? AGENT_IMAGE_JPEG_QUALITY);
}

/**
 * Capture a FileView (question/dashboard/story/notebook/report) by its `data-file-id`.
 *
 * Readiness-gated: embeds hydrate asynchronously (chart queries, inline numbers, metric tiles),
 * and a capture fired mid-hydration rasterizes blank tiles and missing charts. The wait lives
 * HERE, not in callers, so every capture site (dev panel pre-capture, file health, chat
 * attachments, agent review) is correct by default. Best-effort: resolves by its timeout, so a
 * stuck query degrades to a capture of its spinner rather than hanging the caller.
 */
export async function captureFileViewBlob(
  fileId: number,
  opts: CaptureOptions & { fullHeight?: boolean },
): Promise<Blob> {
  const element = document.querySelector(`[data-file-id="${fileId}"]`);
  if (!element) throw new Error(`FileView with id ${fileId} not found`);
  await waitForFileViewReady(fileId, { timeoutMs: 10000 });
  // The view can REMOUNT while settling (EditFile rebuilds the story iframe) — re-resolve it.
  const live = document.querySelector(`[data-file-id="${fileId}"]`) ?? element;
  return opts.fullHeight
    ? captureElementFullHeightBlob(live as HTMLElement, opts)
    : captureElementBlob(live as HTMLElement, opts);
}
