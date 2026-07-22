/**
 * Neutral font-asset mechanism (Story_Design_V2 §4/§11 Phase 2): the PLATFORM provides story fonts
 * for jsx stories — a theme registry maps theme name → font assets (family + static asset URL), and
 * `getStoryFontCss` turns the active theme's entries into @font-face CSS. The live view loads fonts
 * by URL (cacheable static assets under /fonts); the data-URI form exists only in the capture-time
 * parsed copy (lib/story-surface/serialize inlines url() → data: at serialization).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { getStoryFontCss, STORY_FONT_THEMES, STORY_FONTS_ATTR } from '@/lib/data/story/story-fonts';
import { STORY_THEMES } from '@/lib/data/story/story-themes';

describe('getStoryFontCss — theme registry → @font-face CSS', () => {
  it('returns one @font-face rule per registered asset of the neutral default theme', () => {
    const css = getStoryFontCss();
    const rules = css.match(/@font-face/g) ?? [];
    expect(rules.length).toBe(STORY_FONT_THEMES.neutral.length);
  });

  it('every rule points at a same-origin static asset URL (never a data: URI in the live form)', () => {
    const css = getStoryFontCss('neutral');
    for (const asset of STORY_FONT_THEMES.neutral) {
      expect(css).toContain(`url("${asset.url}")`);
      expect(css).toContain(`font-family: "${asset.family}"`);
      expect(asset.url.startsWith('/')).toBe(true); // URL-loaded static asset, not data:
    }
    expect(css).not.toContain('data:');
  });

  it('an unknown theme falls back to the neutral default (mechanism, not a hard failure)', () => {
    expect(getStoryFontCss('no-such-theme')).toBe(getStoryFontCss('neutral'));
  });

  it('carries weight/style descriptors when the registry entry declares them', () => {
    const withStyle = Object.values(STORY_FONT_THEMES).flat().find((a) => a.style);
    // The neutral registry includes an italic serif — the descriptor must survive into the CSS.
    expect(withStyle).toBeTruthy();
    expect(getStoryFontCss()).toContain('font-style: italic');
  });

  it('exports the in-root style node marker attribute for render + save-strip paths', () => {
    expect(STORY_FONTS_ATTR).toBe('data-mx-fonts');
  });
});

// Phase 3: per-theme font assets — every registry theme maps its display/body (and mono)
// families to bundled public/fonts assets; getStoryFontCss(theme) returns that theme's set.
describe('per-theme font assets (Story_Design_V2 §5)', () => {
  it('every STORY_THEMES entry has a font-asset set covering its families', () => {
    for (const t of STORY_THEMES) {
      const assets = STORY_FONT_THEMES[t.name];
      expect(assets, t.name).toBeTruthy();
      const families = new Set(assets.map(a => a.family));
      expect(families.has(t.fonts.display), `${t.name} display ${t.fonts.display}`).toBe(true);
      expect(families.has(t.fonts.body), `${t.name} body ${t.fonts.body}`).toBe(true);
      if (t.fonts.mono) expect(families.has(t.fonts.mono), `${t.name} mono`).toBe(true);
    }
  });

  it('getStoryFontCss(theme) returns @font-face rules for that theme\'s families', () => {
    const css = getStoryFontCss('classical');
    expect(css).toContain('@font-face');
    expect(css).toContain('"Noto Serif"');
    // Classical is serif-only — a neutral-fallback answer (which carries Inter) would be wrong.
    expect(css).not.toContain('"Inter"');
    // URL form only — data-URIs are capture-time-spliced, never in the live form.
    expect(css).not.toContain('data:');
    expect(css).toMatch(/url\("\/fonts\//);
  });

  it('every registered asset points at a real bundled file under public/fonts', () => {
    const files = new Set(readdirSync(path.join(process.cwd(), 'public', 'fonts')));
    for (const assets of Object.values(STORY_FONT_THEMES)) {
      for (const a of assets) {
        expect(a.url.startsWith('/fonts/'), a.url).toBe(true);
        expect(files.has(a.url.slice('/fonts/'.length)), a.url).toBe(true);
      }
    }
  });
});
