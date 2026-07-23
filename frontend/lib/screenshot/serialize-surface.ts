/**
 * Live-svg SURFACE capture for main-document views (Renderer_v2 Phase 4, Option B2).
 *
 * A dashboard's content renders inside `<svg data-mx-surface-svg><foreignObject>` in the MAIN
 * document (SvgPageSurface). Capture serializes THAT live svg — the capture IS the renderer the
 * user is looking at — instead of cloning the subtree into a freshly built wrapper.
 *
 * Differs from the story serializer (lib/story-surface/serialize.ts) in exactly one axis: a story
 * iframe is self-contained (its styles are <style> tags in its own head), while a main-document
 * surface depends on the PARENT DOCUMENT's stylesheets (compiled Tailwind link sheet, emotion
 * CSSOM rules) — so CSS is collected the same way the generic element path does, with url() refs
 * inlined. The fixup pass (scroll baking, form-value stamping, canvas stamps, transient-portal
 * drop, image inlining) is shared with that path.
 */
import { applyScrollOffsets, stampFormValues } from '@/lib/story-surface/serialize';
import {
  collectDocumentCss,
  inlineCssUrls,
  inlineImageSources,
  stampCanvases,
  TRANSIENT_PORTAL_SELECTOR,
} from './serialize-element';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Marks a main-document `<svg>` hosting view content — the capture path serializes this. */
export const SURFACE_SVG_ATTR = 'data-mx-surface-svg';

/** The live surface svg hosted inside `element` (main document — NOT inside an iframe), or null. */
export function findSurfaceSvg(element: HTMLElement): SVGSVGElement | null {
  if (element instanceof SVGSVGElement && element.hasAttribute(SURFACE_SVG_ATTR)) return element;
  return element.querySelector(`svg[${SURFACE_SVG_ATTR}]`) as SVGSVGElement | null;
}

/**
 * Serialize the live surface svg into a standalone, self-contained SVG string: document CSS
 * inlined, fixup pass applied to the parsed copy (live DOM untouched), theme hosts stamped.
 * Rasterize the result with `svgToImage` (percent-encoded data: URL — never a Blob URL).
 */
export async function serializeSurfaceSvg(svg: SVGSVGElement): Promise<string> {
  const doc = svg.ownerDocument;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const liveRoot = svg.querySelector('foreignObject > *');
  const cloneRoot = clone.querySelector('foreignObject > *');
  if (liveRoot && cloneRoot) {
    // Lockstep fixups first (need structural identity), then structural drops.
    applyScrollOffsets(liveRoot, cloneRoot);
    stampFormValues(liveRoot, cloneRoot);
    stampCanvases(liveRoot, cloneRoot);
    cloneRoot.querySelectorAll(TRANSIENT_PORTAL_SELECTOR).forEach((n) => n.remove());
    await inlineImageSources(cloneRoot, doc.baseURI);
    // Color-mode stamp: the serialized document has no <html>, so `.dark`-scoped rules need the
    // mode class in the copy. It goes on the cloned <svg> ROOT — NOT the foreignObject root:
    // that root IS the statically-rendered `[data-mx-theme-host]` (SvgPageSurface), and the dark
    // token block is the DESCENDANT selector `.dark [data-mx-theme-host]`, which a same-element
    // stamp can never match (live it matches via `<html class="dark">`; the copy has no <html> —
    // this was the light-chrome dark-dashboard capture bug).
    const mode = doc.documentElement.classList.contains('dark') ? 'dark' : 'light';
    const svgCls = clone.getAttribute('class');
    clone.setAttribute('class', `${svgCls ? `${svgCls} ` : ''}${mode}`);
  }

  // Explicit intrinsic size: an <img>-rendered SVG without width/height attributes has no
  // reliable intrinsic size (engines disagree, default 300x150 clips the grid).
  if (!clone.getAttribute('width') || !clone.getAttribute('height')) {
    const box = svg.getBoundingClientRect();
    const w = box.width || svg.width?.baseVal?.value || 0;
    const h = box.height || svg.height?.baseVal?.value || 0;
    if (w) clone.setAttribute('width', String(w));
    if (h) clone.setAttribute('height', String(h));
  }

  const css = await inlineCssUrls(collectDocumentCss(doc), doc.baseURI);
  if (css.trim()) {
    const style = doc.createElementNS(SVG_NS, 'style');
    style.textContent = css;
    clone.insertBefore(style, clone.firstChild);
  }
  // No manual xmlns attribute: the clone is SVG-namespaced, so XMLSerializer emits the
  // declaration itself; setting it as an attribute too would serialize a duplicate.
  return new XMLSerializer().serializeToString(clone);
}
