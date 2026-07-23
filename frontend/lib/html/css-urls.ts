/**
 * Rewrite RELATIVE `url(...)` refs in CSS text to ABSOLUTE, resolved against `base` (the source
 * stylesheet's href). Stylesheet-relative refs (next/font's `url("../media/x.woff2")` authored
 * relative to /_next/static/css/…) break when the CSS is moved into an inline <style> whose base
 * is the page URL — the font 404s and text falls back. Absolutizing against the original sheet's
 * href keeps them fetchable. Absolute/data/blob/root-relative/fragment refs are left as-is.
 *
 * Pure and dependency-free ON PURPOSE: it is shared by the story mirror (mirror-app-styles —
 * which the ui test setup mocks to a no-op wholesale) and the capture serializers
 * (lib/screenshot) — importing it from the mocked module silently broke capture CSS collection
 * in tests.
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
