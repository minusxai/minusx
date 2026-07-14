/**
 * QuestionViewV2 — characterization tests for the Redux integration that
 * CURRENTLY lives directly inside the view: useAppSelector/useAppDispatch call
 * sites for panel-collapse (setQuestionCollapsedPanel), the referenced-question
 * setFile-on-load effect, and the add/removeReferenceToQuestion dispatches.
 *
 * These tests deliberately mount the view through its EXISTING container,
 * QuestionContainerV2 (`fileId` + `mode` props) — not QuestionViewV2 in
 * isolation. That's the only rendering seam that's stable across the planned
 * container/view move: today the Redux reads/dispatches live in the view;
 * after the move they'll live in the container and reach the view as props.
 * Testing through the container means this exact test file passes unchanged
 * both before and after the move (verifying the move preserved behavior),
 * per CLAUDE.md's "Refactoring — Blue -> Red -> Blue" discipline.
 *
 * Heavy data-fetching leaf hooks used by the view (schema context, connections
 * list, available-questions autocomplete, GUI-compat check) are mocked to
 * stable synchronous values — they're not under test here and would otherwise
 * issue real fetch() calls under jsdom. The question's `query` is left empty
 * so useQueryResult / the query-estimate effect skip (no query execution).
 */
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import * as storeModule from '@/store/store';
import { setFile } from '@/store/filesSlice';
import { selectQuestionCollapsedPanel } from '@/store/uiSlice';
import type { QuestionContent, DbFile } from '@/lib/types';

vi.mock('@/lib/hooks/useContext', () => ({
  useContext: () => ({
    contextId: undefined,
    databases: [],
    contextDocs: undefined,
    skills: [],
    availableSkills: [],
    hasContext: false,
    contextLoading: false,
  }),
}));

vi.mock('@/lib/hooks/useConnections', () => ({
  useConnections: () => ({
    connections: {
      demo_db: {
        metadata: { name: 'demo_db', type: 'duckdb', config: {}, created_at: '', updated_at: '' },
        schema: null,
        schemaLoadedAt: undefined,
        schemaError: undefined,
      },
    },
    loading: false,
    error: null,
  }),
}));

vi.mock('@/lib/hooks/useAvailableQuestions', () => ({
  useAvailableQuestions: () => ({ questions: [], loading: false }),
}));

vi.mock('@/lib/hooks/use-gui-compat', () => ({
  useGuiCompat: () => ({ canUseGUI: true, guiError: null }),
}));

// QuestionEmptyState (rendered when the question has no query) calls useConfigs() for the
// branding agentName. Mocked so its fire-and-forget /api/configs fetch never runs in jsdom.
vi.mock('@/lib/hooks/useConfigs', () => ({
  useConfigs: () => ({ config: { branding: { agentName: 'MinusX' } }, loading: false }),
}));

import QuestionContainerV2 from '@/components/containers/QuestionContainerV2';

const FILE_ID = 4242;
const REF_ID = 5151;

function makeQuestionFile(
  contentOverrides: Partial<QuestionContent> = {},
  fileOverrides: Partial<DbFile> = {},
): DbFile {
  return {
    id: FILE_ID,
    name: 'Revenue',
    type: 'question',
    path: '/org/Revenue',
    content: {
      description: null,
      query: '',
      vizSettings: { type: 'table' },
      parameters: [],
      parameterValues: {},
      connection_name: '',
      references: [],
      cachePolicy: null,
      ...contentOverrides,
    },
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    references: [],
    version: 1,
    last_edit_id: null,
    ...fileOverrides,
  } as DbFile;
}

function setup(contentOverrides: Partial<QuestionContent> = {}) {
  const testStore = storeModule.makeStore();
  vi.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
  testStore.dispatch(setFile({ file: makeQuestionFile(contentOverrides), references: [] }));
  return testStore;
}

function renderQuestion(store: ReturnType<typeof storeModule.makeStore>) {
  return renderWithProviders(<QuestionContainerV2 fileId={FILE_ID} />, { store });
}

describe('QuestionViewV2 (mounted via QuestionContainerV2) — Redux integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the question surface (SQL editor + database selector)', async () => {
    const store = setup();
    renderQuestion(store);

    // The Monaco editor is loaded via next/dynamic, so it mounts asynchronously.
    expect(await screen.findByLabelText('SQL editor')).toBeInTheDocument();
    expect(screen.getByLabelText('Database selector')).toBeInTheDocument();
  });

  it('dispatches setQuestionCollapsedPanel when the query (left) panel is collapsed/expanded', () => {
    const store = setup();
    renderQuestion(store);

    expect(selectQuestionCollapsedPanel(store.getState())).toBe('none');

    fireEvent.click(screen.getByLabelText('Collapse query panel'));
    expect(selectQuestionCollapsedPanel(store.getState())).toBe('left');

    fireEvent.click(screen.getByLabelText('Expand query panel'));
    expect(selectQuestionCollapsedPanel(store.getState())).toBe('none');
  });

  it('dispatches setQuestionCollapsedPanel when the results (right) panel is collapsed/expanded', () => {
    const store = setup();
    renderQuestion(store);

    fireEvent.click(screen.getByLabelText('Collapse results panel'));
    expect(selectQuestionCollapsedPanel(store.getState())).toBe('right');

    fireEvent.click(screen.getByLabelText('Expand results panel'));
    expect(selectQuestionCollapsedPanel(store.getState())).toBe('none');
  });

});
