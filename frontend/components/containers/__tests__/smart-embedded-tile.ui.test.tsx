/**
 * Tile chrome characterization (Renderer_v2 Phase 3): pins SmartEmbeddedQuestionContainer's
 * user-visible behavior across the Chakra→kit re-skin — title link vs plain title, the
 * actions menu (Explain/Edit/Remove), edit-mode overlay buttons, loading state. Behavior
 * only; no pixel/classname assertions, so the re-skin swaps styling freely underneath.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import * as storeModule from '@/store/store';
import { setFile } from '@/store/filesSlice';
import type { DbFile, QuestionContent } from '@/lib/types';

vi.mock('@/components/containers/EmbeddedQuestionContainer', () => ({
  __esModule: true,
  default: ({ questionId }: { questionId: number }) => (
    <div aria-label={`Embedded question body ${questionId}`} />
  ),
}));
vi.mock('@/lib/hooks/useExplainQuestion', () => {
  const explainQuestion = vi.fn();
  return { useExplainQuestion: () => ({ explainQuestion }), __explainSpy: explainQuestion };
});

import SmartEmbeddedQuestionContainer from '@/components/containers/SmartEmbeddedQuestionContainer';
import * as explainModule from '@/lib/hooks/useExplainQuestion';

const Q_ID = 301;

function makeQuestionFile(): DbFile {
  return {
    id: Q_ID,
    name: 'Revenue by Region',
    type: 'question' as const,
    path: '/org/Revenue by Region',
    content: { query: 'SELECT 1', vizSettings: { type: 'table' as const }, connection_name: '' } as QuestionContent,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    references: [] as number[],
    version: 1,
    last_edit_id: null,
  } as DbFile;
}

function setup() {
  const store = storeModule.makeStore();
  vi.spyOn(storeModule, 'getStore').mockReturnValue(store);
  store.dispatch(setFile({ file: makeQuestionFile(), references: [] }));
  return store;
}

beforeEach(() => { vi.clearAllMocks(); });

describe('SmartEmbeddedQuestionContainer chrome', () => {
  it('renders the title as a link to the question (with dashboard context) and mounts the body', async () => {
    const store = setup();
    renderWithProviders(
      <SmartEmbeddedQuestionContainer questionId={Q_ID} showTitle dashboardId={9} />,
      { store },
    );
    const title = await screen.findByText('Revenue by Region');
    expect(title.closest('a')?.getAttribute('href')).toContain(`/f/${Q_ID}?dashboard=9`);
    expect(await screen.findByLabelText(`Embedded question body ${Q_ID}`)).toBeInTheDocument();
  });

  it('readOnly: plain title, no link, no actions menu', async () => {
    const store = setup();
    renderWithProviders(
      <SmartEmbeddedQuestionContainer questionId={Q_ID} showTitle readOnly />,
      { store },
    );
    const title = await screen.findByText('Revenue by Region');
    expect(title.closest('a')).toBeNull();
    expect(screen.queryByLabelText('Card actions')).not.toBeInTheDocument();
  });

  it('actions menu opens with Explain / Edit / Remove; Explain calls the hook, Remove fires', async () => {
    const store = setup();
    const onRemove = vi.fn();
    renderWithProviders(
      <SmartEmbeddedQuestionContainer questionId={Q_ID} showTitle onRemove={onRemove} />,
      { store },
    );
    const user = userEvent.setup();
    await user.click(await screen.findByLabelText('Card actions'));
    await user.click(await screen.findByLabelText('Explain chart'));
    const explainSpy = (explainModule as unknown as { __explainSpy: ReturnType<typeof vi.fn> }).__explainSpy;
    expect(explainSpy).toHaveBeenCalledWith(Q_ID);

    await user.click(await screen.findByLabelText('Card actions'));
    await user.click(await screen.findByLabelText('Remove from dashboard'));
    expect(onRemove).toHaveBeenCalled();
  });

  it('edit mode: overlay edit/remove buttons present, no actions menu, title not clickable', async () => {
    const store = setup();
    const onEdit = vi.fn(); const onRemove = vi.fn();
    renderWithProviders(
      <SmartEmbeddedQuestionContainer questionId={Q_ID} showTitle editMode onEdit={onEdit} onRemove={onRemove} />,
      { store },
    );
    await screen.findByText('Revenue by Region');
    expect(screen.queryByLabelText('Card actions')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Edit question'));
    expect(onEdit).toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Remove from dashboard'));
    expect(onRemove).toHaveBeenCalled();
  });

  it('unknown question id: shows the loading state, never a crash', () => {
    const store = storeModule.makeStore();
    vi.spyOn(storeModule, 'getStore').mockReturnValue(store);
    renderWithProviders(<SmartEmbeddedQuestionContainer questionId={999} showTitle />, { store });
    expect(screen.queryByText('Revenue by Region')).not.toBeInTheDocument();
  });
});
