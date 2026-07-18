/**
 * Story embed leverage points — render-layer wiring:
 * - a SAVED embed's `data-question-viz` override flows AgentHtml discovery → StoryEmbeds →
 *   SmartEmbeddedQuestionContainer, which applies it as a FULL viz replace on the merged content;
 * - an INLINE spreadsheet embed's data + V2 envelope reach EmbeddedQuestionContainer verbatim
 *   (no SQL involved).
 * The embed containers are mocked to capture props (the chart stack itself is not under test).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import * as storeModule from '@/store/store';
import { setFile } from '@/store/filesSlice';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { savedQuestionToPlaceholder, inlineQuestionToPlaceholder } from '@/lib/data/story/story-question';
import type { VizEnvelope, SpreadsheetSource, QuestionContent } from '@/lib/validation/atlas-schemas';
import type { DbFile } from '@/lib/types';

const captured = vi.hoisted(() => ({
  smart: [] as Record<string, unknown>[],
  embedded: [] as Record<string, unknown>[],
}));

vi.mock('@/components/containers/EmbeddedQuestionContainer', async () => {
  const React = await import('react');
  const Fake = (props: Record<string, unknown>) => {
    captured.embedded.push(props);
    return React.createElement('div', { 'aria-label': 'Embedded question body' });
  };
  return { __esModule: true, default: Fake };
});

import AgentHtml from '../AgentHtml';
import SmartEmbeddedQuestionContainer from '@/components/containers/SmartEmbeddedQuestionContainer';

const overrideEnvelope: VizEnvelope = {
  version: 2,
  source: { kind: 'table', columnFormats: null, conditionalFormats: null, css: '.mx-th{background:#111}' },
};

const sheet: SpreadsheetSource = {
  version: 1,
  columns: [{ name: 'month', type: 'text' }, { name: 'mrr', type: 'number' }],
  rows: [['Jan', '120'], ['Feb', '140']],
};

function makeQuestionFile(id: number, content: Partial<QuestionContent> = {}): DbFile {
  return {
    id,
    name: `Question ${id}`,
    type: 'question' as const,
    path: `/org/Question ${id}`,
    content: {
      query: 'SELECT 1',
      vizSettings: { type: 'bar' as const },
      connection_name: 'duckdb',
      ...content,
    } as QuestionContent,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    references: [] as number[],
    version: 1,
    last_edit_id: null,
  } as DbFile;
}

beforeEach(() => {
  captured.smart.length = 0;
  captured.embedded.length = 0;
});

describe('SmartEmbeddedQuestionContainer — vizOverride prop', () => {
  it('applies the override as a FULL replace of the merged content viz', async () => {
    const testStore = storeModule.makeStore();
    vi.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
    const savedViz: VizEnvelope = {
      version: 2,
      source: { kind: 'recipe', recipe: 'minusx/funnel@1', bindings: {}, params: null, columnFormats: null },
    };
    testStore.dispatch(setFile({ file: makeQuestionFile(42, { viz: savedViz }), references: [] }));

    renderWithProviders(
      <SmartEmbeddedQuestionContainer questionId={42} vizOverride={overrideEnvelope} />,
      { store: testStore },
    );
    await waitFor(() => expect(captured.embedded.length).toBeGreaterThan(0), { timeout: 3000 });
    const q = captured.embedded.at(-1)!.question as QuestionContent;
    expect(q.viz).toEqual(overrideEnvelope);
    expect(q.vizSettings ?? null).toBeNull();
    expect(q.query).toBe('SELECT 1');
  });

  it('renders the saved question viz untouched when no override is present', async () => {
    const testStore = storeModule.makeStore();
    vi.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
    testStore.dispatch(setFile({ file: makeQuestionFile(43), references: [] }));

    renderWithProviders(<SmartEmbeddedQuestionContainer questionId={43} />, { store: testStore });
    await waitFor(() => expect(captured.embedded.length).toBeGreaterThan(0), { timeout: 3000 });
    const q = captured.embedded.at(-1)!.question as QuestionContent;
    expect(q.vizSettings).toEqual({ type: 'bar' });
  });
});

describe('AgentHtml discovery — embed leverage points reach the embed containers', () => {
  it('a saved placeholder with data-question-viz renders with the override applied', async () => {
    const testStore = storeModule.makeStore();
    vi.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
    // StoryEmbeds' nested iframe root re-provides Redux from the app singleton — point it at the test store.
    vi.spyOn(storeModule, 'getOrCreateStore').mockReturnValue(testStore);
    testStore.dispatch(setFile({ file: makeQuestionFile(42), references: [] }));

    const html = `<div>${savedQuestionToPlaceholder(42, '300px', overrideEnvelope)}</div>`;
    render(<AgentHtml html={html} width={800} colorMode="light" />);

    await waitFor(() => expect(captured.embedded.length).toBeGreaterThan(0), { timeout: 3000 });
    const q = captured.embedded.at(-1)!.question as QuestionContent;
    expect(q.viz).toEqual(overrideEnvelope);
    expect(q.vizSettings ?? null).toBeNull();
  });

  it('an inline spreadsheet placeholder reaches EmbeddedQuestionContainer with data + envelope', async () => {
    const html = `<div>${inlineQuestionToPlaceholder({ connection: '', spreadsheet: sheet, viz: overrideEnvelope })}</div>`;
    render(<AgentHtml html={html} width={800} colorMode="light" />);

    await waitFor(() => expect(captured.embedded.length).toBeGreaterThan(0));
    const q = captured.embedded.at(-1)!.question as QuestionContent;
    expect(q.spreadsheet).toEqual(sheet);
    expect(q.viz).toEqual(overrideEnvelope);
    expect(q.query).toBe('');
  });
});
