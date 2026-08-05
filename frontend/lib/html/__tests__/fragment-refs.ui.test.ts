/**
 * Same-document paint refs must survive rasterization (`lib/html/fragment-refs.ts`).
 *
 * Vega writes gradient paints as ABSOLUTE refs —
 * `stroke="url(http://host/f/12?mode=tutorial#gradient_8)"` — which resolve in the live document
 * because that URL *is* the live document. A capture rasterizes the serialized SVG through a
 * `data:` URL `<img>`, where the very same string now names a DIFFERENT document; SVG-as-image
 * forbids external references, so the paint fails and the mark is not drawn at all. Observed as
 * KPI sparklines vanishing from every app capture (ReviewFile, chat app-state, share cards) while
 * the solid-painted beacon dot survived.
 */
import { describe, it, expect } from 'vitest';
import { localizeFragmentUrls, localizeFragmentRefsInTree } from '../fragment-refs';

const has = (ids: string[]) => (id: string) => ids.includes(id);

describe('localizeFragmentUrls', () => {
  it('strips the document part of a ref whose target lives in this tree', () => {
    expect(localizeFragmentUrls('url(http://x/f/12?mode=tutorial#gradient_8)', has(['gradient_8'])))
      .toBe('url(#gradient_8)');
  });

  it('handles quoted refs and several refs in one value', () => {
    expect(localizeFragmentUrls('url("http://x/a#g1") url(\'http://x/a#g2\')', has(['g1', 'g2'])))
      .toBe('url("#g1") url(\'#g2\')');
  });

  it('leaves an already-local ref untouched', () => {
    expect(localizeFragmentUrls('url(#gradient_8)', has(['gradient_8']))).toBe('url(#gradient_8)');
  });

  it('leaves refs whose target is NOT in this tree — those are genuinely external', () => {
    expect(localizeFragmentUrls('url(http://other/sprite.svg#icon)', has(['gradient_8'])))
      .toBe('url(http://other/sprite.svg#icon)');
  });

  it('leaves url()s with no fragment alone (images, fonts)', () => {
    expect(localizeFragmentUrls('url(https://x/font.woff2)', has(['g1']))).toBe('url(https://x/font.woff2)');
    expect(localizeFragmentUrls('url(data:image/png;base64,AAAA)', has(['g1']))).toBe('url(data:image/png;base64,AAAA)');
  });
});

describe('localizeFragmentRefsInTree', () => {
  function tree(inner: string): SVGSVGElement {
    const wrap = document.createElement('div');
    wrap.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
    return wrap.firstElementChild as SVGSVGElement;
  }

  it('rewrites every paint-ish attribute that points at a local id', () => {
    const svg = tree(`
      <defs><linearGradient id="g1"></linearGradient><clipPath id="c1"></clipPath>
      <filter id="f1"></filter><mask id="m1"></mask></defs>
      <path stroke="url(http://host/p?x=1#g1)" fill="url(http://host/p?x=1#g1)"
            clip-path="url(http://host/p?x=1#c1)" filter="url(http://host/p?x=1#f1)"
            mask="url(http://host/p?x=1#m1)"/>`);
    localizeFragmentRefsInTree(svg);
    const path = svg.querySelector('path')!;
    for (const attr of ['stroke', 'fill', 'clip-path', 'filter', 'mask']) {
      expect(path.getAttribute(attr), `${attr} should be same-document`).toMatch(/^url\(#/);
    }
  });

  it('rewrites inline style declarations too, not just attributes', () => {
    const svg = tree(`<defs><linearGradient id="g1"></linearGradient></defs>
      <path style="fill: url(http://host/p#g1); stroke: none"/>`);
    localizeFragmentRefsInTree(svg);
    expect(svg.querySelector('path')!.getAttribute('style')).toContain('url(#g1)');
  });

  it('rewrites refs inside <style> text, where CSS can name a paint server too', () => {
    const svg = tree(`<defs><linearGradient id="g1"></linearGradient></defs>
      <style>.mark { fill: url(http://host/p#g1); }</style><path class="mark"/>`);
    localizeFragmentRefsInTree(svg);
    expect(svg.querySelector('style')!.textContent).toContain('url(#g1)');
  });

  it('leaves a ref to an id that is not in the tree — it is not ours to rewrite', () => {
    const svg = tree('<path fill="url(http://host/sprite.svg#missing)"/>');
    localizeFragmentRefsInTree(svg);
    expect(svg.querySelector('path')!.getAttribute('fill')).toBe('url(http://host/sprite.svg#missing)');
  });

  it('finds ids anywhere in the tree, including nested foreignObject content', () => {
    const svg = tree(`<foreignObject><div><svg><defs><linearGradient id="deep"></linearGradient></defs>
      <path stroke="url(http://host/p#deep)"/></svg></div></foreignObject>`);
    localizeFragmentRefsInTree(svg);
    expect(svg.querySelector('path')!.getAttribute('stroke')).toBe('url(#deep)');
  });
});
