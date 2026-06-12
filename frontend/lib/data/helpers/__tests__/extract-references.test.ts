/**
 * Content → reference-ID extraction. There are TWO extractors that must agree:
 *  - extractReferencesFromContent (client save path: file-state.ts, filesSlice.ts)
 *  - extractReferences in compress-augmented.ts (DbFile → FileState / app state)
 * Story files cache their question references from content.assets, exactly
 * like dashboards.
 */
import { extractReferencesFromContent } from '@/lib/data/helpers/extract-references';
import { extractReferences } from '@/lib/api/compress-augmented';
import type { DbFile, StoryContent } from '@/lib/types';

const storyContent: StoryContent = {
  description: null,
  assets: [
    { type: 'question', id: 3 },
    { type: 'question', id: 9 },
  ],
  story: '<div data-question-id="3" style="width:1100px;height:420px"></div>',
};

describe('extractReferencesFromContent — story', () => {
  it('extracts question ids from the assets array', () => {
    expect(extractReferencesFromContent(storyContent as any, 'story')).toEqual([3, 9]);
  });

  it('returns empty array for an empty story', () => {
    expect(extractReferencesFromContent({ description: null, assets: [], story: null } as any, 'story')).toEqual([]);
  });
});

describe('extractReferences (compress-augmented) — story', () => {
  it('extracts question ids from the assets array', () => {
    const file = { id: 1, type: 'story', content: storyContent } as unknown as DbFile;
    expect(extractReferences(file)).toEqual([3, 9]);
  });
});
