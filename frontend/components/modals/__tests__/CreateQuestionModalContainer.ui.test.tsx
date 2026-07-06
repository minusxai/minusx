/**
 * CreateQuestionModalContainer — smoke coverage for the Redux wiring this container
 * now owns after the QuestionViewV2 Container/View move (the modal supplies editMode,
 * collapsedPanel, fileState, and onRemoveReference to QuestionViewV2 instead of the
 * view reading Redux internally).
 *
 * Focused on the highest-risk touch points for THIS container specifically:
 *  - The modal's own mount effect dispatches setFileEditMode(true); this test proves
 *    that value round-trips through the new `editMode` prop into the view (surfaced by
 *    the "Remove reference" button, which only renders in edit mode).
 *  - The `fileState` prop correctly resolves a referenced question already in Redux.
 *  - The `onRemoveReference` prop dispatches removeReferenceFromQuestion correctly.
 *
 * Heavy leaf hooks used by QuestionViewV2 are mocked the same way as
 * components/views/__tests__/QuestionViewV2.ui.test.tsx.
 */
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import * as storeModule from '@/store/store';
import { setFile } from '@/store/filesSlice';
import { selectFileEditMode } from '@/store/uiSlice';
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

import CreateQuestionModalContainer from '@/components/modals/CreateQuestionModalContainer';

const FILE_ID = 7373;
const REF_ID = 8484;

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

describe('CreateQuestionModalContainer — Redux wiring for QuestionViewV2', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('enters edit mode on mount and shows the remove-reference control for an already-loaded reference', async () => {
    const testStore = storeModule.makeStore();
    vi.spyOn(storeModule, 'getStore').mockReturnValue(testStore);

    testStore.dispatch(setFile({
      file: makeQuestionFile({ references: [{ id: REF_ID, alias: 'ref_a' }] }),
      references: [],
    }));
    testStore.dispatch(setFile({
      file: makeQuestionFile({ query: 'SELECT 2' }, { id: REF_ID, name: 'Ref Q', path: '/org/RefQ' }),
      references: [],
    }));

    renderWithProviders(
      <CreateQuestionModalContainer
        isOpen
        onClose={() => {}}
        onQuestionCreated={() => {}}
        folderPath="/org"
        questionId={FILE_ID}
      />,
      { store: testStore },
    );

    // The modal's own mount effect dispatches setFileEditMode(true); confirm it lands.
    await waitFor(() => {
      expect(selectFileEditMode(testStore.getState(), FILE_ID)).toBe(true);
    });

    // The reference chip only shows a remove button in edit mode, and only renders the
    // chip at all once fileState resolves the referenced question's content.
    fireEvent.click(await screen.findByLabelText('Remove reference'));

    await waitFor(() => {
      const persisted = testStore.getState().files.files[FILE_ID].persistableChanges as
        | Partial<QuestionContent>
        | undefined;
      expect(persisted?.references).toEqual([]);
    });
  });
});
