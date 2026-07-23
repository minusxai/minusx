/**
 * Story loader (Renderer_v2 Phase 6a): `compiledCss` is compiled at SAVE time, so a story saved
 * before the embed-chrome class set grew (kit + EMBED_CHROME_FILES recipe union) carries a STALE
 * sheet — and after the 6a mirror shrink there is no app-CSS mirror left to paper over it. The
 * loader recompiles stale stories AT READ TIME (no persist — the next save persists it), keyed
 * by a version hash of the recipe union, and passes current stories through untouched.
 */
import { describe, it, expect } from 'vitest';
import { storyLoader } from '@/lib/data/loaders/story-loader';
import { storyCssCompileVersion } from '@/lib/data/story/story-css.server';
import type { DbFile } from '@/lib/types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const USER = { userId: 'u', email: 'u@x.com', role: 'admin', mode: 'org', home_folder: '' } as unknown as EffectiveUser;

const STORY_JSX = '<section className="p-4"><h1 className="text-2xl font-bold">Hi</h1></section>';

function makeStory(content: Record<string, unknown> | null): DbFile {
  return {
    id: 7, name: 'S', path: '/org/S', type: 'story', content,
    created_at: '', updated_at: '', references: [], version: 1, last_edit_id: null,
  } as unknown as DbFile;
}

describe('storyLoader', () => {
  it('recompiles a story whose cssCompileVersion is missing/stale, stamping the current version', async () => {
    const file = makeStory({ story: STORY_JSX, format: 'jsx', compiledCss: '/*STALE*/' });
    const out = await storyLoader(file, USER);
    const content = out.content as { compiledCss?: string | null; cssCompileVersion?: string };
    expect(content.compiledCss).not.toBe('/*STALE*/');
    expect(content.compiledCss).toContain('text-2xl');
    expect(content.cssCompileVersion).toBe(storyCssCompileVersion());
  });

  it('passes a current-version story through without recompiling', async () => {
    const file = makeStory({
      story: STORY_JSX, format: 'jsx',
      compiledCss: '/*CURRENT-SENTINEL*/', cssCompileVersion: storyCssCompileVersion(),
    });
    const out = await storyLoader(file, USER);
    expect((out.content as { compiledCss?: string | null }).compiledCss).toBe('/*CURRENT-SENTINEL*/');
  });

  it('passes stories without a body (metadata-only loads) through', async () => {
    const file = makeStory(null);
    expect(await storyLoader(file, USER)).toBe(file);
  });
});
