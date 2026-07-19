/**
 * Page position markers — a fixed-pixel numbering grid laid over a captured file view so the agent
 * has a spatial map of the page AND can be told where the user is currently looking.
 *
 * Two halves, deliberately decoupled for prompt caching:
 *  - The MARKERS are drawn into the captured image (see lib/screenshot/capture.ts). The image is keyed
 *    by CONTENT, so it stays byte-stable across turns while the content is unchanged → cached prefix.
 *  - The POINTER (which markers the viewport currently spans) is emitted as a tiny separate `<Viewport>`
 *    text block in the message tail (mirroring `<CurrentTime>`), so scrolling rewrites ~10 tokens and
 *    never invalidates the AppState block or the image before it.
 *
 * The cadence is a fixed number of DOCUMENT pixels — NOT a fraction of the viewport — so the numbered
 * image is identical regardless of the capturing user's window size (a viewport-relative grid would
 * make the "constant" image differ per screen and defeat the caching).
 *
 * Bands are half-open [0,C), [C,2C), … labelled 1,2,3… from the top; a y in document space belongs to
 * band `floor(y/C)+1`. Pure (no DOM) so it unit-tests without a browser; the capture layer and the
 * agent are thin glue over this.
 */

/** Document pixels between markers. One marker roughly every ~⅔ of a laptop viewport. */
export const MARKER_CADENCE_PX = 600;

/** Number of marker bands for a document of `docHeightPx` (at least 1). */
export function markerCount(docHeightPx: number, cadencePx: number = MARKER_CADENCE_PX): number {
  if (!(docHeightPx > 0) || !(cadencePx > 0)) return 1;
  return Math.max(1, Math.ceil(docHeightPx / cadencePx));
}

/** Document-space y (px) where marker `label` (1-indexed) is drawn — the TOP of its band. */
export function markerY(label: number, cadencePx: number = MARKER_CADENCE_PX): number {
  return (Math.max(1, Math.floor(label)) - 1) * cadencePx;
}

/** Every marker label + its document-space y for a page. */
export function pageMarkers(
  docHeightPx: number,
  cadencePx: number = MARKER_CADENCE_PX,
): Array<{ label: number; y: number }> {
  const n = markerCount(docHeightPx, cadencePx);
  return Array.from({ length: n }, (_, i) => ({ label: i + 1, y: i * cadencePx }));
}

/** The marker band a document-space y falls in (1-indexed, clamped to [1, total]). */
function bandOf(y: number, cadencePx: number, total: number): number {
  return Math.min(total, Math.max(1, Math.floor(Math.max(0, y) / cadencePx) + 1));
}

/**
 * Which marker bands the viewport currently spans, plus the band under its vertical center.
 * `scrollTop` is the document-space y of the viewport's top edge (0 = top of the page); a negative
 * value (scrolled above the content) clamps to the first band.
 */
export function visibleMarkers(
  scrollTop: number,
  viewportHeight: number,
  docHeightPx: number,
  cadencePx: number = MARKER_CADENCE_PX,
): { first: number; last: number; centered: number } {
  const total = markerCount(docHeightPx, cadencePx);
  const topY = Math.max(0, scrollTop);
  const bottomY = Math.max(topY, scrollTop + Math.max(0, viewportHeight));
  return {
    first: bandOf(topY, cadencePx, total),
    last: bandOf(bottomY, cadencePx, total),
    centered: bandOf(topY + Math.max(0, viewportHeight) / 2, cadencePx, total),
  };
}

/**
 * Human/agent-facing pointer text for the `<Viewport>` block. Single band → "section N of T";
 * a range → "sections F–L of T", always naming the centered band the user is focused on.
 */
export function formatViewportPointer(
  v: { first: number; last: number; centered: number },
  total: number,
): string {
  const where =
    v.first === v.last
      ? `section ${v.first} of ${total}`
      : `sections ${v.first}–${v.last} of ${total} (centered on ${v.centered})`;
  return `The user is viewing ${where}.`;
}
