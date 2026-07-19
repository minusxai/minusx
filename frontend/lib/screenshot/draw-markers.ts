/**
 * Paint the numbered position-marker gutter onto an already-captured content canvas (browser-only).
 *
 * WHY a post-capture draw (not CSS): the agent image is capped hard (AGENT_IMAGE_MAX_PX = 512), so a
 * ~1280px story is captured at ~0.4×. A CSS gutter in the live page would shrink with the content and
 * the numbers would be illegible. Drawing here, AFTER the content is scaled, lets the badges be sized
 * in FIXED output pixels — always legible — while only their POSITION tracks the content (band-top y ×
 * the capture's vertical scale). One helper, fed by all three story renderers (canvas/svg/dom) plus
 * dashboards/questions, so the numbering is identical everywhere.
 *
 * The gutter is added as extra width on the LEFT; the content is drawn shifted right by it, so numbers
 * never sit on top of content. Marker geometry (which labels, at what document y) is the pure module.
 */
import { pageMarkers, MARKER_CADENCE_PX } from './page-markers';

/** Fixed OUTPUT-pixel width of the marker gutter — wide enough for a 2-digit badge at MARKER_FONT_PX. */
export const MARKER_GUTTER_PX = 40;
/** Fixed OUTPUT-pixel font size for badges — legible on a 512px-wide agent image regardless of shrink. */
const MARKER_FONT_PX = 19;

interface GutterOpts {
  /** Full CSS-pixel height of the captured document (element.offsetHeight / svg or surface box height). */
  docHeightCssPx: number;
  colorMode: 'light' | 'dark';
  cadencePx?: number;
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/**
 * Return a NEW canvas = [gutter | content] with numbered badges down the gutter. On any failure
 * (no 2D context) returns the original content unchanged, so a drawing hiccup never drops the image.
 */
export function drawMarkerGutter(content: HTMLCanvasElement, opts: GutterOpts): HTMLCanvasElement {
  if (!(opts.docHeightCssPx > 0) || content.width === 0 || content.height === 0) return content;
  const gutter = MARKER_GUTTER_PX;
  const out = document.createElement('canvas');
  out.width = content.width + gutter;
  out.height = content.height;
  const ctx = out.getContext('2d');
  if (!ctx) return content;

  const dark = opts.colorMode === 'dark';
  // Gutter strip — a calm band, clearly not part of the content.
  ctx.fillStyle = dark ? '#161B22' : '#EEF1F4';
  ctx.fillRect(0, 0, gutter, out.height);
  ctx.drawImage(content, gutter, 0);

  // Output px per CSS px: content.height already equals docHeightCss × captureScale.
  const vscale = content.height / opts.docHeightCssPx;
  const markers = pageMarkers(opts.docHeightCssPx, opts.cadencePx ?? MARKER_CADENCE_PX);
  const cx = gutter / 2;

  ctx.font = `600 ${MARKER_FONT_PX}px ui-monospace, "SF Mono", Menlo, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const m of markers) {
    const bandTop = m.y * vscale;
    // Faint divider across the gutter at the band boundary (skip the very top edge).
    if (bandTop > 0.5) {
      ctx.strokeStyle = dark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(bandTop) + 0.5);
      ctx.lineTo(gutter, Math.round(bandTop) + 0.5);
      ctx.stroke();
    }
    const label = String(m.label);
    // Badge sits just below the band top; clamp so the last band's badge stays on-canvas.
    const badgeH = MARKER_FONT_PX + 6;
    const cy = Math.min(out.height - badgeH / 2 - 2, bandTop + badgeH / 2 + 3);
    const badgeW = Math.max(badgeH, MARKER_FONT_PX * 0.62 * label.length + 12);
    ctx.fillStyle = dark ? '#0D1117' : '#FFFFFF';
    roundRectPath(ctx, cx - badgeW / 2, cy - badgeH / 2, badgeW, badgeH, 5);
    ctx.fill();
    ctx.strokeStyle = dark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = dark ? '#E6EDF3' : '#1F2328';
    ctx.fillText(label, cx, cy + 0.5);
  }
  return out;
}
