/**
 * Story loader (Renderer_v2 Phase 6a): recompile STALE `compiledCss` at read time.
 *
 * `compiledCss` is compiled at save time from the story markup ∪ the recipe union (kit +
 * embed-chrome classes). When that union GROWS (an embed component is re-skinned), every
 * previously-saved story's sheet is missing classes its embeds now use — and after the 6a
 * mirror shrink there is no app-CSS mirror in the iframe to paper over it. The loader detects
 * staleness via the compile-environment version stamp and serves a freshly compiled sheet
 * (no persist — write-on-read is a smell; the next save persists the stamp).
 */
import type { CustomLoader } from './types';
import { withCompiledStoryCss, storyCssCompileVersion } from '@/lib/data/story/story-css.server';
import type { CompiledCssStoryContent } from '@/lib/data/story/story-css';

export const storyLoader: CustomLoader = async (file) => {
  if (file.type !== 'story') return file;
  const content = file.content as CompiledCssStoryContent | null;
  if (!content?.story) return file;
  if (content.cssCompileVersion === storyCssCompileVersion()) return file;
  return { ...file, content: await withCompiledStoryCss(content) };
};
