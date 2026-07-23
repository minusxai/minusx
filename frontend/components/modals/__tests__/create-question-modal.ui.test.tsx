/**
 * CreateQuestionModalContainer must resolve the schema context at the DRAFT
 * FILE'S path (falling back to the folder it's being created in) — NOT the
 * '/org' default QuestionViewV2 uses when no filePath is passed. Otherwise a
 * new question created in tutorial mode (or in any folder with its own
 * context) derives zero semantic stubs and the GUI tab silently disappears.
 *
 * The context hook is mocked path-keyed: schema exists under '/tutorial',
 * nothing anywhere else. The GUI tab showing therefore PROVES the lookup ran
 * against the file's real path.
 */
import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import * as storeModule from '@/store/store';
import { setFile } from '@/store/filesSlice';
import type { QuestionContent, DbFile } from '@/lib/types';

vi.mock('@/lib/hooks/useContext', () => ({
  useContext: (path: string) =>
    path?.startsWith('/tutorial')
      ? { databases: [{ databaseName: 'demo_db', schemas: [] }], hasContext: true }
      : { databases: [], hasContext: false },
}));
vi.mock('@/lib/semantic/derive', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  deriveModelStubs: (dbs: unknown[]) =>
    dbs && dbs.length ? [{ name: 'Orders', connection: 'demo_db', table: 'orders' }] : [],
}));
vi.mock('@/lib/hooks/useConnections', () => ({
  useConnections: () => ({
    connections: {
      demo_db: { metadata: { name: 'demo_db', type: 'duckdb', config: {}, created_at: '', updated_at: '' }, schema: null },
    },
    loading: false,
    error: null,
  }),
}));
vi.mock('@/lib/hooks/use-semantic-compat', () => ({
  useSemanticCompat: () => ({ detected: null, canUseSemantic: true }),
}));
// The GUI tab is gated on AUTHORED semantic models (Semantic_Model_v2.md §2.4),
// so this mock keys off the path the container resolves — which is the very
// thing the test is proving. Returning a model only for the draft's real folder
// path makes the tab's appearance a sharper signal than the old raw-table stub.
vi.mock('@/lib/hooks/use-semantic-models', () => ({
  useSemanticModels: (path?: string) => ({
    models: path?.startsWith('/tutorial')
      ? [{
          name: 'Orders',
          connection: 'test-db',
          primary: { kind: 'table', schema: 'public', table: 'orders' },
          dimensions: [{ name: 'Status', source: 'primary', column: 'status' }],
          metrics: [{ name: 'Count', type: 'aggregation', agg: 'COUNT' }],
        }]
      : [],
  }),
}));
vi.mock('@/lib/hooks/useAvailableQuestions', () => ({
  useAvailableQuestions: () => ({ questions: [], loading: false }),
}));
vi.mock('@/lib/hooks/useConfigs', () => ({
  useConfigs: () => ({ config: { branding: { agentName: 'MinusX' } }, loading: false }),
}));

import CreateQuestionModalContainer from '@/components/modals/CreateQuestionModalContainer';

const FILE_ID = 4242;

function makeDraftQuestion(): DbFile {
  return {
    id: FILE_ID,
    name: 'New Question',
    type: 'question',
    path: '/tutorial/New-Question',
    content: {
      description: null,
      query: '',
      vizSettings: { type: 'table' },
      parameters: [],
      parameterValues: {},
      connection_name: 'demo_db',
      references: [],
      cachePolicy: null,
    } as unknown as QuestionContent,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    references: [],
    version: 1,
    last_edit_id: null,
  } as DbFile;
}

describe('CreateQuestionModalContainer — context path resolution', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('offers the GUI tab for a new question whose folder context defines schema', async () => {
    const testStore = storeModule.makeStore();
    vi.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
    testStore.dispatch(setFile({ file: makeDraftQuestion(), references: [] }));

    renderWithProviders(
      <CreateQuestionModalContainer
        isOpen
        onClose={vi.fn()}
        onQuestionCreated={vi.fn()}
        folderPath="/tutorial"
        questionId={FILE_ID}
        isNewQuestion
      />,
      { store: testStore },
    );

    expect(await screen.findByLabelText('Semantic')).toBeInTheDocument();
  });
});
