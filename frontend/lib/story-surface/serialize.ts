/**
 * Rasterizing a story SVG surface: serialize the LIVE `<svg>` the user is looking at, hand it to the
 * browser as an image, and draw it. No snapdom — nothing here re-derives styles or re-implements
 * layout, so what renders is what the browser already rendered.
 *
 * Three things must be fixed up before an `<img>` can render the serialized SVG faithfully, because
 * it renders in an ISOLATED context (no parent document, no network for subresources):
 *  1. STYLES — rules in the iframe's <head> (mirrored app styles, compiled Tailwind) aren't part of
 *     the <svg> subtree, so they're cloned INTO the serialized copy.
 *  2. FONTS — `@import` web-fonts and `@font-face` src URLs don't load in an <img>-rendered SVG, so
 *     they're inlined as data: URLs. Without this, text falls back to a system serif and rewraps.
 *  3. SCROLL — scroll position is DOM *state*, not markup: XMLSerializer drops `scrollLeft`, so a
 *     horizontally-scrolled table would capture reset to column 1. Offsets are translated into a
 *     transform on the clone.
 */
import { STORY_SVG_ATTR } from '@/lib/story-surface';
import { collectStoryFontImports, resolveImportFontCss } from '@/lib/html/resolve-story-fonts';

// Absolute (https://cdn/…) AND root-relative (/fonts/…) refs: platform story fonts are served as
// same-origin static assets (lib/data/story/story-fonts.ts), which fetch() resolves natively.
const FONT_URL_RE = /url\(\s*(["']?)((?:https?:\/\/|\/)[^"')]+)\1\s*\)/g;

/** Cache: resource URL (font file / image) → data: URL. These assets are effectively immutable,
 *  so this never invalidates: every capture after the first reuses the same inlined bytes.
 *  eslint-disable-next-line no-restricted-syntax -- browser-only capture cache; no per-request scope. */
// eslint-disable-next-line no-restricted-syntax -- browser-only capture cache, keyed by immutable font URL
const fontDataUrls = new Map<string, Promise<string | null>>();

/** Clears the inlined-font cache. Exposed for test isolation. */
export function clearFontDataUrlCache(): void {
  fontDataUrls.clear();
}

async function toDataUrl(url: string): Promise<string | null> {
  const cached = fontDataUrls.get(url);
  if (cached) return cached;
  const p = (async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const buf = await res.arrayBuffer();
      let bin = '';
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      const mime = res.headers.get('content-type') || 'font/woff2';
      return `data:${mime};base64,${btoa(bin)}`;
    } catch {
      return null; // best-effort: a failed font just falls back, it must not fail the capture
    }
  })();
  fontDataUrls.set(url, p);
  return p;
}

/**
 * Rewrite every remote `url(...)` in `css` to a data: URL. Font files that fail to fetch keep their
 * original URL (they simply won't render in the <img> context) rather than breaking the whole sheet.
 */
export async function inlineFontUrls(css: string): Promise<string> {
  const urls = Array.from(new Set(Array.from(css.matchAll(FONT_URL_RE), (m) => m[2])));
  if (urls.length === 0) return css;
  const resolved = await Promise.all(urls.map(async (u) => [u, await toDataUrl(u)] as const));
  const map = new Map(resolved);
  return css.replace(FONT_URL_RE, (whole, _q, url: string) => {
    const data = map.get(url);
    return data ? `url("${data}")` : whole;
  });
}

/**
 * All CSS the story depends on, as one stylesheet, with fonts inlined: the iframe's <head> rules
 * (app-style mirror + compiled Tailwind) plus the resolved `@import` web-fonts. The story's own
 * <style> blocks are NOT included — they live inside the surface root and serialize with it.
 */
export async function collectSurfaceCss(doc: Document): Promise<string> {
  const headCss = Array.from(doc.head.querySelectorAll('style'))
    .map((s) => s.textContent || '')
    .join('\n');
  const fontCss = await resolveImportFontCss(collectStoryFontImports(doc)).catch(() => '');
  return inlineFontUrls(`${fontCss}\n${headCss}`);
}

/**
 * Bake scroll offsets into the CLONE. `scrollLeft/scrollTop` are properties, not attributes, so they
 * vanish through XMLSerializer; without this a scrolled table captures at its origin. Walks live and
 * cloned trees in lockstep (identical structure) and shifts scrolled content by its offset.
 */
export function applyScrollOffsets(liveRoot: Element, cloneRoot: Element): void {
  const live = [liveRoot, ...Array.from(liveRoot.querySelectorAll('*'))];
  const clone = [cloneRoot, ...Array.from(cloneRoot.querySelectorAll('*'))];
  for (let i = 0; i < live.length && i < clone.length; i++) {
    const el = live[i] as HTMLElement;
    const left = el.scrollLeft ?? 0;
    const top = el.scrollTop ?? 0;
    if (!left && !top) continue;
    // Shift the scrolled element's CHILDREN, and clip at the container, so the captured region
    // matches what the user sees rather than the un-scrolled origin.
    const target = clone[i] as HTMLElement;
    if (!target.style) continue;
    target.style.overflow = 'hidden';
    for (const child of Array.from(target.children)) {
      const c = child as HTMLElement;
      if (!c.style) continue;
      c.style.transform = `translate(${-left}px, ${-top}px)`;
    }
  }
}

/**
 * Stamp live form state into the CLONE as serializable markup. `input.value`, `checked`, and select
 * selection are DOM *properties* — XMLSerializer only emits attributes, so a typed value would
 * capture as the original (usually empty) markup. Walks live and cloned trees in lockstep.
 */
export function stampFormValues(liveRoot: Element, cloneRoot: Element): void {
  const live = [liveRoot, ...Array.from(liveRoot.querySelectorAll('*'))];
  const clone = [cloneRoot, ...Array.from(cloneRoot.querySelectorAll('*'))];
  for (let i = 0; i < live.length && i < clone.length; i++) {
    const el = live[i];
    const target = clone[i];
    const tag = el.tagName;
    if (tag === 'INPUT') {
      const input = el as HTMLInputElement;
      target.setAttribute('value', input.value);
      if (input.checked) target.setAttribute('checked', '');
      else target.removeAttribute('checked');
    } else if (tag === 'TEXTAREA') {
      target.textContent = (el as HTMLTextAreaElement).value;
    } else if (tag === 'OPTION') {
      if ((el as HTMLOptionElement).selected) target.setAttribute('selected', '');
      else target.removeAttribute('selected');
    }
  }
}

/** The live story `<svg>` hosted inside `element` (an iframe host), or null if it isn't an SVG story. */
export function findStorySvg(element: HTMLElement): SVGSVGElement | null {
  const iframe = element.tagName === 'IFRAME'
    ? (element as HTMLIFrameElement)
    : element.querySelector('iframe');
  const doc = iframe?.contentDocument;
  return (doc?.querySelector(`svg[${STORY_SVG_ATTR}]`) as SVGSVGElement | null) ?? null;
}

/**
 * Serialize the live story SVG into a standalone, self-contained SVG string: styles cloned in,
 * fonts inlined, scroll offsets baked. The result renders identically through an `<img>`.
 */
export async function serializeStorySvg(svg: SVGSVGElement): Promise<string> {
  const doc = svg.ownerDocument;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const liveRoot = svg.querySelector('foreignObject > *');
  const cloneRoot = clone.querySelector('foreignObject > *');
  if (liveRoot && cloneRoot) {
    applyScrollOffsets(liveRoot, cloneRoot);
    stampFormValues(liveRoot, cloneRoot);
    // Color-mode stamp: the standalone document has NO <html> element (its root is the <svg>),
    // so `.dark`-scoped story/kit rules would never match. Stamping the CLONED root with the
    // current mode class keeps them resolving. (The Chakra `chakra-theme` token-host stamp is
    // deleted — post-6a no Chakra reaches the iframe, so there is no var chain left to host.)
    const mode = doc.documentElement.classList.contains('dark') ? 'dark' : 'light';
    const cls = cloneRoot.getAttribute('class');
    cloneRoot.setAttribute('class', `${cls ? `${cls} ` : ''}${mode}`);
  }

  // Explicit intrinsic size on the root: an <img>-rendered SVG without width/height attributes has
  // no reliable intrinsic size (engines disagree), which skews the rasterized canvas dimensions.
  if (!clone.getAttribute('width') || !clone.getAttribute('height')) {
    const box = svg.getBoundingClientRect();
    const w = box.width || svg.width?.baseVal?.value || 0;
    const h = box.height || svg.height?.baseVal?.value || 0;
    if (w) clone.setAttribute('width', String(w));
    if (h) clone.setAttribute('height', String(h));
  }

  // In-root styles (compiledCss, app-styles mirror, platform font css — Story_Design_V2 §4) travel
  // inside the cloned subtree already, but their remote url() refs (e.g. data-mx-fonts @font-face
  // src) can't load in an <img>-rendered SVG. Splice the data-URI form into the PARSED COPY only —
  // the live DOM keeps the cacheable URL form.
  await Promise.all(
    Array.from(clone.querySelectorAll('style')).map(async (style) => {
      const cssText = style.textContent || '';
      if (cssText) style.textContent = await inlineFontUrls(cssText);
    }),
  );

  // Images: SVG-as-image blocks ALL external references, so <img> srcs must be data: URIs in the
  // parsed copy (failures keep the URL — the image just won't render; never fail the capture).
  await Promise.all(
    Array.from(clone.querySelectorAll('img')).map(async (img) => {
      const src = img.getAttribute('src');
      if (!src || src.startsWith('data:')) return;
      const data = await toDataUrl(src);
      if (data) img.setAttribute('src', data);
    }),
  );

  const css = await collectSurfaceCss(doc);
  if (css.trim()) {
    const style = doc.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = css;
    clone.insertBefore(style, clone.firstChild);
  }
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return new XMLSerializer().serializeToString(clone);
}

/**
 * Rasterize a serialized SVG string into an <img> the caller can draw.
 *
 * URL scheme is load-bearing: a percent-encoded `data:` URL, NEVER a Blob URL — Blob-URL SVG
 * rasterization taints the canvas in Chromium and WebKit (Story_Design_V2 §12).
 *
 * Awaits `document.fonts.ready` and full image decode before resolving — racing resource decode is
 * the dominant cause of blank captures (especially Safari), where drawImage lands before the SVG's
 * text/fonts have finished decoding.
 */
export async function svgToImage(svgString: string): Promise<HTMLImageElement> {
  const img = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('SVG rasterize failed'));
  });
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`;
  try {
    await document.fonts?.ready;
  } catch { /* fonts that fail to load must not fail the capture */ }
  if (typeof img.decode === 'function') {
    await img.decode();
  } else {
    await loaded;
  }
  return img;
}
