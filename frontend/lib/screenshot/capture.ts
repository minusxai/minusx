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
import { AGENT_IMAGE_MAX_PX, AGENT_IMAGE_PIXEL_RATIO, AGENT_IMAGE_JPEG_QUALITY } from './constants';
import type { ScreenshotOptions } from './types';

export type CaptureOptions = ScreenshotOptions & { colorMode: 'light' | 'dark' };

const bgFor = (colorMode: 'light' | 'dark'): string => (colorMode === 'dark' ? '#0D1117' : '#FAFBFC');

/** snapdom blob type for the requested output format. */
const blobType = (format: ScreenshotOptions['format']): 'png' | 'jpeg' => (format === 'png' ? 'png' : 'jpeg');

/** Render a single DOM element to an image Blob (jpeg by default). */
export async function captureElementBlob(element: HTMLElement, opts: CaptureOptions): Promise<Blob> {
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
