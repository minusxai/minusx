'use client';

/**
 * Bridge between the canvas story renderer and the screenshot/crop pipeline.
 *
 * When a story renders on canvas, CanvasStoryView registers a provider that can draw
 * any region of the story (takumi raster + idle-cached island bitmaps) into a target
 * context. Captures compose small output canvases directly from the source bitmaps —
 * no snapdom and no full-story intermediate canvas on the capture path.
 *
 * The provider lives on `window` (not module state): bundlers can duplicate this
 * module across chunk graphs, and a module-level variable would then be null in
 * the consumer's copy while set in the producer's.
 */

export interface CanvasStoryCaptureProvider {
  /** The on-screen story surface (for geometry checks). */
  surface: () => HTMLCanvasElement | null;
  /** Full story size in device pixels. */
  size: () => { width: number; height: number } | null;
  /** Draw story region [sx,sy,sw,sh] (device px) into ctx at [dx,dy,dw,dh]. */
  drawRegion: (
    ctx: CanvasRenderingContext2D,
    sx: number, sy: number, sw: number, sh: number,
    dx: number, dy: number, dw: number, dh: number,
  ) => boolean;
}

interface ProviderHost { __mxCanvasStoryCapture?: CanvasStoryCaptureProvider }

export function registerCanvasStoryCapture(p: CanvasStoryCaptureProvider): () => void {
  if (typeof window === 'undefined') return () => {};
  (window as unknown as ProviderHost).__mxCanvasStoryCapture = p;
  return () => {
    const host = window as unknown as ProviderHost;
    if (host.__mxCanvasStoryCapture === p) host.__mxCanvasStoryCapture = undefined;
  };
}

export function getCanvasStoryCapture(): CanvasStoryCaptureProvider | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as ProviderHost).__mxCanvasStoryCapture ?? null;
}
