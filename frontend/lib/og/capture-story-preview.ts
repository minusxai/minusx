/**
 * Capture a story's social-share card, client-side, when the story is made public.
 *
 * Screenshots the rendered story (charts + custom CSS, inside its shadow root) via snapdom and
 * POSTs it to the preview route, which composes the final card (blur + title + logo) and stores it.
 * Best-effort — returns true on success, false on failure (e.g. the story isn't on-screen).
 * Requires the `[data-story-capture]` element, present when the share modal opens over the story page.
 */
import { snapdom } from '@zumer/snapdom';
import { AGENT_IMAGE_JPEG_QUALITY } from '@/lib/screenshot/constants';
import { findStorySvg, serializeStorySvg, svgToImage } from '@/lib/story-surface/serialize';

const OG_ASPECT = 1200 / 630;
const OG_SOURCE_W = 1200; // render the card source ~1200px wide

/**
 * Rasterize an SVG-rendered story by serializing its live surface. Returns null when the story isn't
 * on the SVG renderer, so the caller falls back to snapdom.
 */
async function captureSvgStorySource(el: HTMLElement, scale: number): Promise<CanvasImageSource | null> {
  const svg = findStorySvg(el);
  if (!svg) return null;
  const box = svg.getBoundingClientRect();
  if (!box.width || !box.height) return null;
  const img = await svgToImage(await serializeStorySvg(svg));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(box.width * scale));
  c.height = Math.max(1, Math.round(box.height * scale));
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

export async function captureStoryPreview(fileId: number): Promise<boolean> {
  try {
    const el = document.querySelector(`[data-story-capture="${fileId}"]`) as HTMLElement | null;
    const width = el?.offsetWidth ?? 0;
    if (!el || !width) return false;
    // Render the whole story at ~1200px wide, then crop the TOP BAND to the OG aspect (the card only
    // shows the story header). snapdom captures the shadow-root content + styles; dpr:1 keeps `scale`
    // as the literal pixel ratio so the source is exactly width*scale.
    const scale = Math.max(1, OG_SOURCE_W / width);
    // SVG-rendered story: rasterize by serializing the live surface (no snapdom). Falls through to
    // snapdom for the DOM/canvas renderers.
    const source = (await captureSvgStorySource(el, scale))
      ?? await snapdom.toCanvas(el, { scale, dpr: 1, backgroundColor: '#ffffff', embedFonts: true });
    const outW = Math.round(width * scale);
    const outH = Math.round((width / OG_ASPECT) * scale);
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.drawImage(source, 0, 0, outW, outH, 0, 0, outW, outH);
    const screenshot = canvas.toDataURL('image/jpeg', AGENT_IMAGE_JPEG_QUALITY);
    const res = await fetch(`/api/files/${fileId}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ screenshot }),
    });
    return res.ok;
  } catch (err) {
    console.warn('[story-og] preview capture failed:', err);
    return false;
  }
}
