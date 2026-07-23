/**
 * Paint the numbered position markers onto an already-captured content canvas (browser-only).
 *
 * PARITY with the live overlay is the contract (user directive): the captured markers are the
 * SAME badges and dashed band lines `PageMarkerDevOverlay` renders — same left inset, same
 * 22px/13px geometry, same colors — drawn in CONTENT scale, inside the dedicated left padding
 * every marker-flagged main-document view reserves (`MARKER_GUTTER_CSS_PX`; stories rely on
 * their authored margins). The canvas is never widened and badges never drift onto content:
 * what the agent sees is pixel-for-pixel what the reader sees.
 */
import { pageMarkers, MARKER_CADENCE_PX } from './page-markers';

/** CSS-pixel gutter marker-flagged views reserve (Tailwind pl-10) — the badges' home. */
export const MARKER_GUTTER_CSS_PX = 40;
/** Live-overlay badge geometry (PageMarkerDevOverlay) — the capture mirrors these exactly. */
const BADGE_LEFT_CSS = 4;
const BADGE_TOP_CSS = 4;
const BADGE_SIZE_CSS = 22;
const BADGE_FONT_CSS = 13;

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
 * Draw the numbered markers ONTO the content canvas (no widening — overlay semantics) and return
 * it. On any failure (no 2D context) returns the content unchanged, so a drawing hiccup never
 * drops the image.
 */
export function drawMarkerGutter(content: HTMLCanvasElement, opts: GutterOpts): HTMLCanvasElement {
  if (!(opts.docHeightCssPx > 0) || content.width === 0 || content.height === 0) return content;
  const ctx = content.getContext('2d');
  if (!ctx) return content;

  const dark = opts.colorMode === 'dark';
  // Output px per CSS px: content.height already equals docHeightCss × captureScale. Everything
  // below is the live overlay's CSS geometry multiplied by this one scale — parity by
  // construction.
  const s = content.height / opts.docHeightCssPx;
  const markers = pageMarkers(opts.docHeightCssPx, opts.cadencePx ?? MARKER_CADENCE_PX);
  const lineW = Math.max(1, s);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const m of markers) {
    const bandTop = m.y * s;
    // Faint dashed divider across the CONTENT at the band boundary (skip the very top edge) —
    // the same 1px dashed border-top the live overlay draws.
    if (bandTop > 0.5) {
      ctx.strokeStyle = dark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.14)';
      ctx.lineWidth = lineW;
      ctx.setLineDash([4 * s, 4 * s]);
      ctx.beginPath();
      ctx.moveTo(0, Math.round(bandTop) + 0.5);
      ctx.lineTo(content.width, Math.round(bandTop) + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const label = String(m.label);
    // Badge box: the overlay's 22px/13px geometry at content scale, with a LEGIBILITY FLOOR of
    // 14 output px (an agent image at ~0.45× would otherwise carry ~6px numerals). The floored
    // badge still fits the reserved 40px-CSS gutter at agent scale, so it never crosses into
    // content — position and style stay identical to the live overlay.
    const badgeH = Math.max(BADGE_SIZE_CSS * s, 14);
    const font = Math.max(BADGE_FONT_CSS * s, badgeH - 9);
    ctx.font = `600 ${font}px ui-monospace, "SF Mono", Menlo, monospace`;
    const badgeW = Math.max(badgeH, font * 0.62 * label.length + 8);
    const bx = BADGE_LEFT_CSS * s;
    // Clamp so the last band's badge stays on-canvas.
    const by = Math.min(content.height - badgeH - 2, bandTop + BADGE_TOP_CSS * s);
    ctx.fillStyle = dark ? '#0D1117' : '#FFFFFF';
    roundRectPath(ctx, bx, by, badgeW, badgeH, Math.max(3, 5 * s));
    ctx.fill();
    ctx.strokeStyle = dark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)';
    ctx.lineWidth = lineW;
    ctx.stroke();
    ctx.fillStyle = dark ? '#E6EDF3' : '#1F2328';
    ctx.fillText(label, bx + badgeW / 2, by + badgeH / 2 + 0.5);
  }
  return content;
}
