/**
 * The story SURFACE: where a story's body lives inside its iframe document, and how big it is.
 *
 * This module owns the whole DOM-vs-SVG difference behind one narrow interface, so AgentHtml stays a
 * thin composition: it builds the iframe document, then asks the surface for `root` (the element the
 * story body renders into — everything downstream, embeds/editing/serialization, targets that) and
 * hands it to `autoSizeStorySurface()`, which keeps it sized to its container for as long as it is
 * mounted. Nothing outside this module branches on the renderer, and nothing outside it re-derives
 * the sizing order.
 *
 * Two surfaces:
 *  - 'dom'  — the classic path: the story body IS `document.body`. Height = body.scrollHeight.
 *  - 'svg'  — the body is mounted inside `<svg><foreignObject>` in the same iframe (isolation is the
 *             iframe's job either way). It renders identically — foreignObject content is real, live,
 *             interactive DOM (contentEditable/focus/hit-testing all verified) — but the surface can
 *             then be RASTERIZED by serializing that live <svg> — no pixel re-derivation. Because an <svg> does NOT auto-size to its foreignObject content (it
 *             defaults to 150px), the svg + foreignObject height must be set explicitly from the
 *             measured content on every sync — that's the one real cost of this surface. The same
 *             holds in the other axis for a FLUID caller: an <svg> is exactly as wide as it was
 *             told, so the measured container width must be pushed in too (applyWidth), or the
 *             story lays out at the logical canvas width inside a narrower iframe and is clipped.
 */
/**
 * The surfaces AgentHtml can mount into. 'svg' is the default and the only production render path
 * (Story_Design_V2 §4); 'dom' is kept as the abstraction's second implementation, not selectable
 * via any config.
 */
export type StorySurfaceKind = 'dom' | 'svg';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XHTML_NS = 'http://www.w3.org/1999/xhtml';

/**
 * The LOGICAL canvas width a story is authored against (StoryView's reading column caps here, and
 * the story prompt's container-query breakpoints are written for it). Lives in the surface module
 * because it is a story-domain sizing fact, not a component detail: server-side capture needs it to
 * render the layout a READER sees, and importing a component just for a number would be worse.
 */
export const STORY_CANVAS_WIDTH = 1280;

/** Marks the <svg> that hosts a story surface, so the capture path can find it. */
export const STORY_SVG_ATTR = 'data-mx-story-svg';
/** Marks the story root element inside the surface (the element the body HTML is written into). */
export const STORY_ROOT_ATTR = 'data-mx-story-root';

export interface StorySurface {
  /** The element the story body HTML lives in. Embeds, editing and serialization all target this. */
  readonly root: HTMLElement;
  /** The <svg> hosting the story, or null for the DOM surface. The capture path serializes this. */
  readonly svg: SVGSVGElement | null;
  /** Content height in CSS px — what the iframe should be sized to. */
  measureHeight(): number;
  /** Push the measured height into the surface (no-op for DOM; sizes svg+foreignObject for SVG). */
  applyHeight(height: number): void;
  /**
   * Push a MEASURED width into the surface — for FLUID callers only (a fixed-canvas caller simply
   * never calls this and stays pinned to the width it mounted with).
   *
   * Same explicit-sizing problem as `applyHeight`, in the other axis: an <svg>'s width is whatever
   * it was given, and the story root lays out at THAT width no matter how wide the iframe is. So a
   * fluid caller (100%-wide iframe, logical canvas width) must push the container's real width in,
   * or every narrower container clips the story — and, because captures serialize this same live
   * <svg>, bakes the invisible overflow into the screenshot. No-op for DOM, whose root IS the body
   * and is therefore already 100% of the iframe.
   */
  applyWidth(width: number): void;
}

/**
 * Mount a surface into a freshly written iframe document. `doc.body` must be empty; the caller
 * writes the story HTML into `surface.root` afterwards.
 */
export function mountStorySurface(doc: Document, kind: StorySurfaceKind, width: number): StorySurface {
  return kind === 'svg' ? svgSurface(doc, width) : domSurface(doc);
}

function domSurface(doc: Document): StorySurface {
  const root = doc.body;
  root.setAttribute(STORY_ROOT_ATTR, '');
  return {
    root,
    svg: null,
    measureHeight: () => root.scrollHeight,
    applyHeight: () => { /* the body is the surface — the iframe height is the only knob */ },
    applyWidth: () => { /* the body is the surface — it is already 100% of the iframe */ },
  };
}

function svgSurface(doc: Document, width: number): StorySurface {
  const svg = doc.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  svg.setAttribute('xmlns', SVG_NS);
  svg.setAttribute(STORY_SVG_ATTR, '');
  svg.setAttribute('width', String(width));
  // Height is set by applyHeight; without it the svg would sit at the 150px default.
  svg.setAttribute('height', '0');
  svg.style.display = 'block';
  svg.style.overflow = 'visible';

  const fo = doc.createElementNS(SVG_NS, 'foreignObject');
  fo.setAttribute('x', '0');
  fo.setAttribute('y', '0');
  fo.setAttribute('width', String(width));
  fo.setAttribute('height', '0');

  // The story root must carry the XHTML namespace: inside SVG, an un-namespaced <div> is parsed as
  // an unknown SVG element and never renders. This also makes the subtree serialize back correctly.
  const root = doc.createElementNS(XHTML_NS, 'div') as unknown as HTMLElement;
  root.setAttribute('xmlns', XHTML_NS);
  root.setAttribute(STORY_ROOT_ATTR, '');

  fo.appendChild(root);
  svg.appendChild(fo);
  doc.body.appendChild(svg);

  return {
    root,
    svg,
    measureHeight: () => root.scrollHeight,
    applyHeight: (height: number) => {
      const h = String(Math.max(0, Math.ceil(height)));
      // Both must grow: the foreignObject clips its content, and the svg clips the foreignObject.
      if (fo.getAttribute('height') !== h) fo.setAttribute('height', h);
      if (svg.getAttribute('height') !== h) svg.setAttribute('height', h);
    },
    applyWidth: (width: number) => {
      // Rounded DOWN, unlike height: a surface WIDER than the container that measured it is exactly
      // the failure mode this exists to prevent (the caller's overflow-x is hidden, so the extra
      // sub-pixel would be clipped, not scrolled). A sub-pixel narrower just reflows.
      const w = String(Math.max(0, Math.floor(width)));
      // Change-guarded like applyHeight — the caller drives this from a ResizeObserver, where a
      // redundant attribute write would re-trigger the observer instead of settling.
      if (fo.getAttribute('width') !== w) fo.setAttribute('width', w);
      if (svg.getAttribute('width') !== w) svg.setAttribute('width', w);
    },
  };
}

/**
 * FLUID (narrow-container / mobile) shim: cap fixed-width chart embeds and media to the container so
 * the authored layout REFLOWS instead of overflowing. Injected INTO the surface root by the caller —
 * on the SVG surface it must sit inside the serialized subtree, or a capture would render without it
 * (uncapped chart widths). Never touches <canvas>.
 *
 * Lives here, next to `applyWidth`, because it is the other half of the same contract: the surface
 * tracks the container's width, and this keeps the authored content inside it.
 */
export const STORY_FLUID_SHIM_CSS =
  // Block chart embeds — saved (data-question-id) AND inline (data-question-inline). The inline
  // selector was missing, so an inline chart authored wider than the viewport (e.g. width:1100px)
  // overflowed the canvas and got cut off with the chat panel open; cap it like the saved kind.
  '[data-question-id],[data-question-inline]{max-width:100%!important;width:100%!important;min-width:0!important}' +
  // Inline numbers live in prose — clamp their max-width without forcing block width.
  '[data-number-inline]{max-width:100%!important}' +
  // Belt-and-braces: never let the authored document force horizontal scroll/cutoff of the page.
  'img,svg,video,table,pre{max-width:100%!important}img,video{height:auto!important}' +
  'html,body{max-width:100%!important;overflow-x:hidden!important}';

export interface AutoSizeStorySurfaceOptions {
  /** The mounted surface (from `mountStorySurface`) whose root the story body lives in. */
  surface: StorySurface;
  /** The iframe element hosting `doc` — the same-document width fallback, and what gets resized. */
  iframe: HTMLIFrameElement;
  /** The iframe's document (the surface's owner). */
  doc: Document;
  /** Fluid caller: the surface tracks the MEASURED container width instead of its mounted width. */
  fluid: boolean;
  /** Fixed canvas height in px (slides); omit for content-driven height (story pages). */
  fixedHeight?: number;
}

/**
 * Keep a mounted surface sized to its container — as WIDE as the iframe (fluid only) and as TALL as
 * its content (no inner scrollbar) — at mount AND for every later resize. Returns a disposer.
 *
 * On the SVG surface there's an extra link in each chain: an <svg> is exactly as tall and as wide as
 * it was told (it does NOT auto-size to its foreignObject content; height would sit at the 150px
 * default), so both must be pushed into the svg+foreignObject explicitly. Width only matters for a
 * FLUID caller: its iframe is 100% of the container while the mounted width is the LOGICAL canvas
 * (StoryView: 1280), so leaving the surface pinned lays the story out wider than the reader can see
 * — silently clipped (the fluid shim hides overflow-x) and, since captures serialize this same live
 * <svg>, baked into the screenshot too. A fixed-canvas (non-fluid) caller stays pinned to the width
 * it mounted with and never applies a measured width at all.
 *
 * ORDER IS LOAD-BEARING: width → reflow → measureHeight → applyHeight. A narrower surface rewraps
 * text TALLER, so measuring the height before the new width has landed would trade a horizontal clip
 * for a vertical one. (Reading scrollHeight flushes layout, so the reflow between the two is
 * synchronous.)
 */
/** Left+right padding of an element in CSS px (0 when it can't be computed, e.g. detached). */
function horizontalPadding(el: HTMLElement): number {
  const cs = el.ownerDocument.defaultView?.getComputedStyle(el);
  if (!cs) return 0;
  return (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
}

export function autoSizeStorySurface(
  { surface, iframe, doc, fluid, fixedHeight }: AutoSizeStorySurfaceOptions,
): () => void {
  const sync = () => {
    if (fluid) {
      // The story's containing block is the iframe's body; the iframe element is the same-document
      // fallback for when the inner document hasn't laid out yet. Never apply a 0 — a detached or
      // display:none container measures 0, and a 0-wide surface collapses to min-content (which then
      // blows up the height measure) instead of holding the authored canvas.
      //
      // clientWidth is the PADDING box, so authored `body{padding}` (legacy stories inject their own
      // CSS verbatim) must come off it: the surface's containing block is the body's CONTENT box, and
      // applying the wider padding box overhangs it — which `overflow-x:hidden` then clips silently,
      // the same failure this whole contract exists to prevent, just narrower.
      const measured = (doc.body.clientWidth || iframe.clientWidth) - horizontalPadding(doc.body);
      if (measured > 0) surface.applyWidth(measured);
    }
    if (fixedHeight !== undefined) return; // fixed canvas: the height prop is the only knob
    const contentHeight = surface.measureHeight();
    surface.applyHeight(contentHeight);
    iframe.style.height = `${contentHeight}px`;
  };
  sync();

  let ro: ResizeObserver | undefined;
  // Gated on EITHER axis needing resync, never on height alone: a fluid caller must keep tracking
  // the container even when its height is fixed, or it stays pinned to its mount width forever.
  if ((fluid || fixedHeight === undefined) && typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(sync);
    ro.observe(surface.root);
    // The body lives in another document, where ResizeObserver delivery is not guaranteed. Observing
    // the iframe element itself (same-document) makes pane-width changes (side-chat toggle) — which
    // resize the fluid surface and rewrap it to a different content height — always resync. This is
    // the ONLY thing that fires on a pane-width change: the caller's build effect keys off the
    // LOGICAL width, which is a constant, so a fluid story that is not re-synced here would stay at
    // its mount width forever.
    ro.observe(iframe);
  }
  return () => ro?.disconnect();
}
