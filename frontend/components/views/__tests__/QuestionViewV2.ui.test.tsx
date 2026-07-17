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
import { setQueryResult } from '@/store/queryResultsSlice';
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

vi.mock('@/components/spreadsheet/SpreadsheetSourceEditor', () => ({
  default: () => <div aria-label="Spreadsheet editor" />,
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

function setup(
  contentOverrides: Partial<QuestionContent> = {},
  fileOverrides: Partial<DbFile> = {},
) {
  const testStore = storeModule.makeStore();
  vi.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
  testStore.dispatch(setFile({ file: makeQuestionFile(contentOverrides, fileOverrides), references: [] }));
  return testStore;
}

function renderQuestion(store: ReturnType<typeof storeModule.makeStore>) {
  return renderWithProviders(<QuestionContainerV2 fileId={FILE_ID} />, { store });
}

// A DRAFT question seeded with a cached result: the viz column only renders once
// there's query data, so tests that need the panel visible seed it here. Draft is
// key — it makes the container skip both auto-execute-on-mount and the
// useQueryResult fetch, so the seeded cache survives and feeds the selector
// (a non-draft file would immediately re-execute and clobber the seed). The
// (query, params, database) triple must match what QuestionContainerV2 reads:
// query 'SELECT 1', no params ({}), connection 'demo_db'.
function setupWithData() {
  const store = setup({ query: 'SELECT 1', connection_name: 'demo_db' }, { draft: true });
  store.dispatch(setQueryResult({
    query: 'SELECT 1',
    params: {},
    database: 'demo_db',
    data: { columns: ['value'], types: ['number'], rows: [[1]] },
  }));
  return store;
}

describe('QuestionViewV2 (mounted via QuestionContainerV2) — Redux integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows GUI/SQL, the database, and a separated Spreadsheet tab for an empty question', async () => {
    const store = setup();
    renderQuestion(store);

    // The Monaco editor is loaded via next/dynamic, so it mounts asynchronously.
    expect(await screen.findByLabelText('SQL editor')).toBeInTheDocument();
    expect(screen.getByLabelText('Database selector')).toBeInTheDocument();
    expect(screen.getByLabelText('Spreadsheet')).toBeInTheDocument();
  });

  it('switches an empty source to Spreadsheet and hides query controls after data exists', async () => {
    const store = setup();
    renderQuestion(store);

    fireEvent.click(screen.getByLabelText('Spreadsheet'));
    expect(await screen.findByLabelText('Spreadsheet editor')).toBeInTheDocument();
    expect(screen.queryByLabelText('SQL editor')).toBeNull();
    const content = store.getState().files.files[FILE_ID].persistableChanges as Partial<QuestionContent>;
    expect(content).toMatchObject({ spreadsheet: { version: 1, columns: [], rows: [] } });
  });

  it('hides Spreadsheet when SQL has content, and hides GUI/SQL/DB when spreadsheet data exists', async () => {
    const queryStore = setup({ query: 'SELECT 1', connection_name: 'demo_db' });
    const first = renderQuestion(queryStore);
    expect(screen.queryByLabelText('Spreadsheet')).toBeNull();
    first.unmount();

    const sheetStore = setup({
      spreadsheet: { version: 1, columns: [{ name: 'value', type: 'auto' }], rows: [['1']] },
      query: '', connection_name: '',
    });
    renderQuestion(sheetStore);
    expect(await screen.findByLabelText('Spreadsheet editor')).toBeInTheDocument();
    expect(screen.queryByLabelText('SQL')).toBeNull();
    expect(screen.queryByLabelText('Database selector')).toBeNull();
  });

  it('materializes spreadsheet questions without calling /api/query', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const store = setup({
      spreadsheet: {
        version: 1,
        columns: [{ name: 'amount', type: 'number' }],
        rows: [['12.5']],
      },
      query: '',
      connection_name: '',
    });
    renderQuestion(store);

    expect(await screen.findByLabelText('Spreadsheet editor')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/query'))).toBe(false);
  });

  it('dispatches setQuestionCollapsedPanel when the query (left) panel is collapsed/expanded', () => {
    const store = setup({ query: 'SELECT 1', connection_name: 'demo_db' });
    renderQuestion(store);

    expect(selectQuestionCollapsedPanel(store.getState())).toBe('none');

    fireEvent.click(screen.getByLabelText('Collapse query panel'));
    expect(selectQuestionCollapsedPanel(store.getState())).toBe('left');

    fireEvent.click(screen.getByLabelText('Expand query panel'));
    expect(selectQuestionCollapsedPanel(store.getState())).toBe('none');
  });

  it('dispatches setQuestionCollapsedPanel when the results (right) panel is collapsed/expanded', () => {
    const store = setup({ query: 'SELECT 1', connection_name: 'demo_db' });
    renderQuestion(store);

    fireEvent.click(screen.getByLabelText('Collapse results panel'));
    expect(selectQuestionCollapsedPanel(store.getState())).toBe('right');

    fireEvent.click(screen.getByLabelText('Expand results panel'));
    expect(selectQuestionCollapsedPanel(store.getState())).toBe('none');
  });

});

describe('QuestionViewV2 — three-column layout (viz panel on the right)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hides the viz column entirely until the query has run (no empty "configure" panel)', () => {
    // No seeded result → no query data → the viz column (and its collapse
    // controls) should not render at all.
    const empty = setup({ query: 'SELECT 1', connection_name: 'demo_db' });
    renderQuestion(empty);
    expect(screen.queryByLabelText('Viz panel')).toBeNull();
    expect(screen.queryByLabelText('Collapse viz panel')).toBeNull();

    // Once there IS query data, the column appears.
    const withData = setupWithData();
    renderQuestion(withData);
    expect(screen.getByLabelText('Viz panel')).toBeInTheDocument();
  });

  it('the viz panel is open by default (with data) and collapses to a slim strip via a chevron', () => {
    const store = setupWithData();
    renderQuestion(store);

    expect(screen.getByLabelText('Viz panel')).toBeInTheDocument();

    // Two collapse chevrons live on the panel: the edge-rail one (where the old
    // grip sat) and the header one. Either collapses the column.
    fireEvent.click(screen.getAllByLabelText('Collapse viz panel')[0]);
    expect(screen.queryByLabelText('Viz panel')).toBeNull();

    fireEvent.click(screen.getByLabelText('Expand viz panel'));
    expect(screen.getByLabelText('Viz panel')).toBeInTheDocument();
  });

  it('the mode selector has no Viz tab in the wide layout — viz lives in the right panel', () => {
    const store = setupWithData();
    renderQuestion(store);

    expect(screen.getByLabelText('SQL')).toBeInTheDocument();
    expect(screen.queryByLabelText('Viz')).toBeNull();
  });

  it('the viz panel is a fixed-width column — no drag handle, no redundant data-collapse chevron', () => {
    const store = setupWithData();
    renderQuestion(store);

    // The viz resize handle is gone, so its redundant "Collapse data panel"
    // chevron no longer exists.
    expect(screen.queryByLabelText('Collapse data panel')).toBeNull();
    // Collapse is still offered (edge rail + header chevrons).
    expect(screen.getAllByLabelText('Collapse viz panel').length).toBeGreaterThan(0);

    // Data (results) is still collapsible — from the left handle's chevron.
    fireEvent.click(screen.getByLabelText('Collapse results panel'));
    expect(selectQuestionCollapsedPanel(store.getState())).toBe('right');
    // the viz panel itself stays open
    expect(screen.getByLabelText('Viz panel')).toBeInTheDocument();
  });
});
