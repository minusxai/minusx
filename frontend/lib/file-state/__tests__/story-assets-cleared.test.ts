/**
 * A story's saved-question dependencies derive from its JSX body; the legacy `assets` manifest is
 * obsolete and must not survive a re-save.
 *
 * The subtlety this pins is WHY `file-edit.ts` assigns `assets = undefined` rather than `delete`-ing
 * the key. Staged edits are recombined with the stored content by SPREAD — in the save path and in
 * `selectMergedContent` — and a spread cannot remove a key. `delete` therefore leaves the stored
 * manifest fully intact while looking like it cleared it; only an explicit `undefined` overrides.
 */
import { describe, it, expect } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import filesReducer, { setFile, setEdit, selectMergedContent } from '@/store/filesSlice';
import authReducer from '@/store/authSlice';
import type { DbFile } from '@/lib/types';

function makeStore() {
  return configureStore({ reducer: { files: filesReducer, auth: authReducer } });
}

const storyWithAssets = {
  id: 42,
  name: 'Story',
  path: '/org/story',
  type: 'story',
  content: {
    format: 'jsx',
    story: '<section><h2>A</h2></section>',
    assets: [{ type: 'question', id: 7 }],
  },
} as unknown as DbFile;

describe('a re-saved story drops its legacy `assets` manifest', () => {
  it('clears assets through the SPREAD merge that recombines staged edits', () => {
    const store = makeStore();
    store.dispatch(setFile({ file: storyWithAssets }));

    // Exactly what `stageMarkupContentEdit` stages for a story.
    const staged = {
      format: 'jsx',
      story: '<section><h2>B</h2></section>',
      assets: undefined,
    };
    store.dispatch(setEdit({ fileId: 42, edits: staged }));

    const merged = selectMergedContent(store.getState() as any, 42) as Record<string, unknown>;
    expect(merged.story).toBe('<section><h2>B</h2></section>');
    // The point: it survives the spread as an explicit override.
    expect(merged.assets).toBeUndefined();
  });

  it('a `delete`d key would NOT clear it — which is why undefined is required', () => {
    const store = makeStore();
    store.dispatch(setFile({ file: storyWithAssets }));

    // The tempting "tidy-up": build the same object but remove the key instead of nulling it.
    const staged: Record<string, unknown> = {
      format: 'jsx',
      story: '<section><h2>B</h2></section>',
      assets: [{ type: 'question', id: 7 }],
    };
    delete staged.assets;
    store.dispatch(setEdit({ fileId: 42, edits: staged }));

    const merged = selectMergedContent(store.getState() as any, 42) as Record<string, unknown>;
    // The stored manifest comes straight back through the spread. This is the bug the
    // `undefined` assignment exists to prevent — if this ever asserts undefined, the merge
    // stopped being a spread and `file-edit.ts`'s comment needs revisiting.
    expect(merged.assets).toEqual([{ type: 'question', id: 7 }]);
  });
});
