/**
 * Make same-document `url(…#id)` references survive rasterization.
 *
 * A capture serializes live DOM and renders it through a `data:` URL `<img>`, and SVG-as-image
 * forbids EXTERNAL references — the same rule that forces `<img src>` to be inlined as data URIs
 * in the serializers. A reference written as `url(http://host/f/12?mode=tutorial#gradient_8)`
 * resolves in the live page (that URL *is* the live document) and names a different document
 * once rasterized, so the paint silently fails and the mark is not drawn at all.
 *
 * Vega writes gradient paints in exactly that absolute form, which is why KPI sparklines vanished
 * from every app capture — the gradient-stroked line disappeared while the solid-painted beacon
 * dot beside it survived.
 *
 * Rewriting is conditional on the id EXISTING in the serialized tree. That keeps a genuinely
 * external reference (a sprite sheet, another document's filter) untouched: it would not render
 * either way, but silently rebinding it to an unrelated local id would be worse than leaving it.
 *
 * Pure and DOM-only (no app imports), for the same reason `css-urls.ts` is: both serializers and
 * the story mirror share it, and the ui test setup mocks the mirror module wholesale.
 */

/** Attributes whose value may name a paint server / clip / filter by reference. */
const REF_ATTRS = [
  'fill', 'stroke', 'clip-path', 'filter', 'mask',
  'marker-start', 'marker-mid', 'marker-end',
] as const;

/**
 * Rewrite `url(<document>#id)` → `url(#id)` for every ref whose `id` is present according to
 * `hasId`. Quotes are preserved; `url()`s with no fragment are left alone.
 */
export function localizeFragmentUrls(text: string, hasId: (id: string) => boolean): string {
  return text.replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/g, (match, quote: string, ref: string) => {
    const hash = ref.indexOf('#');
    if (hash <= 0) return match; // no fragment, or already same-document (`#id`)
    const id = ref.slice(hash + 1);
    return id && hasId(id) ? `url(${quote}#${id}${quote})` : match;
  });
}

/**
 * Apply the rewrite across a serialized tree: reference attributes, inline `style` declarations,
 * and `<style>` text (CSS can name a paint server too). Operates in place — call it on the CLONE,
 * never on the live DOM, whose absolute refs are correct as they stand.
 */
export function localizeFragmentRefsInTree(root: Element): void {
  const ids = new Set<string>();
  if (root.id) ids.add(root.id);
  for (const el of Array.from(root.querySelectorAll('[id]'))) ids.add(el.id);
  if (ids.size === 0) return;
  const hasId = (id: string) => ids.has(id);

  const rewrite = (el: Element) => {
    for (const attr of REF_ATTRS) {
      const value = el.getAttribute(attr);
      if (value && value.includes('url(')) {
        const next = localizeFragmentUrls(value, hasId);
        if (next !== value) el.setAttribute(attr, next);
      }
    }
    const style = el.getAttribute('style');
    if (style && style.includes('url(')) {
      const next = localizeFragmentUrls(style, hasId);
      if (next !== style) el.setAttribute('style', next);
    }
  };

  rewrite(root);
  for (const el of Array.from(root.querySelectorAll('*'))) rewrite(el);

  for (const styleEl of Array.from(root.querySelectorAll('style'))) {
    const css = styleEl.textContent;
    if (css && css.includes('url(')) {
      const next = localizeFragmentUrls(css, hasId);
      if (next !== css) styleEl.textContent = next;
    }
  }
}
