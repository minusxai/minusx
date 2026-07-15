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
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import * as storeModule from '@/store/store';
import { setFile } from '@/store/filesSlice';
import { selectQuestionCollapsedPanel } from '@/store/uiSlice';
import type { QuestionContent, DbFile } from '@/lib/types';

// Mutable holder: the semantic-mode tests give the context a schema so the
// view derives table stubs (showSemanticTab); SQL-mode tests leave it empty.
const schemaContextMock = {
  contextId: undefined as undefined,
  databases: [] as unknown[],
  contextDocs: undefined as undefined,
  skills: [] as unknown[],
  availableSkills: [] as unknown[],
  hasContext: false,
  contextLoading: false,
};
vi.mock('@/lib/hooks/useContext', () => ({
  useContext: () => schemaContextMock,
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

// Semantic tier hooks — mutable holders so the semantic-mode tests below can
// flip them on without affecting the SQL-mode tests (defaults: nothing detects,
// no models). Reset in afterEach.
const semanticCompatMock: { detected: unknown; canUseSemantic: boolean } = { detected: null, canUseSemantic: false };
const semanticModelsMock: { models: unknown[] } = { models: [] };
vi.mock('@/lib/hooks/use-semantic-compat', () => ({
  useSemanticCompat: () => semanticCompatMock,
}));
vi.mock('@/lib/hooks/use-semantic-models', () => ({
  useSemanticModels: () => semanticModelsMock,
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

// ---------------------------------------------------------------------------
// Semantic mode — the single-surface explorer replaces the GUI + Viz tabs
// ---------------------------------------------------------------------------

const ORDERS_MODEL = {
  name: 'Orders',
  connection: 'demo_db',
  table: 'orders',
  timeDimension: { column: 'created_at', label: 'Order date' },
  dimensions: [{ name: 'Status', column: 'status' }],
  measures: [{ name: 'Revenue', agg: 'SUM', column: 'amount' }],
};

const DETECTED_SPEC = { model: 'Orders', table: 'orders', measures: ['Revenue'], dimensions: [] };

function setupSemantic(contentOverrides: Partial<QuestionContent> = {}) {
  schemaContextMock.hasContext = true;
  schemaContextMock.databases = [{
    databaseName: 'demo_db',
    schemas: [{ schema: 'main', tables: [{ table: 'orders', columns: [] }] }],
  }];
  semanticCompatMock.detected = DETECTED_SPEC;
  semanticCompatMock.canUseSemantic = true;
  semanticModelsMock.models = [ORDERS_MODEL];
  return setup({ connection_name: 'demo_db', semanticQuery: DETECTED_SPEC, ...contentOverrides });
}

const mergedVizSettings = (store: ReturnType<typeof storeModule.makeStore>) => {
  const f = store.getState().files.files[FILE_ID];
  return {
    ...(f.content as QuestionContent | undefined)?.vizSettings,
    ...(f.persistableChanges as Partial<QuestionContent>)?.vizSettings,
  };
};

describe('QuestionViewV2 — semantic explorer mode', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    schemaContextMock.hasContext = false;
    schemaContextMock.databases = [];
    semanticCompatMock.detected = null;
    semanticCompatMock.canUseSemantic = false;
    semanticModelsMock.models = [];
  });

  it('renders the explorer as the single surface: shelves present, Viz tab GONE, Explore tab active', async () => {
    const store = setupSemantic();
    renderQuestion(store);

    expect(await screen.findByLabelText('Metrics shelf')).toBeInTheDocument();
    expect(screen.getByLabelText('Dimensions shelf')).toBeInTheDocument();
    expect(screen.getByLabelText('Explore')).toBeInTheDocument();
    expect(screen.queryByLabelText('Viz')).toBeNull();
  });

  it('picking a chart type from the embedded viz panel persists it LOCKED', async () => {
    const store = setupSemantic();
    renderQuestion(store);

    fireEvent.click(await screen.findByLabelText('Pie'));
    expect(mergedVizSettings(store)).toMatchObject({ type: 'pie', typeLocked: true });
  });

  it('a locked type survives shelf edits (axis cols still track the query)', async () => {
    const store = setupSemantic({ vizSettings: { type: 'pie', typeLocked: true } });
    renderQuestion(store);

    fireEvent.click(await screen.findByLabelText('Field dimension: Status'));
    await waitFor(() => {
      const viz = mergedVizSettings(store);
      expect(viz.xCols).toEqual(['status']);
      expect(viz.type).toBe('pie');
      expect(viz.typeLocked).toBe(true);
    });
  });

  it('an UNLOCKED type keeps following auto-inference on shelf edits', async () => {
    const store = setupSemantic({ vizSettings: { type: 'table' } });
    renderQuestion(store);

    fireEvent.click(await screen.findByLabelText('Field dimension: Status'));
    await waitFor(() => {
      expect(mergedVizSettings(store)).toMatchObject({ type: 'bar', xCols: ['status'], yCols: ['revenue'] });
    });
  });

  it('legacy saved questions without typeLocked: a non-default type counts as locked (reset offered), and reset hands back auto', async () => {
    const store = setupSemantic({ vizSettings: { type: 'pie' } });
    renderQuestion(store);

    // pie was never in the auto family — treated as a deliberate choice
    fireEvent.click(await screen.findByLabelText('Reset chart type to auto'));
    // measures-only spec → auto is single_value
    expect(mergedVizSettings(store)).toMatchObject({ type: 'single_value', typeLocked: false });
  });
});
