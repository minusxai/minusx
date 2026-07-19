/**
 * Read where the user is currently scrolled within a file view and turn it into the `<Viewport>`
 * pointer text (browser-only). Thin DOM glue over the pure marker math (page-markers.ts) — the
 * geometry is unit-tested there; here we only read the live scroll position.
 *
 * The file view ([data-file-id]) is laid out at its full height in the page, so the WINDOW scrolls,
 * not the element: `-rect.top` is how far the document's top has scrolled above the viewport's top.
 */
import { visibleMarkers, formatViewportPointer, markerCount } from './page-markers';

export function readViewportPointer(fileId: number): string | null {
  if (typeof document === 'undefined' || typeof window === 'undefined') return null;
  const el = document.querySelector(`[data-file-id="${fileId}"]`) as HTMLElement | null;
  if (!el) return null;
  const docHeight = el.offsetHeight;
  if (!(docHeight > 0)) return null;
  // A page that fits in a single marker band has no "where am I" to report — skip the block entirely.
  const total = markerCount(docHeight);
  if (total <= 1) return null;
  const scrollTop = Math.max(0, -el.getBoundingClientRect().top);
  const visible = visibleMarkers(scrollTop, window.innerHeight, docHeight);
  return formatViewportPointer(visible, total);
}
