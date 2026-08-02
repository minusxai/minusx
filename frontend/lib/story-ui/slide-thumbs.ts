/**
 * Slide thumbnails — real slide content in the birds-eye rail, from ONE capture.
 *
 * The story surface is serialized once (`serializeStorySvg` — the same pipeline the OG
 * share card uses), rasterized once, and each slide is cropped out of that single image
 * as a small JPEG data URL. One serialize per rebuild keeps the cost independent of the
 * slide count; JPEG crops (rather than reusing the multi-MB SVG data URL per entry) keep
 * the rail cheap to decode and free of references to the live document.
 *
 * Everything degrades to null — the rail falls back to its title list; thumbnails are an
 * enhancement, never a gate.
 */
import { findStorySvg, serializeStorySvg, svgToImage } from '@/lib/story-surface/serialize';

/** A thumb is at most this many times taller than wide; taller slides crop from their top. */
export const THUMB_MAX_ASPECT = 2;

/** Vertical band of one slide, in surface (svg) coordinates. */
export interface SlideBand {
  top: number;
  height: number;
}

export interface ThumbCrop {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dw: number;
  dh: number;
}

/** Pure crop geometry: source rect in surface px, dest size in device px. */
export function thumbCropRects(
  surfaceW: number,
  bands: SlideBand[],
  thumbW: number,
  dpr: number,
): ThumbCrop[] {
  const scale = (thumbW / surfaceW) * dpr;
  return bands.map((b) => {
    const sh = Math.max(1, Math.min(b.height, surfaceW * THUMB_MAX_ASPECT));
    return {
      sx: 0,
      sy: b.top,
      sw: surfaceW,
      sh,
      dw: Math.max(1, Math.round(thumbW * dpr)),
      dh: Math.max(1, Math.round(sh * scale)),
    };
  });
}

/**
 * Capture one JPEG data URL per slide. `frame` is the story iframe in the parent
 * document; `slideEls` live inside it (same document as the surface svg, so band offsets
 * are plain rect arithmetic). Returns null when the surface isn't ready or canvas is
 * unavailable — callers keep whatever they had.
 */
export async function captureSlideThumbnails(
  frame: HTMLIFrameElement,
  slideEls: HTMLElement[],
  thumbW = 176,
): Promise<string[] | null> {
  try {
    const svg = findStorySvg(frame);
    if (!svg) return null;
    const box = svg.getBoundingClientRect();
    if (!box.width || !box.height) return null;
    const bands = slideEls.map((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top - box.top, height: r.height };
    });
    if (bands.some((b) => b.height <= 0)) return null;
    const img = await svgToImage(await serializeStorySvg(svg));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const crops = thumbCropRects(box.width, bands, thumbW, dpr);
    const out: string[] = [];
    for (const c of crops) {
      const canvas = document.createElement('canvas');
      canvas.width = c.dw;
      canvas.height = c.dh;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      // JPEG has no alpha; themes paint their own ground over this.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, c.dw, c.dh);
      ctx.drawImage(img, c.sx, c.sy, c.sw, c.sh, 0, 0, c.dw, c.dh);
      out.push(canvas.toDataURL('image/jpeg', 0.8));
    }
    return out;
  } catch {
    return null;
  }
}
