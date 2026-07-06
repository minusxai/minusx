/**
 * TransformationView — characterizes CURRENT (pre-move) Redux behavior ahead of
 * the Container/View discipline move (CLAUDE.md "Refactoring — Blue -> Red ->
 * Blue", Refactor-v2.md M4.2). TransformationView.tsx currently calls
 * useAppSelector directly at 4 sites (grep-verified, all read-only):
 * selectFileEditMode (editMode), selectIsDirty (isDirty), state.files.files
 * (all files, shallowEqual, filtered down to `questions`), and
 * state.files.files[fileId]?.path (filePath, fed into useContext for schema
 * lookups powering the per-transform schema dropdown).
 *
 * Mounted via TransformationContainerV2 (NOT TransformationView directly): the
 * container's fileId contract is stable across the refactor.
 *
 * useJobRuns and useConnections are mocked (repo convention — see
 * AlertView.ui.test.tsx / QuestionViewV2.ui.test.tsx) to avoid unmocked
 * network calls. @/lib/hooks/useContext is mocked wholesale for the same
 * reason (fires an unmocked /api/skills/system fetch on mount).
 *
 * All element queries by aria-label only (CLAUDE.md convention):
 *  - editMode is observed via the "Add transform" button, which only renders
 *    in edit mode.
 *  - isDirty is observed via the "No transformation runs" empty-state text.
 *  - the `questions` prop (derived from the files bag) is observed via the
 *    "Selected question" text in a transform row's read-only (non-edit) view,
 *    which resolves `transform.question` against the `questions` list.
 */
import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import * as storeModule from '@/store/store';
import { setFile, setEdit } from '@/store/filesSlice';
import { setFileEditMode } from '@/store/uiSlice';
import TransformationContainerV2 from '@/components/containers/TransformationContainerV2';
import type { DbFile, TransformationContent } from '@/lib/types';

vi.mock('@/lib/hooks/job-runs-hooks', () => ({
  useJobRuns: () => ({
    runs: [],
    selectedRunId: null,
    selectedRun: null,
    isRunning: false,
    trigger: vi.fn(),
    selectRun: vi.fn(),
    reload: vi.fn(),
  }),
}));

vi.mock('@/lib/hooks/useConnections', () => ({
  useConnections: () => ({ connections: {}, loading: false, error: null }),
}));

vi.mock('@/lib/hooks/useContext', () => ({
  useContext: () => ({ databases: [] }),
}));

vi.mock('@/lib/hooks/useUsers', () => ({
  useUsers: () => ({ users: [], loading: false }),
}));

const TRANSFORM_ID = 500;
const QUESTION_ID = 501;

function makeTransformationFile(content: Partial<TransformationContent> = {}): DbFile {
  return {
    id: TRANSFORM_ID,
    name: 'Revenue Transform',
    type: 'transformation' as const,
    path: '/org/Revenue Transform',
    content: {
      transforms: [],
      schedule: { cron: '0 9 * * 1', timezone: 'America/New_York' },
      recipients: [],
      ...content,
    } as TransformationContent,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    references: [] as number[],
    version: 1,
    last_edit_id: null,
  } as DbFile;
}

function makeQuestionFile(): DbFile {
  return {
    id: QUESTION_ID,
    name: 'Monthly Revenue',
    type: 'question' as const,
    path: '/org/Monthly Revenue',
    content: { query: 'SELECT 1', vizSettings: { type: 'table' as const }, connection_name: '' },
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    references: [] as number[],
    version: 1,
    last_edit_id: null,
  } as DbFile;
}

function setup(file: DbFile, extraFiles: DbFile[] = []) {
  const testStore = storeModule.makeStore();
  vi.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
  testStore.dispatch(setFile({ file, references: [] }));
  for (const f of extraFiles) testStore.dispatch(setFile({ file: f, references: [] }));
  return testStore;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TransformationView via TransformationContainerV2', () => {
  // Call site: selectFileEditMode(state, fileId)
  describe('editMode (selectFileEditMode)', () => {
    it('shows the Add transform button when Redux fileEditMode is true', () => {
      const store = setup(makeTransformationFile());
      store.dispatch(setFileEditMode({ fileId: TRANSFORM_ID, editMode: true }));

      renderWithProviders(<TransformationContainerV2 fileId={TRANSFORM_ID} />, { store });

      expect(screen.getByLabelText('Add transform')).toBeInTheDocument();
    });

    it('hides the Add transform button when Redux fileEditMode is unset', () => {
      const store = setup(makeTransformationFile());

      renderWithProviders(<TransformationContainerV2 fileId={TRANSFORM_ID} />, { store });

      expect(screen.queryByLabelText('Add transform')).not.toBeInTheDocument();
    });
  });

  // Call site: selectIsDirty(state, fileId) -> drives the empty-state message
  describe('isDirty (selectIsDirty)', () => {
    it('shows the "save your changes" message when the file is dirty and there are no runs', () => {
      const store = setup(makeTransformationFile());
      store.dispatch(setEdit({ fileId: TRANSFORM_ID, edits: { description: 'draft' } })); // isDirty: true

      renderWithProviders(<TransformationContainerV2 fileId={TRANSFORM_ID} />, { store });

      expect(screen.getByLabelText('No transformation runs').textContent)
        .toContain('Save your changes before running');
    });

    it('shows the "add transforms" message when clean with no transforms configured', () => {
      const store = setup(makeTransformationFile({ transforms: [] })); // isDirty: false

      renderWithProviders(<TransformationContainerV2 fileId={TRANSFORM_ID} />, { store });

      expect(screen.getByLabelText('No transformation runs').textContent)
        .toContain('Add transforms to get started');
    });

    it('shows the "no runs yet" message when clean with transforms configured', () => {
      const store = setup(makeTransformationFile({
        transforms: [{ question: QUESTION_ID, output: { schema_name: 'public', view: 'rev' } }],
      }), [makeQuestionFile()]); // isDirty: false

      renderWithProviders(<TransformationContainerV2 fileId={TRANSFORM_ID} />, { store });

      expect(screen.getByLabelText('No transformation runs').textContent)
        .toContain('No runs yet. Click "Run Now" to execute your transforms.');
    });
  });

  // Call site: state.files.files (shallowEqual) -> filtered to `questions`, resolved
  // against each transform's `question` id in the read-only (non-edit) row view.
  describe('questions (derived from the files bag)', () => {
    it('resolves a transform\'s question id to its name via the files bag', () => {
      const store = setup(makeTransformationFile({
        transforms: [{ question: QUESTION_ID, output: { schema_name: 'public', view: 'rev' } }],
      }), [makeQuestionFile()]);

      renderWithProviders(<TransformationContainerV2 fileId={TRANSFORM_ID} />, { store });

      expect(screen.getByLabelText('Selected question').textContent).toBe('Monthly Revenue');
    });

    it('falls back to "Question #<id>" when the question file is not in the files bag', () => {
      const store = setup(makeTransformationFile({
        transforms: [{ question: 999999, output: { schema_name: 'public', view: 'rev' } }],
      }));

      renderWithProviders(<TransformationContainerV2 fileId={TRANSFORM_ID} />, { store });

      expect(screen.getByLabelText('Selected question').textContent).toBe('Question #999999');
    });
  });
});
