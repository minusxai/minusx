/**
 * Resolve a story's `@import` web-fonts into concrete `@font-face` rules.
 *
 * Stories load fonts via `@import url(https://fonts.googleapis.com/...)`, which works for LIVE
 * rendering inside the iframe. But the serialization capture embeds fonts by scanning `@font-face`
 * rules and does NOT follow `@import`, so a captured story falls back to a wider system serif — the
 * title then wraps to an extra line and overlaps the next block. Fetching the imported CSS (which is
 * itself a list of `@font-face` rules) and injecting it as real rules lets the capture embed the actual
 * fonts, so the capture matches the live render.
 *
 * Browser-only. Cached by the set of import URLs (fonts are global + stable), so repeat captures
 * don't refetch.
 */

let cachedSignature: string | null = null;
let cachedCss: Promise<string> | null = null;

/** All `@import url(...)` targets found in the story's `<style>` blocks within `doc`. */
export function collectStoryFontImports(doc: Document): string[] {
  const urls: string[] = [];
  doc.querySelectorAll('style').forEach((style) => {
    const text = style.textContent || '';
    for (const m of text.matchAll(/@import\s+url\(\s*["']?([^"')]+)["']?\s*\)/g)) urls.push(m[1]);
  });
  return urls;
}

/**
 * Fetch each `@import`ed stylesheet and concatenate the `@font-face` CSS it contains. Best-effort:
 * a failed fetch contributes nothing. Resolves to '' when there are no imports. Cached by the URL set.
 */
export function resolveImportFontCss(urls: string[]): Promise<string> {
  const sig = urls.join('|');
  if (sig === cachedSignature && cachedCss) return cachedCss;
  cachedSignature = sig;
  cachedCss = (async () => {
    if (urls.length === 0) return '';
    const parts = await Promise.all(urls.map((u) => fetch(u).then((r) => r.text()).catch(() => '')));
    const css = parts.join('\n');
    // Don't cache an empty result (all fetches failed / nothing to embed) — let a later capture retry.
    if (!css.trim()) { cachedSignature = null; cachedCss = null; }
    return css.trim() ? css : '';
  })();
  return cachedCss;
}

/** Clears the cache. Exposed for test isolation. */
export function clearStoryFontCache(): void {
  cachedSignature = null;
  cachedCss = null;
}
