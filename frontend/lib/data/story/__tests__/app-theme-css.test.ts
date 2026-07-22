/**
 * The app's main-document shadcn token layer (Renderer_v2 Phase 3): `app/theme-tokens.css`
 * is GENERATED from the same single sources the story compile uses (SHADCN_THEME_MAPPING,
 * neutral bodies, storyThemeCss). This pins:
 *  1. the generated file is IN SYNC with the sources (drift check, like the kit registry test);
 *  2. neutral values are scoped under [data-mx-theme-host] — never bare :root, which would
 *     leak shadcn vars into the Chakra app shell;
 *  3. all six [data-theme] blocks ship, and the app build imports the file.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildAppThemeCss } from '@/lib/data/story/story-css.server';
import { STORY_THEME_NAMES } from '@/lib/validation/atlas-schemas';

const cssPath = path.join(process.cwd(), 'app', 'theme-tokens.css');

describe('app/theme-tokens.css', () => {
  it('is in sync with the generator (run `npm run generate-app-theme-css` after token changes)', () => {
    expect(readFileSync(cssPath, 'utf8')).toBe(buildAppThemeCss());
  });

  it('scopes neutral values under the theme host — NEVER bare :root (Chakra shell isolation)', () => {
    const css = buildAppThemeCss();
    expect(css).toContain('[data-mx-theme-host] {');
    expect(css).toContain('.dark [data-mx-theme-host]');
    expect(css).not.toMatch(/^:root \{/m);
  });

  it('registers the token utilities and ships every design theme', () => {
    const css = buildAppThemeCss();
    expect(css).toContain('@theme inline {');
    for (const t of STORY_THEME_NAMES) expect(css).toContain(`[data-theme="${t}"]`);
  });

  it('globals.css imports the token layer', () => {
    const globals = readFileSync(path.join(process.cwd(), 'app', 'globals.css'), 'utf8');
    expect(globals).toContain(`@import "./theme-tokens.css"`);
  });
});
