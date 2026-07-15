/**
 * Semantic auto-run — the explorer's PyGWalker feedback loop: every shelf
 * edit compiles SQL and AUTO-EXECUTES it (debounced, cache-served/un-forced)
 * so the chart tracks the shelves without an explicit Run.
 *
 * Loop guards under test (each prevents an execute loop or a wasted run):
 *  - mount with a persisted spec + saved SQL never re-runs on its own
 *  - rapid edits coalesce into ONE run after the debounce window
 *  - an edit sequence that lands back on the same SQL (A→B→A) runs nothing
 *  - pause freezes auto-run; the Execute button reappears and forces a
 *    fresh server run
 *  - switching to the SQL tab cancels a pending auto-run
 * Plus the SQL peek drawer: in-sync compiled SQL + "Edit SQL" escape hatch.
 *
 * Mounted through QuestionContainerV2 (real Redux + editFile flow); the
 * file-state getQueryResult is mocked so "a run happened" is countable
 * without network. Runs land via two container paths: un-forced auto-runs
 * through useQueryResult's effect, forced runs directly — both hit the
 * mocked getQueryResult.
 */
import { screen, fireEvent, act } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import * as storeModule from '@/store/store';
import { setFile } from '@/store/filesSlice';
import { compileSemanticQuery } from '@/lib/semantic/compile';
import { irToSqlLocal } from '@/lib/sql/ir-to-sql';
import type { QuestionContent, DbFile } from '@/lib/types';
import type { SemanticModel } from '@/lib/types/semantic';
import { getQueryResult } from '@/lib/file-state/file-state';
import { setQueryResult } from '@/store/queryResultsSlice';

// Mocked execution: records the call (the tests COUNT runs) and settles the
// Redux loading state like the real implementation would — the container's
// clearQueryResult-on-execute otherwise leaves the query "loading" forever,
// which keeps the Execute button in its disabled loading state.
vi.mock('@/lib/file-state/file-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/file-state/file-state')>();
  return {
    ...actual,
    getQueryResult: vi.fn(async (req: { query: string; params: Record<string, unknown>; database: string }) => {
      // storeModule/setQueryResult resolve lazily (call time), after hoisting.
      storeModule.getStore().dispatch(setQueryResult({
        query: req.query, params: req.params, database: req.database,
        data: { columns: [], types: [], rows: [] },
      }));
      return null;
    }),
  };
});

const schemaContextMock = {
  contextId: undefined as undefined,
  databases: [] as unknown[],
  contextDocs: undefined as undefined,
  skills: [] as unknown[],
  availableSkills: [] as unknown[],
  hasContext: true,
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

vi.mock('@/lib/hooks/useConfigs', () => ({
  useConfigs: () => ({ config: { branding: { agentName: 'MinusX' } }, loading: false }),
}));

const ORDERS_MODEL: SemanticModel = {
  name: 'Orders',
  connection: 'demo_db',
  table: 'orders',
  timeDimension: { column: 'created_at', label: 'Order date' },
  dimensions: [{ name: 'Status', column: 'status' }],
  measures: [{ name: 'Revenue', agg: 'SUM', column: 'amount' }],
};

const SPEC = { model: 'Orders', table: 'orders', measures: ['Revenue'], dimensions: [] };
const SAVED_SQL = irToSqlLocal(compileSemanticQuery(SPEC, ORDERS_MODEL), 'duckdb');

vi.mock('@/lib/hooks/use-semantic-compat', () => ({
  useSemanticCompat: () => ({
    detected: { model: 'Orders', table: 'orders', measures: ['Revenue'], dimensions: [] },
    canUseSemantic: true,
  }),
}));
vi.mock('@/lib/hooks/use-semantic-models', () => ({
  useSemanticModels: () => ({ models: [ORDERS_MODEL] }),
}));

import QuestionContainerV2 from '@/components/containers/QuestionContainerV2';

const FILE_ID = 6363;

function makeQuestionFile(contentOverrides: Partial<QuestionContent> = {}): DbFile {
  return {
    id: FILE_ID,
    name: 'Revenue',
    type: 'question',
    path: '/org/Revenue',
    content: {
      description: null,
      query: SAVED_SQL,
      vizSettings: { type: 'table' },
      parameters: [],
      parameterValues: {},
      connection_name: 'demo_db',
      references: [],
      cachePolicy: null,
      semanticQuery: SPEC,
      ...contentOverrides,
    },
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    references: [],
    version: 1,
    last_edit_id: null,
  } as DbFile;
}

function setup(contentOverrides: Partial<QuestionContent> = {}) {
  schemaContextMock.databases = [{
    databaseName: 'demo_db',
    schemas: [{ schema: 'main', tables: [{ table: 'orders', columns: [] }] }],
  }];
  const testStore = storeModule.makeStore();
  vi.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
  testStore.dispatch(setFile({ file: makeQuestionFile(contentOverrides), references: [] }));
  return testStore;
}

const runCount = () => vi.mocked(getQueryResult).mock.calls.length;

async function mountExplorer(store: ReturnType<typeof storeModule.makeStore>) {
  renderWithProviders(<QuestionContainerV2 fileId={FILE_ID} />, { store });
  // flush the mount auto-execute + explorer default-measure microtask
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(await screen.findByLabelText('Metrics shelf')).toBeInTheDocument();
  vi.mocked(getQueryResult).mockClear();
}

describe('semantic auto-run', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.mocked(getQueryResult).mockClear();
  });

  it('a shelf edit auto-runs the compiled SQL after the debounce (exactly once)', async () => {
    const store = setup();
    await mountExplorer(store);

    fireEvent.click(screen.getByLabelText('Field dimension: Status'));
    expect(runCount()).toBe(0); // debounced — nothing yet
    await act(async () => { await vi.advanceTimersByTimeAsync(450); });

    expect(runCount()).toBe(1);
    const lastExecuted = store.getState().files.files[FILE_ID].ephemeralChanges?.lastExecuted;
    expect(lastExecuted?.query).toContain('GROUP BY');
  });

  it('rapid edits coalesce into a single run', async () => {
    const store = setup();
    await mountExplorer(store);

    fireEvent.click(screen.getByLabelText('Field dimension: Status'));
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
    fireEvent.click(screen.getByLabelText('Field time: Order date'));
    await act(async () => { await vi.advanceTimersByTimeAsync(450); });

    expect(runCount()).toBe(1);
    const lastExecuted = store.getState().files.files[FILE_ID].ephemeralChanges?.lastExecuted;
    expect(lastExecuted?.query).toContain('DATE_TRUNC');
  });

  it('mount with a persisted spec + saved result never re-runs by itself', async () => {
    const store = setup();
    await mountExplorer(store);

    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(runCount()).toBe(0);
  });

  it('an edit sequence landing back on the same SQL (A→B→A) runs nothing', async () => {
    const store = setup();
    await mountExplorer(store);

    fireEvent.click(screen.getByLabelText('Field dimension: Status'));   // A → B
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
    fireEvent.click(screen.getByLabelText('Field dimension: Status'));   // B → A
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });

    expect(runCount()).toBe(0);
  });

  it('pause freezes auto-run; Execute reappears and forces a server refresh', async () => {
    const store = setup();
    await mountExplorer(store);

    fireEvent.click(screen.getByLabelText('Pause auto-run'));
    fireEvent.click(screen.getByLabelText('Field dimension: Status'));
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(runCount()).toBe(0);

    fireEvent.click(screen.getByLabelText('Execute semantic query'));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const forced = vi.mocked(getQueryResult).mock.calls.find(([, opts]) => (opts as { forceLoad?: boolean })?.forceLoad);
    expect(forced).toBeTruthy();

    expect(screen.getByLabelText('Resume auto-run')).toBeInTheDocument();
  });

  it('switching to the SQL tab cancels a pending auto-run', async () => {
    const store = setup();
    await mountExplorer(store);

    fireEvent.click(screen.getByLabelText('Field dimension: Status'));
    fireEvent.click(screen.getByLabelText('SQL'));
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });

    expect(runCount()).toBe(0);
  });
});

describe('SQL peek drawer', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.mocked(getQueryResult).mockClear();
  });

  it('shows the compiled SQL, stays in sync with shelf edits', async () => {
    const store = setup();
    await mountExplorer(store);

    fireEvent.click(screen.getByLabelText('Toggle SQL peek'));
    expect(screen.getByLabelText('Compiled SQL').textContent).toContain('SUM(amount)');

    fireEvent.click(screen.getByLabelText('Field dimension: Status'));
    await act(async () => { await vi.advanceTimersByTimeAsync(450); });
    expect(screen.getByLabelText('Compiled SQL').textContent).toContain('GROUP BY');
  });

  it('"Edit SQL" jumps to the SQL editor tab', async () => {
    const store = setup();
    await mountExplorer(store);

    fireEvent.click(screen.getByLabelText('Toggle SQL peek'));
    fireEvent.click(screen.getByLabelText('Edit SQL'));
    expect(await screen.findByLabelText('SQL editor')).toBeInTheDocument();
  });
});
