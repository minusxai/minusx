/**
 * preloadStoryFonts — warms the TOP document's font cache for the platform story fonts, so a
 * story-iframe remount (every agent edit rebuilds the iframe from scratch) re-registers its
 * `font-display: swap` @font-face rules against an already-cached font file instead of painting
 * fallback text and re-laying-out when the font arrives (the visible font flash of Bug S7).
 *
 * Contract: FontFace API + document.fonts.add, one registration per distinct asset
 * (family+url+weight+style), idempotent across calls/themes; safe no-op where FontFace is
 * unavailable (jsdom, SSR).
 *
 * NOTE: the dedup registry is module-level by design (fonts are per-browser-tab), so the tests
 * in this file are ordered and share that state deliberately.
 */
import { preloadStoryFonts, STORY_FONT_THEMES } from '@/lib/data/story/story-fonts';
import { STORY_THEMES } from '@/lib/data/story/story-themes';

class FakeFontFace {
  family: string;
  source: string;
  descriptors?: FontFaceDescriptors;
  load = vi.fn().mockReturnValue(Promise.resolve(this));
  constructor(family: string, source: string, descriptors?: FontFaceDescriptors) {
    this.family = family;
    this.source = source;
    this.descriptors = descriptors;
  }
}

let added: FakeFontFace[];

beforeEach(() => {
  added = [];
  vi.stubGlobal('FontFace', FakeFontFace);
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { add: (f: FakeFontFace) => added.push(f) },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('preloadStoryFonts (ordered — shares the module-level dedup registry)', () => {
  it('registers and loads every neutral asset in the top document (unknown theme falls back to neutral)', () => {
    preloadStoryFonts('no-such-theme');
    expect(added.length).toBe(STORY_FONT_THEMES.neutral.length);
    const families = added.map(f => f.family).sort();
    expect(families).toEqual(STORY_FONT_THEMES.neutral.map(a => a.family).sort());
    for (const face of added) {
      expect(face.source).toContain('url(');
      expect(face.load).toHaveBeenCalled();
    }
  });

  it('is idempotent — repeat calls register nothing new', () => {
    preloadStoryFonts();
    preloadStoryFonts('neutral');
    expect(added.length).toBe(0);
  });

  it('dedupes per asset across themes — theme assets already covered by neutral add nothing', () => {
    // Every theme's assets come from the same bundled catalog neutral already covers.
    for (const t of STORY_THEMES) preloadStoryFonts(t.name);
    expect(added.length).toBe(0);
  });

  it('is a safe no-op where FontFace is unavailable', () => {
    vi.stubGlobal('FontFace', undefined);
    expect(() => preloadStoryFonts('some-brand-new-theme')).not.toThrow();
    expect(added.length).toBe(0);
  });
});
