/**
 * NotebookView — characterizes CURRENT (pre-move) Redux behavior of the
 * `reduxExecuted` call site ahead of the Container/View discipline move
 * (CLAUDE.md "Refactoring — Blue -> Red -> Blue").
 * NotebookView.tsx currently calls useAppDispatch + useAppSelector directly
 * (selectNotebookCellExecuted) to source a real file's per-cell "last run"
 * snapshot from Redux ephemeral state — this differs from the local-state
 * fallback used when no fileId is given (covered by the sibling
 * `notebook-view.ui.test.tsx`, which never passes a fileId).
 *
 * Mounted via NotebookContainerV2 (NOT NotebookView directly) so the seeded
 * Redux state is read through the real fileId contract.
 *
 * Mocks mirror `notebook-view.ui.test.tsx`: QuestionVisualization renders a
 * "Cell results" div driven purely by the `executed` prop passed down from
 * `reduxExecuted`/EMPTY_EXECUTED — no query is actually run.
 */
import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import * as storeModule from '@/store/store';
import { setFile, setNotebookCellExecuted } from '@/store/filesSlice';
import NotebookContainerV2 from '@/components/containers/NotebookContainerV2';
import type { DbFile, NotebookContent } from '@/lib/types';

vi.mock('@/lib/hooks/file-state-hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks/file-state-hooks')>();
  return {
    ...actual,
    useQueryResult: () => ({ data: null, loading: false, error: null, isStale: false, refetch: vi.fn() }),
  };
});

vi.mock('@/lib/hooks/useAvailableQuestions', () => ({
  useAvailableQuestions: () => ({ questions: [], loading: false }),
}));

vi.mock('@/lib/data/completions/completions', () => ({
  CompletionsAPI: { sqlToIR: vi.fn().mockResolvedValue({}) },
}));

vi.mock('@/components/question/QuestionVisualization', () => ({
  QuestionVisualization: ({ data }: any) =>
    React.createElement('div', { 'aria-label': 'Cell results' }, JSON.stringify(data?.rows ?? null)),
}));

vi.mock('@/lib/hooks/useConnections', () => ({
  useConnections: () => ({ connections: {}, loading: false, error: null }),
}));

// NotebookEmptyState (rendered when the notebook has no cells) calls useConfigs() for the
// branding agentName. Mocked so its fire-and-forget /api/configs fetch never runs in jsdom.
vi.mock('@/lib/hooks/useConfigs', () => ({
  useConfigs: () => ({ config: { branding: { agentName: 'MinusX' } }, loading: false }),
}));

const NOTEBOOK_ID = 600;
const CELL_ID = 'cell-1';

function makeNotebookFile(): DbFile {
  return {
    id: NOTEBOOK_ID,
    name: 'Ad-hoc notebook',
    type: 'notebook' as const,
    path: '/org/Ad-hoc notebook',
    content: {
      description: null,
      cells: [
        { type: 'sql', id: CELL_ID, name: null, query: 'SELECT 42', vizSettings: { type: 'table' }, parameters: [], parameterValues: {}, connection_name: 'main' },
      ],
    } as NotebookContent,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    references: [] as number[],
    version: 1,
    last_edit_id: null,
  } as DbFile;
}

function setup() {
  const testStore = storeModule.makeStore();
  vi.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
  testStore.dispatch(setFile({ file: makeNotebookFile(), references: [] }));
  return testStore;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('NotebookView via NotebookContainerV2 (reduxExecuted)', () => {
  it('shows no cell results when Redux has no cached executed snapshot for the cell', () => {
    const store = setup();

    renderWithProviders(<NotebookContainerV2 fileId={NOTEBOOK_ID} />, { store });

    expect(screen.queryByLabelText('Cell results')).not.toBeInTheDocument();
  });

  it('shows the cell results when Redux already has a cached executed snapshot for the cell', () => {
    const store = setup();
    store.dispatch(setNotebookCellExecuted({
      fileId: NOTEBOOK_ID,
      cellId: CELL_ID,
      executed: { query: 'SELECT 42', params: {}, database: 'main' },
    }));

    renderWithProviders(<NotebookContainerV2 fileId={NOTEBOOK_ID} />, { store });

    expect(screen.getByLabelText('Cell results')).toBeInTheDocument();
  });
});
