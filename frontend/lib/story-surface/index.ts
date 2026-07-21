/**
 * The story SURFACE: where a story's body lives inside its iframe document, and how tall it is.
 *
 * This module owns the whole DOM-vs-SVG difference behind one narrow interface, so AgentHtml stays a
 * thin composition: it builds the iframe document, then asks the surface for `root` (the element the
 * story body renders into — everything downstream, embeds/editing/serialization, targets that) and
 * calls `syncHeight()`. Nothing outside this module branches on the renderer.
 *
 * Two surfaces:
 *  - 'dom'  — the classic path: the story body IS `document.body`. Height = body.scrollHeight.
 *  - 'svg'  — the body is mounted inside `<svg><foreignObject>` in the same iframe (isolation is the
 *             iframe's job either way). It renders identically — foreignObject content is real, live,
 *             interactive DOM (contentEditable/focus/hit-testing all verified) — but the surface can
 *             then be RASTERIZED by serializing that live <svg> — no pixel re-derivation. Because an <svg> does NOT auto-size to its foreignObject content (it
 *             defaults to 150px), the svg + foreignObject height must be set explicitly from the
 *             measured content on every sync — that's the one real cost of this surface.
 */
/**
 * The surfaces AgentHtml can mount into. Deliberately narrower than the `StoryRenderer` config union:
 * 'canvas' is a different component (CanvasStoryView/takumi), not a surface of the DOM renderer.
 */
export type StorySurfaceKind = 'dom' | 'svg';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XHTML_NS = 'http://www.w3.org/1999/xhtml';

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
  };
}
