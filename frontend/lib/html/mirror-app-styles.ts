/**
 * Mirrors the document's stylesheet rules into a shadow root so portaled
 * chart components (Chakra/emotion class-based styles) render correctly inside
 * the shadow tree — document styles don't match shadow content.
 *
 * Kept in its own module so the UI test environment can mock it to a no-op:
 * in jsdom, reading `cssRules`/`cssText` is a slow JS reimplementation (not
 * native CSSOM), and across a test file the injected emotion/Chakra <style>
 * tags accumulate in the shared document — so re-serializing every rule on
 * each render becomes O(n²) and dominates test time. The mirror has no
 * observable effect in tests (charts are mocked), so faking it is free.
 */

// Fallback sizing for the portaled tile: the chart stack is built for a
// FIXED-HEIGHT FLEX COLUMN parent (QuestionVisualization is flex:1 / minH:0
// all the way down). The Chakra tile Box already declares this; the class
// guarantees it even before emotion's lazily-injected styles are mirrored in.
//
// Grid/flex track blow-out guard: an embedded question's table sets a
// min-width of ~150px/column (e.g. 1200px for 8 cols) so it scrolls in a
// narrow tile. But a grid/flex ITEM defaults to `min-width: auto` (= its
// content's min-content), so that 1200px floor propagates up and forces a
// `1fr` track (or flex item) wider than its share — the table overflows the
// column instead of scrolling inside it. `min-width: 0` only breaks that
// propagation when set on the ITEM itself, and the author-authored wrapper
// (`.plate`, cell, ...) is content we don't own. So target whatever element
// directly wraps an embed placeholder and zero its min-width; the table's own
// `overflow-x: auto` then absorbs the width. `:where` keeps specificity 0 so
// an author can still override intentionally.
const APP_STYLES_BASE_CSS =
  `.mx-chart-fill { width: 100%; height: 100%; display: flex; flex-direction: column; overflow: hidden; }\n` +
  `:where(:has(> [data-question-id], > [data-question-inline])) { min-width: 0; }`;

/**
 * Rewrite RELATIVE `url(...)` refs in a rule's cssText to ABSOLUTE, resolved against `base` (the
 * source stylesheet's href). Mirrored rules are dropped into an inline <style> in the story iframe,
 * whose base URL is the page (/f/<id>) — so a font's `url("../media/x.woff2")` (authored relative to
 * /_next/static/css/…) would resolve to /media/x.woff2 and 404. Absolutising against the original
 * stylesheet's href makes it /_next/static/media/x.woff2 again. Absolute/data/blob/root-relative/
 * fragment refs already resolve correctly and are left as-is.
 */
export function absolutizeCssUrls(cssText: string, base: string): string {
  return cssText.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, quote: string, ref: string) => {
    const r = ref.trim();
    if (/^(data:|https?:|blob:|\/|#)/i.test(r)) return match; // already absolute / data / blob / root-relative / fragment
    try {
      return `url(${quote}${new URL(r, base).href}${quote})`;
    } catch {
      return match;
    }
  });
}

/**
 * Fill the shadow root's dedicated app-styles tag with the document's
 * stylesheet rules. Reads cssRules rather than cloning <style> tags because
 * emotion in production inserts rules via CSSOM (speedy mode) — the tags are
 * empty. The tag sits FIRST in the shadow root, so the story's own <style>
 * blocks win ties. Re-run after portals mount: emotion injects styles lazily
 * on first render.
 */
export function mirrorAppStyles(root: ShadowRoot | Document) {
  const tag = root.querySelector('style[data-mx-app-styles]');
  if (!tag) return;
  const css: string[] = [APP_STYLES_BASE_CSS];
  for (const sheet of Array.from(document.styleSheets)) {
    const owner = sheet.ownerNode;
    // Skip our own hoisted story-font tag (would re-import the fonts into the
    // shadow sheet, where @import is invalid mid-sheet anyway) and anything
    // not rooted in the document proper (jsdom surfaces shadow styles here).
    if (owner instanceof Element && (owner.hasAttribute('data-mx-story-fonts') || owner.getRootNode() !== document)) continue;
    // Resolve relative url()s (e.g. self-hosted @font-face src) against the sheet's own location —
    // not the iframe's — so they don't break when injected into the iframe's inline <style>.
    const sheetBase = sheet.href || document.baseURI;
    try {
      css.push(Array.from(sheet.cssRules)
        .filter(r => !r.cssText.startsWith('@import'))
        .map(r => absolutizeCssUrls(r.cssText, sheetBase)).join('\n'));
    } catch {
      // Cross-origin stylesheet — skip
    }
  }
  const joined = css.join('\n');
  if (tag.textContent !== joined) tag.textContent = joined;
}
