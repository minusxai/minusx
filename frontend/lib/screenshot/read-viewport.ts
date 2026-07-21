/**
 * Read where the user is currently scrolled within a file view and turn it into the `<Viewport>`
 * pointer text (browser-only). Thin DOM glue over the pure marker math (page-markers.ts) — the
 * geometry is unit-tested there; here we only read the live scroll position.
 *
 * The file view ([data-file-id]) is laid out at its full height in the page, so the WINDOW scrolls,
 * not the element: `-rect.top` is how far the document's top has scrolled above the viewport's top.
 *
 * On top of the window position, the pointer carries PER-ELEMENT scroll offsets (Story_Design_V2
 * §4): internal scroll (a wide table, a code pane) is DOM state — the capture bakes it in visually
 * as transforms, and this is the matching TEXTUAL fix so the agent knows what is scrolled where.
 */
import { visibleMarkers, formatViewportPointer, markerCount } from './page-markers';

/** Short human/agent-readable descriptor for a scrolled element: aria-label > #id > tag. */
function describeElement(el: Element): string {
  const label = el.getAttribute('aria-label');
  if (label) return `${el.tagName.toLowerCase()} "${label}"`;
  if (el.id) return `${el.tagName.toLowerCase()}#${el.id}`;
  return el.tagName.toLowerCase();
}

/**
 * Per-element scroll offsets within the captured file view, as one line of pointer text — or null
 * when nothing inside the view is scrolled. Generalizes the story `<Viewport>` pointer to every
 * internally-scrolled element of the surface.
 */
export function readScrollOffsets(fileId: number): string | null {
  if (typeof document === 'undefined') return null;
  const root = document.querySelector(`[data-file-id="${fileId}"]`) as HTMLElement | null;
  if (!root) return null;
  const parts: string[] = [];
  for (const el of Array.from(root.querySelectorAll('*'))) {
    const left = (el as HTMLElement).scrollLeft ?? 0;
    const top = (el as HTMLElement).scrollTop ?? 0;
    if (!left && !top) continue;
    parts.push(`${describeElement(el)} scrolled to (x=${Math.round(left)}px, y=${Math.round(top)}px)`);
  }
  if (parts.length === 0) return null;
  return `Scrolled elements in the view: ${parts.join('; ')}.`;
}

export function readViewportPointer(fileId: number): string | null {
  if (typeof document === 'undefined' || typeof window === 'undefined') return null;
  const el = document.querySelector(`[data-file-id="${fileId}"]`) as HTMLElement | null;
  if (!el) return null;
  const offsets = readScrollOffsets(fileId);
  const docHeight = el.offsetHeight;
  // A page that fits in a single marker band has no "where am I" to report — the pointer is only
  // the per-element offsets (or nothing at all).
  const total = docHeight > 0 ? markerCount(docHeight) : 0;
  if (total <= 1) return offsets;
  const scrollTop = Math.max(0, -el.getBoundingClientRect().top);
  const visible = visibleMarkers(scrollTop, window.innerHeight, docHeight);
  const pointer = formatViewportPointer(visible, total);
  return offsets ? `${pointer} ${offsets}` : pointer;
}
