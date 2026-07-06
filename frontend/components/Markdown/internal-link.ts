/**
 * True for same-origin app routes that should navigate client-side (Next router)
 * rather than via a plain <a> (which hard-reloads the page and wipes Redux state).
 *
 * Covers relative app paths — including ones the old "/^\/f\/\d+$/"-only check
 * missed: folders (`/p/...`), file links with a query/hash (`/f/5?mode=tutorial`,
 * `/f/5#x`) — and absolute URLs pointing at our own origin. Genuinely external
 * links (other origins, protocol-relative, `mailto:`, bare `#anchor`) return false.
 */
export function isInternalAppLink(href: string | undefined): boolean {
  if (!href) return false;
  if (href.startsWith('//')) return false;   // protocol-relative → external
  if (href.startsWith('/')) return true;     // relative app path
  // Absolute URL to our own origin (browser only).
  if (typeof window !== 'undefined') {
    try {
      return new URL(href, window.location.origin).origin === window.location.origin;
    } catch {
      return false;
    }
  }
  return false;
}
