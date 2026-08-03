// The legacy-story tag: isLegacyStory classifies (modern ⇔ format:'jsx' AND
// Tailwind-only; everything else legacy, empty bodies included), and the V39
// migration stamps meta.tags idempotently while preserving other meta keys and
// non-story documents. All fixtures are SYNTHETIC.
import { describe, it, expect } from 'vitest';
import { isLegacyStory } from '@/lib/data/story/file-markup';
import { v39TagLegacyStories, applyMigrations } from '@/lib/database/migrations';
import type { InitData } from '@/lib/database/import-export';
import { FILE_TAG_LEGACY_STORY, getFileTags } from '@/lib/types/files';

const CLEAN_JSX = {
  format: 'jsx', description: null, assets: [],
  story: '<div data-design="tw" className="@container w-full"><p className="text-sm">hi</p></div>',
};
const DIRTY_JSX = {
  format: 'jsx', description: null, assets: [],
  story: '<div data-design="tw" className="w-full"><span style={{color:"red"}}>x</span></div>',
};
const LEGACY_HTML = { description: null, assets: [], story: '<h1 style="color:red">Old pipeline</h1>' };
const EMPTY = { description: null, assets: [], story: '' };

describe('isLegacyStory (the ratified classifier)', () => {
  it('modern ⇔ format jsx AND Tailwind-only', () => {
    expect(isLegacyStory(CLEAN_JSX)).toBe(false);
    expect(isLegacyStory(DIRTY_JSX)).toBe(true);   // styled jsx = legacy
    expect(isLegacyStory(LEGACY_HTML)).toBe(true); // old HTML pipeline
    expect(isLegacyStory(EMPTY)).toBe(true);       // empty body = legacy (ratified)
    expect(isLegacyStory(null)).toBe(true);
    expect(isLegacyStory({ format: 'jsx', story: '<style>.x{}</style><div/>', description: null, assets: [] })).toBe(true);
  });
});

describe('getFileTags', () => {
  it('tolerates absent/malformed meta', () => {
    expect(getFileTags(null)).toEqual([]);
    expect(getFileTags(undefined)).toEqual([]);
    expect(getFileTags({ tags: 'nope' })).toEqual([]);
    expect(getFileTags({ tags: ['a', 7, 'b'] })).toEqual(['a', 'b']);
  });
});

const doc = (id: number, type: string, content: Record<string, unknown>, meta?: Record<string, unknown> | null) => ({
  id, name: `d${id}`, path: `/org/d${id}`, type, content,
  references: [], created_at: 't', updated_at: 't', meta: meta ?? null,
});

describe('V39 migration: tag legacy stories', () => {
  it('tags exactly the legacy stories, preserves other meta keys and non-story docs', () => {
    const data = {
      documents: [
        doc(1, 'story', CLEAN_JSX),
        doc(2, 'story', DIRTY_JSX),
        doc(3, 'story', LEGACY_HTML, { shares: [{ nonce: 'keepme' }] }),
        doc(4, 'story', EMPTY),
        doc(5, 'question', { query: 'SELECT 1' }),
      ],
    } as unknown as InitData;

    const out = v39TagLegacyStories(data);
    const metaOf = (id: number) => out.documents!.find(d => d.id === id)!.meta as Record<string, unknown> | null;

    expect(getFileTags(metaOf(1))).toEqual([]);
    expect(getFileTags(metaOf(2))).toEqual([FILE_TAG_LEGACY_STORY]);
    expect(getFileTags(metaOf(3))).toEqual([FILE_TAG_LEGACY_STORY]);
    expect(getFileTags(metaOf(4))).toEqual([FILE_TAG_LEGACY_STORY]);
    // Sibling meta keys survive the read-modify-write.
    expect((metaOf(3) as { shares?: unknown[] }).shares).toEqual([{ nonce: 'keepme' }]);
    // Non-story documents pass through untouched.
    expect(metaOf(5)).toBeNull();
    // Input is not mutated.
    expect(getFileTags((data.documents![2] as { meta?: Record<string, unknown> | null }).meta)).toEqual([]);
  });

  it('is idempotent, and removes a stale tag from a story that became modern', () => {
    const tagged = doc(1, 'story', CLEAN_JSX, { tags: [FILE_TAG_LEGACY_STORY], shares: [] });
    const already = doc(2, 'story', LEGACY_HTML, { tags: [FILE_TAG_LEGACY_STORY] });
    const out = v39TagLegacyStories({ documents: [tagged, already] } as unknown as InitData);

    // Stale tag removed (story is modern now); correct tag untouched, no duplicates.
    expect(getFileTags(out.documents![0].meta as Record<string, unknown>)).toEqual([]);
    expect(getFileTags(out.documents![1].meta as Record<string, unknown>)).toEqual([FILE_TAG_LEGACY_STORY]);

    const again = v39TagLegacyStories(out);
    expect(getFileTags(again.documents![1].meta as Record<string, unknown>)).toEqual([FILE_TAG_LEGACY_STORY]);
  });

  it('runs as part of applyMigrations from v38', () => {
    const data = { documents: [doc(1, 'story', LEGACY_HTML)] } as unknown as InitData;
    const out = applyMigrations(data, 38);
    expect(getFileTags(out.documents![0].meta as Record<string, unknown>)).toEqual([FILE_TAG_LEGACY_STORY]);
  });
});
