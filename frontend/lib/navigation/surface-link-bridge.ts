/**
 * Client-side navigation for links inside a document surface (story / dashboard iframe).
 *
 * A rendered document mounts a NESTED React root inside its iframe document. React context does
 * not cross roots, so `next/link` in there sees a null `AppRouterContext` and returns early from
 * its click handler without calling `preventDefault()` — the browser then performs the anchor's
 * default navigation, which `<base target="_top">` sends to the top window as a FULL document
 * load. Everything client-side is thrown away with it: the Redux store, and with it an unsent
 * side-chat draft.
 *
 * Rather than re-provide Next's private router contexts into the nested root, the surface bridges
 * at the DOM: one delegated click listener on the iframe document turns a same-origin anchor
 * click into a router navigation. It covers plain `<a>`s as well as `<Link>`s, and it is the only
 * place that can also restore `mode`/`as_user`/`view` — `components/ui/Link.tsx` reads those from
 * `useSearchParams()`, which is likewise contextless inside the surface and silently yields none.
 *
 * `<base target="_top">` stays: it is the correct behaviour for everything this bridge declines
 * (cross-origin author links), which must never load the app inside the surface.
 */
import { preserveParams } from '@/lib/navigation/url-utils';

/** A click the browser should keep handling itself: new tab/window, download, or non-primary. */
function isBrowserOwnedClick(e: MouseEvent, a: HTMLAnchorElement): boolean {
  return (
    e.button !== 0 ||
    e.metaKey || e.ctrlKey || e.shiftKey || e.altKey ||
    a.hasAttribute('download') ||
    // The element's own attribute only — `<base target="_top">` does not set it, and _top is
    // exactly the fallback we are replacing.
    !!a.getAttribute('target')
  );
}

/**
 * Route same-origin anchor clicks inside `doc` through `navigate` instead of the browser.
 * Returns a disposer; call it when the surface is torn down.
 */
export function bridgeSurfaceLinks(doc: Document, navigate: (href: string) => void): () => void {
  const onClick = (e: MouseEvent) => {
    // A handler closer to the anchor already claimed this click (dashboard edit mode cancels
    // tile-title navigation so a drag doesn't open the question).
    if (e.defaultPrevented) return;
    const target = e.target as Element | null;
    const a = target?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a || isBrowserOwnedClick(e, a)) return;

    let url: URL;
    try {
      url = new URL(a.href, doc.baseURI);
    } catch {
      return;
    }
    // The surface iframe is same-origin with the app, so the top window's origin is the app's.
    if (url.origin !== window.location.origin) return;

    e.preventDefault();
    // `preserveParams` falls back to `window.location.search` — the TOP window's, since this code
    // runs in the parent realm. That is the query string the user is actually browsing under.
    navigate(preserveParams(url.pathname + url.search) + url.hash);
  };

  doc.addEventListener('click', onClick);
  return () => doc.removeEventListener('click', onClick);
}
