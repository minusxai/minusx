/**
 * Plain (non-hook) screenshot capture — the core of useScreenshot, callable from
 * ANYWHERE (tool handlers, region-select) by passing `colorMode` explicitly instead
 * of reading it from Redux via a hook. `useScreenshot` delegates here so there is a
 * single capture implementation.
 *
 * Browser-only (uses the DOM + html-to-image).
 */
import { toJpeg, toPng } from 'html-to-image';
import type { ScreenshotOptions } from './types';

export type CaptureOptions = ScreenshotOptions & { colorMode: 'light' | 'dark' };

const bgFor = (colorMode: 'light' | 'dark'): string => (colorMode === 'dark' ? '#0D1117' : '#FAFBFC');

/** Render a single DOM element to an image Blob (jpeg by default). */
export async function captureElementBlob(element: HTMLElement, opts: CaptureOptions): Promise<Blob> {
  const pixelRatio = opts.maxWidth != null ? opts.maxWidth / element.offsetWidth : (opts.pixelRatio ?? 0.75);
  const toImage = (opts.format ?? 'jpeg') === 'png' ? toPng : toJpeg;
  const dataURL = await toImage(element, {
    pixelRatio,
    backgroundColor: opts.backgroundColor ?? bgFor(opts.colorMode),
    filter: opts.filter,
    quality: opts.quality ?? 0.9,
  });
  const blob = await fetch(dataURL).then(r => r.blob());
  if (!blob) throw new Error('Screenshot capture failed');
  return blob;
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

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load captured image'));
    img.src = src;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('canvas.toBlob failed'))), type, quality));
}

/**
 * Capture a user-selected viewport REGION as an image Blob: render `target` (default
 * document.body) via html-to-image, then crop to `selection` (viewport coords). Used by
 * the drag-select context tool. `opts.filter` should exclude the selection overlay itself.
 */
export async function captureRegionBlob(
  selection: { x: number; y: number; width: number; height: number },
  opts: CaptureOptions & { target?: HTMLElement },
): Promise<Blob> {
  const target = opts.target ?? document.body;
  const pixelRatio = opts.pixelRatio ?? Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  const toImage = (opts.format ?? 'jpeg') === 'png' ? toPng : toJpeg;
  const dataURL = await toImage(target, {
    pixelRatio,
    backgroundColor: opts.backgroundColor ?? bgFor(opts.colorMode),
    filter: opts.filter,
    quality: opts.quality ?? 0.92,
  });
  const img = await loadImage(dataURL);
  const { sx, sy, sw, sh } = cropSourceRect(selection, target.getBoundingClientRect(), pixelRatio);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw);
  canvas.height = Math.round(sh);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get a 2D canvas context for cropping');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvasToBlob(canvas, (opts.format ?? 'jpeg') === 'png' ? 'image/png' : 'image/jpeg', opts.quality ?? 0.92);
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
