/**
 * Neutral font-asset mechanism (Story_Design_V2 §4/§11 Phase 2): the PLATFORM provides story fonts
 * for jsx stories — a theme registry maps theme name → font assets (family + static asset URL), and
 * `getStoryFontCss` turns the active theme's entries into @font-face CSS. The live view loads fonts
 * by URL (cacheable static assets under /fonts); the data-URI form exists only in the capture-time
 * parsed copy (lib/story-surface/serialize inlines url() → data: at serialization).
 */
import { describe, it, expect } from 'vitest';
import { getStoryFontCss, STORY_FONT_THEMES, STORY_FONTS_ATTR } from '@/lib/data/story/story-fonts';

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
