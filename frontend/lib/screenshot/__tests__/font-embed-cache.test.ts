// @vitest-environment jsdom
// Font embedding is the heaviest part of an html-to-image capture: it fetches every @font-face
// src and base64-inlines it. The set of fonts is global and stable between captures, so we embed
// ONCE and reuse — keyed by a cheap signature of the current @font-face rules, so it self-invalidates
// when fonts actually change (e.g. a story injects a custom web font). Font-agnostic: nothing here
// names a specific font family.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('html-to-image', () => ({
  getFontEmbedCSS: vi.fn(async () => '@font-face{font-family:Embedded;src:url(data:font/woff2;base64,AAAA)}'),
}));

import { getFontEmbedCSS } from 'html-to-image';
import { fontFaceSignature, getCachedFontEmbedCSS, clearFontEmbedCache } from '../font-embed-cache';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setStyleSheets(sheets: any[]) {
  Object.defineProperty(document, 'styleSheets', { value: sheets, configurable: true });
}
const sheet = (...rules: string[]) => ({ cssRules: rules.map(cssText => ({ cssText })) });

beforeEach(() => {
  vi.clearAllMocks();
  clearFontEmbedCache();
  setStyleSheets([]);
});

describe('fontFaceSignature — font-agnostic signature of the document @font-face rules', () => {
  it('is empty when there are no font-face rules', () => {
    setStyleSheets([sheet('.a{color:red}')]);
    expect(fontFaceSignature(document)).toBe('');
  });

  it('captures @font-face rules regardless of family name (NOT hardcoded to any font)', () => {
    setStyleSheets([sheet('@font-face{font-family:Comic Sans;src:url(x)}')]);
    expect(fontFaceSignature(document)).toContain('Comic Sans');
  });

  it('changes when a new font is added to the document', () => {
    setStyleSheets([sheet('@font-face{font-family:A;src:url(x)}')]);
    const before = fontFaceSignature(document);
    setStyleSheets([sheet('@font-face{font-family:A;src:url(x)}', '@font-face{font-family:B;src:url(y)}')]);
    expect(fontFaceSignature(document)).not.toBe(before);
  });

  it('ignores cross-origin stylesheets that throw on cssRules access (unreadable anyway)', () => {
    const crossOrigin = { get cssRules() { throw new Error('SecurityError'); } };
    setStyleSheets([crossOrigin, sheet('@font-face{font-family:A;src:url(x)}')]);
    expect(() => fontFaceSignature(document)).not.toThrow();
    expect(fontFaceSignature(document)).toContain('A');
  });
});

describe('getCachedFontEmbedCSS — embed once, reuse until the font set changes', () => {
  it('returns the embedded font CSS from html-to-image', async () => {
    setStyleSheets([sheet('@font-face{font-family:A;src:url(x)}')]);
    expect(await getCachedFontEmbedCSS(document.body)).toContain('@font-face');
  });

  it('embeds only ONCE across repeated captures with the same fonts', async () => {
    setStyleSheets([sheet('@font-face{font-family:A;src:url(x)}')]);
    await getCachedFontEmbedCSS(document.body);
    await getCachedFontEmbedCSS(document.body);
    expect(getFontEmbedCSS).toHaveBeenCalledTimes(1);
  });

  it('re-embeds when the font set changes (e.g. a story injects a custom web font)', async () => {
    setStyleSheets([sheet('@font-face{font-family:A;src:url(x)}')]);
    await getCachedFontEmbedCSS(document.body);
    setStyleSheets([sheet('@font-face{font-family:A;src:url(x)}', '@font-face{font-family:Custom;src:url(z)}')]);
    await getCachedFontEmbedCSS(document.body);
    expect(getFontEmbedCSS).toHaveBeenCalledTimes(2);
  });

  it('does not permanently cache a failure — recovers on the next call', async () => {
    setStyleSheets([sheet('@font-face{font-family:A;src:url(x)}')]);
    vi.mocked(getFontEmbedCSS).mockRejectedValueOnce(new Error('network'));
    expect(await getCachedFontEmbedCSS(document.body)).toBe(''); // graceful: capture proceeds sans fonts
    expect(await getCachedFontEmbedCSS(document.body)).toContain('@font-face'); // retried
    expect(getFontEmbedCSS).toHaveBeenCalledTimes(2);
  });
});
