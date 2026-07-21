/**
 * Story design themes (Story_Design_V2 §5) — registry + CSS emitter contract.
 *
 * One registry (`STORY_THEMES`), four consumers: the CSS emitter, the picker UI, preview
 * generation, and the font-asset mapping. These tests pin:
 *  - completeness: one entry per schema enum name, with label/description/fonts,
 *  - the token contract: every var TW_INPUT_JSX maps (+ --radius) present in BOTH modes,
 *  - the emitter: `[data-theme="<name>"]` light block, `.dark`-scoped dark block, font rules.
 */
import { describe, it, expect } from 'vitest';
import { STORY_THEMES, STORY_THEME_NAMES, getStoryTheme, storyThemeCss } from '../story-themes';

/** Exactly the CSS variables TW_INPUT_JSX maps utilities onto, plus --radius. */
const REQUIRED_VARS = [
  '--background', '--foreground',
  '--card', '--card-foreground',
  '--popover', '--popover-foreground',
  '--primary', '--primary-foreground',
  '--secondary', '--secondary-foreground',
  '--muted', '--muted-foreground',
  '--accent', '--accent-foreground',
  '--destructive', '--destructive-foreground',
  '--border', '--input', '--ring',
  '--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5',
  '--radius',
];

describe('STORY_THEMES registry', () => {
  it('has exactly one entry per schema enum name, in enum order', () => {
    expect(STORY_THEMES.map(t => t.name)).toEqual([...STORY_THEME_NAMES]);
  });

  it('every theme carries label, description and display/body fonts', () => {
    for (const t of STORY_THEMES) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.fonts.display.length).toBeGreaterThan(0);
      expect(t.fonts.body.length).toBeGreaterThan(0);
    }
  });

  it('every theme defines the FULL token contract in BOTH modes', () => {
    for (const t of STORY_THEMES) {
      for (const mode of ['light', 'dark'] as const) {
        const vars = t.cssVars[mode];
        for (const name of REQUIRED_VARS) {
          expect(vars[name], `${t.name}.${mode} ${name}`).toBeTruthy();
        }
        // No stray keys outside the contract — the emitter ships exactly these.
        expect(Object.keys(vars).sort()).toEqual([...REQUIRED_VARS].sort());
      }
    }
  });

  it('radius expresses each personality (§5 table): modernist 0, organic ≥ 1rem, industry ≤ 0.125rem', () => {
    expect(getStoryTheme('modernist')!.cssVars.light['--radius']).toBe('0rem');
    expect(parseFloat(getStoryTheme('organic')!.cssVars.light['--radius'])).toBeGreaterThanOrEqual(1);
    expect(parseFloat(getStoryTheme('industry')!.cssVars.light['--radius'])).toBeLessThanOrEqual(0.125);
  });

  it('getStoryTheme resolves by name and is undefined for unknown/null', () => {
    expect(getStoryTheme('nocturne')?.label).toBeTruthy();
    expect(getStoryTheme('bogus')).toBeUndefined();
    expect(getStoryTheme(null)).toBeUndefined();
    expect(getStoryTheme(undefined)).toBeUndefined();
  });
});

describe('storyThemeCss emitter', () => {
  const css = storyThemeCss();

  it('emits a [data-theme="<name>"] block with that theme\'s --primary for every theme', () => {
    for (const t of STORY_THEMES) {
      const at = css.indexOf(`[data-theme="${t.name}"]`);
      expect(at, t.name).toBeGreaterThanOrEqual(0);
      expect(css).toContain(`--primary: ${t.cssVars.light['--primary']}`);
    }
  });

  it('emits .dark-scoped dark blocks matching how AgentHtml stamps .dark on the iframe html', () => {
    // The iframe stamps .dark on <html>, an ANCESTOR of the story root carrying data-theme —
    // so the dark selector must be `.dark [data-theme=…]` (plus the same-element form).
    for (const t of STORY_THEMES) {
      expect(css).toContain(`.dark [data-theme="${t.name}"]`);
      expect(css).toContain(`[data-theme="${t.name}"].dark`);
      expect(css).toContain(t.cssVars.dark['--primary']);
    }
  });

  it('emits font-family rules from the registry fonts (body on the root, display on headings)', () => {
    const nocturne = getStoryTheme('nocturne')!;
    expect(css).toContain(`"${nocturne.fonts.body}"`);
    const classical = getStoryTheme('classical')!;
    expect(css).toContain(`"${classical.fonts.display}"`);
    // Display fonts scope to headings inside the theme root.
    expect(css).toMatch(/\[data-theme="classical"\] :is\(h1, h2, h3, h4, h5, h6\)/);
  });

  it('mono themes scope their mono family to code/pre', () => {
    const withMono = STORY_THEMES.find(t => t.fonts.mono);
    expect(withMono).toBeTruthy();
    expect(css).toContain(`[data-theme="${withMono!.name}"] :is(code, pre, kbd, samp)`);
  });
});
