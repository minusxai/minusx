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
// Marquee/ticker utility: a story author writes a "board read" / ticker strip as
// `overflow:hidden; white-space:nowrap`, which just CLIPS the overflowing text
// (no motion — a common agent mistake). This provides the scroll for free: wrap
// the strip in `.mx-marquee` with an inner `.mx-marquee-track` and the track
// scrolls right-to-left on a loop. Duration is overridable via inline
// `animation-duration` on the track for longer/shorter copy. Pauses on hover and
// falls back to a static, horizontally-scrollable strip under reduced-motion.
const MARQUEE_CSS =
  `.mx-marquee { overflow: hidden; }\n` +
  `.mx-marquee-track { display: inline-block; white-space: nowrap; padding-left: 100%; animation: mx-marquee-scroll 22s linear infinite; will-change: transform; }\n` +
  `.mx-marquee:hover .mx-marquee-track { animation-play-state: paused; }\n` +
  `@keyframes mx-marquee-scroll { from { transform: translateX(0); } to { transform: translateX(-100%); } }\n` +
  `@media (prefers-reduced-motion: reduce) { .mx-marquee { overflow-x: auto; } .mx-marquee-track { animation: none; padding-left: 0; } }`;

const APP_STYLES_BASE_CSS =
  `.mx-chart-fill { width: 100%; height: 100%; display: flex; flex-direction: column; overflow: hidden; }\n` +
  `:where(:has(> [data-question-id], > [data-question-inline])) { min-width: 0; }\n` +
  MARQUEE_CSS;

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
 * The 6a mirror shrink (Renderer_v2): of everything the document's stylesheets contain, ONLY
 * `@font-face` rules still belong in the story iframe — embed chrome is compiled into every
 * story's CSS (kit + EMBED_CHROME_FILES recipe union) and Chakra never reaches the iframe.
 * Relative url()s (self-hosted font src) are absolutized against each sheet's own location so
 * they don't 404 against the iframe's base. Pure → unit-testable.
 */
export function collectFontFaceCss(rules: Array<{ cssText: string; base: string }>): string {
  return rules
    .filter((r) => r.cssText.startsWith('@font-face'))
    .map((r) => absolutizeCssUrls(r.cssText, r.base))
    .join('\n');
}

/**
 * Fill the shadow root's dedicated app-styles tag with the SHRUNK app residue: the static
 * base guards (chart-fill, min-width guard, marquee) + the document's `@font-face` rules
 * (read from cssRules — link sheets carry the self-hosted next/font faces). Everything else
 * the mirror used to carry (the Chakra/emotion CSSOM, ~43% of ~455KB per story) is gone:
 * story CSS is self-contained after the Phase 5 Chakra exit.
 */
export function mirrorAppStyles(root: ShadowRoot | Document) {
  const tag = root.querySelector('style[data-mx-app-styles]');
  if (!tag) return;
  const rules: Array<{ cssText: string; base: string }> = [];
  for (const sheet of Array.from(document.styleSheets)) {
    const owner = sheet.ownerNode;
    // Skip our own hoisted story-font tag (would duplicate the fonts) and anything not rooted
    // in the document proper (jsdom surfaces shadow styles here).
    if (owner instanceof Element && (owner.hasAttribute('data-mx-story-fonts') || owner.getRootNode() !== document)) continue;
    const sheetBase = sheet.href || document.baseURI;
    try {
      for (const r of Array.from(sheet.cssRules)) rules.push({ cssText: r.cssText, base: sheetBase });
    } catch {
      // Cross-origin stylesheet — skip
    }
  }
  const joined = `${APP_STYLES_BASE_CSS}\n${collectFontFaceCss(rules)}`;
  if (tag.textContent !== joined) tag.textContent = joined;
}
