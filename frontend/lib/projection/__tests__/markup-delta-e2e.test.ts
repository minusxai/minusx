/**
 * The delta path through the REAL request-assembly entry point.
 *
 * `markup-incremental.test.ts` drives `renderAppState` directly. This one goes through
 * `projectMessages` — the function that actually builds the messages sent to the model — over a
 * multi-turn log shaped like a real authoring session, so the memo is the one `projectMessages`
 * creates and the blocks are the ones the model receives.
 *
 * It also pins the boundary that decides WHEN a delta is used, which is the part that surprised us
 * in a live session: creating a story (empty draft -> full document) correctly sends the whole
 * document, because that change is not small. Only a subsequent small edit sends a diff.
 */
import { describe, it, expect } from 'vitest';
import { projectMessages } from '../messages';
import type { Message, TextContent } from '@/orchestrator/llm';
import type { AppState } from '@/lib/appState';
import type { CompressedAugmentedFile, CompressedFileState } from '@/lib/types';

const SECTIONS = 30;

function story(editedHeading: string | null): string {
  const body = Array.from({ length: SECTIONS }, (_, i) => {
    const heading = i === 4 && editedHeading ? editedHeading : `Section ${i}`;
    return `<section class="mb-8"><h2 class="text-2xl font-bold">${heading}</h2>`
      + `<p class="text-base">${'Narrative sentence describing the finding. '.repeat(6)}</p></section>`;
  });
  return `<story>\n${body.join('\n')}\n</story>`;
}

const appStateFor = (markup: string): AppState => ({
  type: 'file',
  state: {
    fileState: {
      id: 7, name: 'story', path: '/org/story', type: 'story', isDirty: false, queryResultId: 'h1', markup,
    } as CompressedFileState,
    references: [],
    queryResults: [
      { id: 'h1', columns: ['a'], types: ['number'], data: '', totalRows: 1, shownRows: 1, truncated: false },
    ],
  } as CompressedAugmentedFile,
});

const userTurn = (text: string, markup: string): Message =>
  ({ role: 'user', content: text, _appState: appStateFor(markup) } as unknown as Message);

const textOf = (m: Message) =>
  (Array.isArray(m.content) ? m.content : [])
    .filter((c): c is TextContent => c.type === 'text').map((c) => c.text).join('\n');

describe('markup deltas through projectMessages (the real assembly path)', () => {
  it('sends the document once, then a diff for each subsequent small edit', () => {
    const out = projectMessages([
      userTurn('write it', story(null)),
      userTurn('tweak the heading', story('Section 4 revised')),
      userTurn('tweak it again', story('Section 4 revised twice')),
    ]);

    const first = textOf(out[0]);
    expect(first).toContain('<file_markup ');
    expect(first).not.toContain('<file_markup_delta');
    expect(first).toContain('"state":"present"');

    for (const later of [textOf(out[1]), textOf(out[2])]) {
      expect(later).toContain('<file_markup_delta');
      expect(later).toContain('"state":"delta"');
      // The whole document must NOT be repeated.
      expect(later).not.toContain('Section 29');
      expect(later.length).toBeLessThan(first.length / 4);
    }
  });

  it('tells the model the block is a diff and how to reuse its lines', () => {
    const out = projectMessages([
      userTurn('write it', story(null)),
      userTurn('tweak', story('Section 4 revised')),
    ]);
    const delta = textOf(out[1]);
    expect(delta).toMatch(/LINE DIFF/i);
    expect(delta).toContain('oldMatch');
    // it names the file whose full markup it rebases onto
    expect(delta).toContain('file_id="7"');
  });

  it('sends the FULL document when the change is too large to be worth diffing', () => {
    // An empty draft becoming a whole story — the live-session case. A "diff" here would be the
    // entire document plus diff markers, so the full markup must win.
    const out = projectMessages([
      userTurn('new story', '<story>\n</story>'),
      userTurn('fill it in', story(null)),
    ]);
    const second = textOf(out[1]);
    expect(second).toContain('<file_markup ');
    expect(second).not.toContain('<file_markup_delta');
  });

  it('still collapses to a marker when the story did not change between turns', () => {
    const same = story(null);
    const out = projectMessages([userTurn('a', same), userTurn('b', same)]);
    const second = textOf(out[1]);
    expect(second).toContain('"state":"unchanged"');
    expect(second).not.toContain('<file_markup ');
    expect(second).not.toContain('<file_markup_delta');
  });
});
