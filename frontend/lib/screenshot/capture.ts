/**
 * Plain (non-hook) screenshot capture — the core of useScreenshot, callable from
 * ANYWHERE (tool handlers, region-select) by passing `colorMode` explicitly instead
 * of reading it from Redux via a hook. `useScreenshot` delegates here so there is a
 * single capture implementation.
 *
 * Browser-only (uses the DOM + snapdom). snapdom deep-clones the subtree WITH its styles,
 * including Shadow DOM — which html-to-image's <foreignObject> approach could not, so
 * shadow-scoped content (e.g. story charts) now rasterizes correctly. It also embeds fonts
 * and caches resources/style-maps internally, so there is no separate font-embed step.
 */
import { snapdom } from '@zumer/snapdom';
import { getCanvasStoryCapture } from '@/lib/canvas-story/capture-registry';
import { findStorySvg, serializeStorySvg, svgToImage } from '@/lib/story-surface/serialize';
import { AGENT_IMAGE_MAX_PX, AGENT_IMAGE_PIXEL_RATIO, AGENT_IMAGE_JPEG_QUALITY } from './constants';
import type { ScreenshotOptions } from './types';

export type CaptureOptions = ScreenshotOptions & { colorMode: 'light' | 'dark' };

const bgFor = (colorMode: 'light' | 'dark'): string => (colorMode === 'dark' ? '#0D1117' : '#FAFBFC');

/** snapdom blob type for the requested output format. */
const blobType = (format: ScreenshotOptions['format']): 'png' | 'jpeg' => (format === 'png' ? 'png' : 'jpeg');

/**
 * Full-element capture from an SVG-rendered story: serialize the live `<svg>` surface (styles cloned
 * in, fonts inlined, scroll baked) and let the browser rasterize it. Returns null when `element`
 * doesn't host one — dashboards/questions/notebooks are main-document React whose styles live in the
 * PARENT document's stylesheets, so they'd serialize unstyled; those still need snapdom.
 */
async function captureFromSvgStory(element: HTMLElement, opts: CaptureOptions): Promise<Blob | null> {
  const svg = findStorySvg(element);
  if (!svg) return null;
  const cssWidth = svg.getBoundingClientRect().width || svg.width.baseVal.value;
  const cssHeight = svg.getBoundingClientRect().height || svg.height.baseVal.value;
  if (!cssWidth || !cssHeight) return null;
  const scale = opts.maxWidth != null ? opts.maxWidth / cssWidth : (opts.pixelRatio ?? 0.75);
  const img = await svgToImage(await serializeStorySvg(svg));
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(cssWidth * scale));
  out.height = Math.max(1, Math.round(cssHeight * scale));
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = opts.backgroundColor ?? bgFor(opts.colorMode);
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(img, 0, 0, out.width, out.height);
  return canvasToBlob(out, blobType(opts.format) === 'png' ? 'image/png' : 'image/jpeg', opts.quality ?? AGENT_IMAGE_JPEG_QUALITY);
}

/**
 * Crop directly from an SVG-rendered story: serialize the live surface and cut the selection out of
 * it. Mirrors cropFromCanvasStory — including the containment check: coordinates here are relative to
 * the STORY SVG's box, so a selection straying outside it (page chrome, chat panel) must fall through
 * to snapdom rather than be cropped against the wrong origin. Returns null when no SVG story hosts
 * the selection.
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
  return canvasToBlob(out, (opts.format ?? 'jpeg') === 'png' ? 'image/png' : 'image/jpeg', opts.quality ?? AGENT_IMAGE_JPEG_QUALITY);
}

/** Render a single DOM element to an image Blob (jpeg by default). */
export async function captureElementBlob(element: HTMLElement, opts: CaptureOptions): Promise<Blob> {
  // Canvas story renderer: the story is already pixels — composite (raster + island
  // bitmaps, maintained at idle) and scale, skipping snapdom's DOM re-serialization.
  const direct = captureFromCanvasStory(element, opts);
  if (direct) return direct;
  // SVG story renderer: the story is already an <svg> — serialize the LIVE surface and let the
  // browser rasterize it, so the capture is the same renderer the user is looking at.
  const fromSvg = await captureFromSvgStory(element, opts);
  if (fromSvg) return fromSvg;
  // Always scale the RASTER, never snapdom's `width` — `width` re-lays-out the element at that width
  // (e.g. a fixed-width story rewraps and its fixed CSS heights collide), whereas `scale` downscales
  // the captured bitmap with no reflow. maxWidth → scale to hit that width; else use pixelRatio
  // (default 0.75). dpr:1 keeps `scale` the literal multiplier (snapdom would otherwise ×devicePR).
  const scale = opts.maxWidth != null ? opts.maxWidth / element.offsetWidth : (opts.pixelRatio ?? 0.75);
  return snapdom.toBlob(element, {
    type: blobType(opts.format),
    quality: opts.quality ?? AGENT_IMAGE_JPEG_QUALITY,
    backgroundColor: opts.backgroundColor ?? bgFor(opts.colorMode),
    dpr: 1,
    scale,
    filter: opts.filter,
    embedFonts: true,
  });
}

/**
 * Capture an element at its FULL height — temporarily expands every scrollable
 * descendant (and the root) to its scrollHeight so scrolled-off content is included,
 * then restores the original styles (even on failure).
 */
export async function captureElementFullHeightBlob(element: HTMLElement, opts: CaptureOptions): Promise<Blob> {
  // Canvas story renderer: the composite already spans the story's full height.
  const direct = captureFromCanvasStory(element, opts);
  if (direct) return direct;
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
 * Pick the render scale for a region capture so we never rasterize FINER than the final output
 * cap needs. snapdom renders the whole node (not a sub-rect), so the target is rendered then
 * cropped to `selection`; rendering at device DPR when the crop will be downscaled to `maxOutputPx`
 * anyway is wasted work. Scale so the cropped selection lands ~at `maxOutputPx` on its longest side,
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
 * Capture a user-selected viewport REGION as an image Blob: render `target` (default
 * document.body) via snapdom, then crop to `selection` (viewport coords). Used by the
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
  // `opts.pixelRatio` (when given) is the device cap, not the render ratio: we render no finer than
  // the output cap needs, so a large selection rasterizes the target at <1× instead of device DPR.
  const deviceCap = opts.pixelRatio ?? Math.min(AGENT_IMAGE_PIXEL_RATIO, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  const pixelRatio = regionPixelRatio(selection, maxOutputPx, deviceCap);
  // FAST PATH — canvas story renderer: when the selection lies fully inside the story's
  // canvas surface and intersects no live embed island, the pixels already exist — crop
  // straight from the canvas (0ms) instead of a snapdom DOM re-serialization. Regions
  // touching islands (live DOM charts/params) still need snapdom to include them.
  const direct = cropFromCanvasStory(selection, opts.format, opts.quality, maxOutputPx);
  if (direct) return direct;
  // SVG story renderer: same idea — crop straight from the serialized live surface when the
  // selection lies fully inside it. Null (not an SVG story, e.g. a dashboard) → snapdom.
  const fromSvg = await cropFromSvgStory(selection, opts, maxOutputPx);
  if (fromSvg) return fromSvg;
  // snapdom returns the rasterized canvas directly (dpr:1 so `scale` is the literal pixel ratio).
  const source = await snapdom.toCanvas(target, {
    scale: pixelRatio,
    dpr: 1,
    backgroundColor: opts.backgroundColor ?? bgFor(opts.colorMode),
    filter: opts.filter,
    embedFonts: true,
  });
  const { sx, sy, sw, sh } = cropSourceRect(selection, targetBox, pixelRatio);
  // Cap the OUTPUT as a safety net — with the reduced pixelRatio the crop is already ~maxOutputPx.
  const { w, h } = cappedOutputDims(sw, sh, maxOutputPx);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get a 2D canvas context for cropping');
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, w, h);
  return canvasToBlob(canvas, (opts.format ?? 'jpeg') === 'png' ? 'image/png' : 'image/jpeg', opts.quality ?? AGENT_IMAGE_JPEG_QUALITY);
}

/**
 * Full-element capture from a canvas-rendered story. Returns null when the element
 * doesn't host one (callers fall back to snapdom). Draws straight from the story's
 * source bitmaps via the capture provider — no DOM serialization, no giant
 * intermediate canvas.
 */
function captureFromCanvasStory(element: HTMLElement, opts: CaptureOptions): Promise<Blob> | null {
  const provider = getCanvasStoryCapture();
  if (!provider) return null;
  const surface = provider.surface();
  if (!surface || !element.contains(surface)) return null;
  const size = provider.size();
  if (!size) return null;
  const cssWidth = surface.getBoundingClientRect().width || size.width;
  const scale = opts.maxWidth != null ? opts.maxWidth / cssWidth : (opts.pixelRatio ?? 0.75);
  const w = Math.max(1, Math.round(cssWidth * scale));
  const h = Math.max(1, Math.round(size.height * (w / size.width)));
  return (async () => {
    await provider.prepare?.(); // lazy island-chrome rasters (takumi) — capture-time only
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const ctx = out.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    if (!provider.drawRegion(ctx, 0, 0, size.width, size.height, 0, 0, w, h)) throw new Error('drawRegion failed');
    return canvasToBlob(out, blobType(opts.format), opts.quality ?? AGENT_IMAGE_JPEG_QUALITY);
  })();
}

/**
 * Crop directly from a canvas-rendered story: any region inside the story surface is
 * drawn from the story's source bitmaps (raster + lazily takumi-rastered island
 * chrome + live chart canvases) — snapdom never runs on the capture path. Returns null when no canvas story hosts
 * the selection.
 */
function cropFromCanvasStory(
  selection: { x: number; y: number; width: number; height: number },
  format?: 'jpeg' | 'png',
  quality?: number,
  maxOutputPx: number = AGENT_IMAGE_MAX_PX,
): Promise<Blob> | null {
  const provider = getCanvasStoryCapture();
  if (!provider) return null;
  const surface = provider.surface();
  if (!surface) return null;
  const box = surface.getBoundingClientRect();
  const inside = selection.x >= box.left && selection.y >= box.top
    && selection.x + selection.width <= box.right && selection.y + selection.height <= box.bottom;
  if (!inside) return null;
  const size = provider.size();
  if (!size) return null;
  const scale = size.width / box.width; // device px per CSS px
  const sx = (selection.x - box.left) * scale;
  const sy = (selection.y - box.top) * scale;
  const sw = selection.width * scale;
  const sh = selection.height * scale;
  const { w, h } = cappedOutputDims(sw, sh, maxOutputPx);
  return (async () => {
    await provider.prepare?.(); // lazy island-chrome rasters (takumi) — capture-time only
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const ctx = out.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    if (!provider.drawRegion(ctx, sx, sy, sw, sh, 0, 0, w, h)) throw new Error('drawRegion failed');
    return canvasToBlob(out, (format ?? 'jpeg') === 'png' ? 'image/png' : 'image/jpeg', quality ?? AGENT_IMAGE_JPEG_QUALITY);
  })();
}

/** Capture a FileView (question/dashboard/story/notebook/report) by its `data-file-id`. */
export async function captureFileViewBlob(
  fileId: number,
  opts: CaptureOptions & { fullHeight?: boolean },
): Promise<Blob> {
  const element = document.querySelector(`[data-file-id="${fileId}"]`);
  if (!element) throw new Error(`FileView with id ${fileId} not found`);
  return opts.fullHeight
    ? captureElementFullHeightBlob(element as HTMLElement, opts)
    : captureElementBlob(element as HTMLElement, opts);
}
