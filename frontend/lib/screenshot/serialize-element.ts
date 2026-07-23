/**
 * Generic app-page serialization capture — the snapdom replacement for main-document React views
 * (dashboards / questions / notebooks / reports), Story_Design_V2 §4.
 *
 * The target element is CLONED into an in-memory `<svg><foreignObject>` document that must be
 * fully self-contained, because it renders in an isolated <img> context (no parent document, no
 * network, and any external fetch would either be blocked or taint the rasterizing canvas):
 *  - STYLES — all same-origin document stylesheets (Chakra/Emotion are same-origin <style>
 *    elements; link sheets contribute their cssRules) are inlined INTO the serialized copy,
 *    with url() refs (fonts, background images) resolved to data: URIs.
 *  - FIXUP PASS on the parsed copy (live DOM untouched): scroll offsets baked as transforms,
 *    input/textarea values stamped as attributes, <canvas> content stamped as toDataURL() <img>
 *    (guarded — a tainted canvas is skipped), transient portal popovers dropped.
 *  - IMAGES inlined as data: URIs (same-origin/cors fetch; failures left as-is — SVG-as-image
 *    blocks external references, so they simply don't render and never taint).
 *
 * `fixed`/`sticky` app chrome renders at its document-flow position (as in a scrolled-to-top
 * full-page capture) — accepted divergence; the bar is content complete and legible.
 */
import { applyScrollOffsets, stampFormValues } from '@/lib/story-surface/serialize';
import { absolutizeCssUrls } from '@/lib/html/css-urls';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Transient overlay portals (Chakra/Ark popover/tooltip/menu positioners) — dropped from the
 * clone: they are `position: fixed` viewport overlays that would land at a nonsense document-flow
 * position in the capture.
 */
export const TRANSIENT_PORTAL_SELECTOR = '[data-scope][data-part="positioner"]';

/**
 * All same-origin CSS of `doc` as one stylesheet string. <style> elements contribute their
 * text (faithful — CSSOM re-serialization can drop rules the parser doesn't know); link sheets
 * contribute their cssRules. Cross-origin link sheets throw on cssRules access and are skipped.
 */
export function collectDocumentCss(doc: Document): string {
  const parts: string[] = [];
  for (const sheet of Array.from(doc.styleSheets)) {
    const node = sheet.ownerNode as Element | null;
    if (node && node.tagName === 'STYLE') {
      parts.push(node.textContent || '');
      continue;
    }
    // Link-sheet url() refs are relative to THE SHEET (next/font: `url("../media/x.woff2")`
    // inside /_next/static/css/…) — absolutize against the sheet's own href so the later
    // data:-URI inlining fetches the real resource instead of 404ing against the page URL
    // (which silently dropped every webfont from captures).
    const base = sheet.href || doc.baseURI;
    try {
      parts.push(Array.from(sheet.cssRules).map((r) => absolutizeCssUrls(r.cssText, base)).join('\n'));
    } catch {
      // cross-origin sheet — unreadable, skip (its fonts/styles fall back)
    }
  }
  return parts.join('\n');
}

/**
 * Snapshot the INHERITED text environment of a live element as a CSS declaration string. The
 * serialized copy is detached from every ancestor the element inherited from — un-colored text
 * fell back to initial black on dark tiles, and font-family fell back to a wider system mono
 * (clipping captions). Baking the computed values onto the clone wrapper restores the context.
 */
export function snapshotInheritedStyle(el: Element): string {
  const win = el.ownerDocument.defaultView;
  if (!win) return '';
  const cs = win.getComputedStyle(el);
  return ['color', 'font-family', 'font-size', 'line-height', 'letter-spacing']
    .map((p) => {
      const v = cs.getPropertyValue(p);
      return v ? `${p}:${v};` : '';
    })
    .join('');
}

/** Best-effort fetch → data: URL. Null on any failure — a miss must never fail the capture. */
async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const mime = res.headers.get('content-type') || 'application/octet-stream';
    return `data:${mime};base64,${btoa(bin)}`;
  } catch {
    return null;
  }
}

const CSS_URL_RE = /url\(\s*(["']?)([^"')]+)\1\s*\)/g;

/**
 * Rewrite every url() in `css` (absolute or relative, resolved against `baseHref`) to a data:
 * URL. data:/# refs pass through; failed fetches keep the original url (that resource simply
 * won't render in the <img> context) rather than breaking the sheet.
 */
export async function inlineCssUrls(css: string, baseHref: string): Promise<string> {
  const refs = new Set<string>();
  for (const m of css.matchAll(CSS_URL_RE)) {
    const u = m[2];
    if (!u.startsWith('data:') && !u.startsWith('#')) refs.add(u);
  }
  if (refs.size === 0) return css;
  const resolved = await Promise.all(Array.from(refs, async (u) => {
    let abs = u;
    try { abs = new URL(u, baseHref).href; } catch { /* keep as-is */ }
    return [u, await fetchAsDataUrl(abs)] as const;
  }));
  const map = new Map(resolved);
  return css.replace(CSS_URL_RE, (whole, _q, url: string) => {
    const data = map.get(url);
    return data ? `url("${data}")` : whole;
  });
}

/**
 * Stamp live <canvas> pixels into the clone as data: <img> elements — canvas content is not
 * markup, so it serializes empty. Guarded: a tainted canvas throws on toDataURL and is skipped.
 * Must run while live and clone trees are still structurally identical (lockstep walk).
 */
export function stampCanvases(liveRoot: Element, cloneRoot: Element): void {
  const live = Array.from(liveRoot.querySelectorAll('canvas'));
  const clone = Array.from(cloneRoot.querySelectorAll('canvas'));
  for (let i = 0; i < live.length && i < clone.length; i++) {
    const target = clone[i];
    try {
      const dataUrl = live[i].toDataURL();
      const img = (cloneRoot.ownerDocument as Document).createElement('img');
      img.setAttribute('src', dataUrl);
      const w = live[i].getAttribute('width');
      const h = live[i].getAttribute('height');
      if (w) img.setAttribute('width', w);
      if (h) img.setAttribute('height', h);
      if (target.getAttribute('style')) img.setAttribute('style', target.getAttribute('style')!);
      target.replaceWith(img);
    } catch {
      // tainted or unreadable canvas — leave the (blank) canvas rather than fail the capture
    }
  }
}

/** Inline every non-data <img> src in the clone as a data: URI; failures are left as-is. */
export async function inlineImageSources(cloneRoot: Element, baseHref: string): Promise<void> {
  const imgs = Array.from(cloneRoot.querySelectorAll('img'));
  await Promise.all(imgs.map(async (img) => {
    const src = img.getAttribute('src');
    if (!src || src.startsWith('data:')) return;
    let abs = src;
    try { abs = new URL(src, baseHref).href; } catch { /* keep as-is */ }
    const data = await fetchAsDataUrl(abs);
    if (data) img.setAttribute('src', data);
    // srcset would override the inlined src with an external candidate — drop it either way.
    img.removeAttribute('srcset');
  }));
}

export interface SerializeElementOptions {
  /** Override the intrinsic width/height (CSS px). Defaults to the element's offset box. */
  width?: number;
  height?: number;
  /** Painted behind the content inside the serialized document. */
  backgroundColor?: string;
  /** Node filter (return true to keep) — e.g. excluding the region-select overlay itself. */
  filter?: (el: Element) => boolean;
}

/**
 * Remove clone nodes whose LIVE counterpart fails `filter`. Lockstep walk (live and clone are
 * still structurally identical when this runs), removals deferred so indices stay aligned.
 */
function applyNodeFilter(liveRoot: Element, cloneRoot: Element, filter: (el: Element) => boolean): void {
  const live = Array.from(liveRoot.querySelectorAll('*'));
  const clone = Array.from(cloneRoot.querySelectorAll('*'));
  const doomed: Element[] = [];
  for (let i = 0; i < live.length && i < clone.length; i++) {
    if (!filter(live[i])) doomed.push(clone[i]);
  }
  doomed.forEach((n) => n.remove());
}

/**
 * Serialize `element` into a standalone, self-contained SVG string (`<svg><foreignObject>`),
 * ready for the data:-URL rasterize pipeline (svgToImage). The live DOM is never mutated.
 */
export async function serializeElementToSvg(
  element: HTMLElement,
  opts: SerializeElementOptions = {},
): Promise<string> {
  const doc = element.ownerDocument;
  const width = Math.max(1, Math.ceil(opts.width ?? (element.offsetWidth || element.getBoundingClientRect().width)));
  const height = Math.max(1, Math.ceil(opts.height ?? (element.offsetHeight || element.getBoundingClientRect().height)));

  const clone = element.cloneNode(true) as HTMLElement;
  // Lockstep fixups FIRST (they need live/clone structural identity), then structural drops.
  applyScrollOffsets(element, clone);
  stampFormValues(element, clone);
  stampCanvases(element, clone);
  if (opts.filter) applyNodeFilter(element, clone, opts.filter);
  clone.querySelectorAll(TRANSIENT_PORTAL_SELECTOR).forEach((n) => n.remove());
  await inlineImageSources(clone, doc.baseURI);

  const css = await inlineCssUrls(collectDocumentCss(doc), doc.baseURI);

  const svg = doc.createElementNS(SVG_NS, 'svg');
  // No manual xmlns attribute: XMLSerializer emits the namespace declaration itself, and setting
  // it as an attribute too would serialize a duplicate xmlns.
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  if (css.trim()) {
    const style = doc.createElementNS(SVG_NS, 'style');
    style.textContent = css;
    svg.appendChild(style);
  }
  const fo = doc.createElementNS(SVG_NS, 'foreignObject');
  fo.setAttribute('width', '100%');
  fo.setAttribute('height', '100%');
  // Wrapper layers re-establish the ancestor class/theme context the document CSS keys off
  // (html/body classes like `.dark`, `data-theme`) — the clone is detached from both. Post-6a
  // the captured content is kit/Tailwind, so the color-mode class (which `.dark
  // [data-mx-theme-host]` keys off) is what matters; the Chakra `chakra-theme` token-host
  // stamp is deleted.
  const outer = doc.createElement('div');
  const mode = doc.documentElement.classList.contains('dark') ? 'dark' : 'light';
  const htmlClasses = doc.documentElement.className;
  outer.setAttribute('class', `${mode}${htmlClasses ? ` ${htmlClasses}` : ''}`);
  const theme = doc.documentElement.getAttribute('data-theme');
  if (theme) outer.setAttribute('data-theme', theme);
  outer.setAttribute('style', `width:${width}px;height:${height}px;overflow:hidden;`
    + (opts.backgroundColor ? `background:${opts.backgroundColor};` : '')
    + snapshotInheritedStyle(element));
  const inner = doc.createElement('div');
  // shadcn token host (Renderer_v2 Phase 3+): re-skinned views consume tokens declared under
  // `[data-mx-theme-host]` / `.dark [data-mx-theme-host]` (app/theme-tokens.css), and the live
  // host is an ANCESTOR outside the captured subtree (FileLayout's content root). Stamp it on the
  // INNER wrapper — nested under the mode wrapper — so the dark-descendant selector matches too.
  inner.setAttribute('data-mx-theme-host', '');
  if (doc.body?.className) inner.setAttribute('class', doc.body.className);
  inner.appendChild(clone);
  outer.appendChild(inner);
  fo.appendChild(outer);
  svg.appendChild(fo);
  return new XMLSerializer().serializeToString(svg);
}
