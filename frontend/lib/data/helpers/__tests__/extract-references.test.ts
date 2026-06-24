/**
 * Content → reference-ID extraction. There are TWO entry points that MUST agree (the second
 * now delegates to the first):
 *  - extractReferencesFromContent (client save path: file-state.ts, filesSlice.ts)
 *  - extractReferences in compress-augmented.ts (DbFile → FileState / app state)
 *
 * A STORY's body is the single source of truth: its saved-question dependencies are the
 * `data-question-id` embeds in content.story — NOT a separate `assets` field (which stories no
 * longer have). Inline `<Question query=…>` embeds carry no file id, so they are not references.
 */
import { extractReferencesFromContent } from '@/lib/data/helpers/extract-references';
import { extractReferences } from '@/lib/api/compress-augmented';
import type { DbFile } from '@/lib/types';

// A story embedding saved questions 3 and 9 in its body, plus an inline (file-less) question.
const storyContent = {
  description: null,
  story:
    '<div data-question-id="3" style="width:100%;height:420px"></div>' +
    '<div data-question-inline="{&quot;query&quot;:&quot;SELECT 1&quot;,&quot;connection_name&quot;:&quot;duckdb&quot;}" style="width:100%;height:200px"></div>' +
    '<div data-question-id="9" style="width:100%;height:420px"></div>',
};

describe('extractReferencesFromContent — story (derived from the body)', () => {
  it('extracts saved-question ids from the body embeds, ignoring inline questions', () => {
    expect(extractReferencesFromContent(storyContent as any, 'story')).toEqual([3, 9]);
  });

  it('returns empty for a story with no embeds', () => {
    expect(extractReferencesFromContent({ description: null, story: '<div>just prose</div>' } as any, 'story')).toEqual([]);
    expect(extractReferencesFromContent({ description: null, story: null } as any, 'story')).toEqual([]);
  });
});

describe('extractReferences (compress-augmented) — delegates, so it agrees', () => {
  it('derives the same story refs from the body', () => {
    const file = { id: 1, type: 'story', content: storyContent } as unknown as DbFile;
    expect(extractReferences(file)).toEqual([3, 9]);
  });
});

describe('extractReferencesFromContent — dashboard still uses assets', () => {
  it('reads question ids from the assets manifest (dashboards have no body)', () => {
    const dash = { assets: [{ type: 'question', id: 5 }, { type: 'text', id: 't1' }, { type: 'question', id: 8 }] };
    expect(extractReferencesFromContent(dash as any, 'dashboard')).toEqual([5, 8]);
  });
});
