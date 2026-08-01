/**
 * The edit loop's context cost.
 *
 * `FacetMemo` diffs a facet by exact hash: identical → a tiny `{unchanged:true}` marker, different
 * → the value in FULL. For file *markup* that is all-or-nothing on a document that is edited one
 * line at a time, so an authoring session re-sent the WHOLE story on every single turn. Measured on
 * a 40-section story: ~5.5k tokens per turn while editing versus 42 tokens per turn while idle —
 * a 131x gap that filled the context window in a couple of exchanges.
 *
 * The projection must therefore be INCREMENTAL for markup: when a baseline for this file is already
 * in the conversation, send what changed, not the whole document.
 */
import { describe, it, expect } from 'vitest';
import { FacetMemo } from '../facets';
import { renderAppState } from '../messages';
import type { AppState } from '@/lib/appState';
import type { CompressedAugmentedFile, CompressedFileState } from '@/lib/types';

const SECTIONS = 40;

/** A story whose section `edited` differs; every other section is byte-identical across revisions. */
function storyMarkup(edited: number, revision: number): string {
  const sections = Array.from({ length: SECTIONS }, (_, i) => {
    const heading = i === edited ? `Section ${i} rev${revision}` : `Section ${i}`;
    return `<section class="mb-8"><h2 class="text-2xl font-bold">${heading}</h2>`
      + `<p class="text-base">${'Narrative sentence describing the finding in the data. '.repeat(8)}</p></section>`;
  });
  return `<story>\n${sections.join('\n')}\n</story>`;
}

const appStateFor = (markup: string): AppState => ({
  type: 'file',
  state: {
    fileState: {
      id: 1, name: 'story', path: '/org/story', type: 'story', isDirty: false, queryResultId: 'h1', markup,
    } as CompressedFileState,
    references: [],
    queryResults: [
      { id: 'h1', columns: ['a'], types: ['number'], data: '', totalRows: 1, shownRows: 1, truncated: false },
    ],
  } as CompressedAugmentedFile,
});

const textChars = (blocks: Array<{ type: string; text?: string }>) =>
  blocks.reduce((n, b) => (b.type === 'text' ? n + (b.text?.length ?? 0) : n), 0);

describe('markup projection is incremental across an edit loop', () => {
  it('re-sends only what changed when one section of a long story is edited', () => {
    const memo = new FacetMemo();

    // Turn 0 establishes the baseline: the full document, necessarily.
    const first = textChars(renderAppState(memo, appStateFor(storyMarkup(3, 0))) as any);
    expect(first).toBeGreaterThan(10_000);

    // Turns 1..3 each change ONE section out of 40.
    const subsequent = [1, 2, 3].map(
      (rev) => textChars(renderAppState(memo, appStateFor(storyMarkup(3, rev))) as any)
    );

    // Each follow-up turn must cost a fraction of the full document, not all of it.
    for (const chars of subsequent) {
      expect(chars).toBeLessThan(first / 4);
    }
  });

  it('still collapses to a marker when nothing changed at all', () => {
    const memo = new FacetMemo();
    const markup = storyMarkup(3, 0);
    const first = textChars(renderAppState(memo, appStateFor(markup)) as any);
    const second = textChars(renderAppState(memo, appStateFor(markup)) as any);
    expect(second).toBeLessThan(first / 50);
  });

  it('sends the full document when there is no baseline for this file yet', () => {
    // A fresh memo has never seen file 1 — an incremental payload would be unresolvable.
    const full = textChars(renderAppState(new FacetMemo(), appStateFor(storyMarkup(3, 7))) as any);
    expect(full).toBeGreaterThan(10_000);
  });
});
