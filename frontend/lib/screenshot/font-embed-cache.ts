/**
 * Cached font embedding for html-to-image captures.
 *
 * Embedding fonts (fetch each @font-face src + base64-inline it) is the single most expensive part
 * of a capture, and html-to-image redoes it on EVERY call. The set of fonts is global and stable
 * between captures, so we embed once and reuse — keyed by a cheap signature of the document's current
 * @font-face rules so the cache self-invalidates when fonts actually change (e.g. a story injects a
 * custom web font). Completely font-agnostic: whatever @font-face rules exist get embedded; no font
 * family is hardcoded.
 *
 * Browser-only (reads document.styleSheets + html-to-image).
 */
import { getFontEmbedCSS } from 'html-to-image';

let cachedSignature: string | null = null;
let cachedCSS: Promise<string> | null = null;

/**
 * A cheap signature of every @font-face rule currently in the document. Walking the CSSOM is fast;
 * fetching+encoding the font files (getFontEmbedCSS) is not — so we key the latter on the former.
 * Cross-origin stylesheets throw on `.cssRules` access (and are unreadable by getFontEmbedCSS too),
 * so we skip them.
 */
export function fontFaceSignature(doc: Pick<Document, 'styleSheets'> = document): string {
  const parts: string[] = [];
  for (const sheet of Array.from(doc.styleSheets)) {
    let rules: CSSRuleList | undefined;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // cross-origin / unreadable
    }
    if (!rules) continue;
    for (const rule of Array.from(rules)) {
      if (rule.cssText && rule.cssText.toLowerCase().includes('@font-face')) parts.push(rule.cssText);
    }
  }
  return parts.join('\n');
}

/**
 * The document's embedded-font CSS, computed once and reused until the @font-face set changes.
 * Pass the result as html-to-image's `fontEmbedCSS` option to skip its per-capture font work.
 * Never rejects — on failure it resolves to '' (capture proceeds without embedded fonts) and the
 * cache is cleared so the next call retries.
 */
export function getCachedFontEmbedCSS(node: HTMLElement): Promise<string> {
  const sig = fontFaceSignature(node.ownerDocument ?? document);
  if (sig === cachedSignature && cachedCSS) return cachedCSS;
  cachedSignature = sig;
  cachedCSS = getFontEmbedCSS(node).catch(() => {
    cachedSignature = null;
    cachedCSS = null;
    return '';
  });
  return cachedCSS;
}

/** Clears the cache. Exposed for test isolation and for forcing a re-embed. */
export function clearFontEmbedCache(): void {
  cachedSignature = null;
  cachedCSS = null;
}
