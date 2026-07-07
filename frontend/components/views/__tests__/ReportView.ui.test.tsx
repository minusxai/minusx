/**
 * ReportView — characterizes CURRENT (pre-move) Redux behavior ahead of the
 * Container/View discipline move (CLAUDE.md "Refactoring — Blue -> Red -> Blue").
 * ReportView.tsx currently calls useAppSelector directly
 * at 2 sites (grep-verified, both read-only): selectFileEditMode (editMode),
 * selectIsDirty (isDirty).
 *
 * Mounted via ReportContainerV2 (NOT ReportView directly): the container's
 * fileId contract is stable across the refactor, so these same tests —
 * unchanged — must keep passing once the two selector calls move up from the
 * view into the container.
 *
 * useJobRuns is mocked to a static empty-runs stub (repo convention — see
 * AlertView.ui.test.tsx) so the useEffect-driven reload() never fires.
 * @/lib/hooks/useContext is mocked wholesale (repo convention — every UI test
 * that pulls it in mocks it; it otherwise fires an unmocked /api/skills/system
 * fetch on mount). ReportContainerV2 only destructures `databases` from it.
 * useUsers (pulled in transitively via DeliveryCard, rendered inside
 * ReportView) is mocked for the same reason as AlertView.ui.test.tsx: it
 * fires an unmocked /api/users fetch on mount with no .catch.
 *
 * All element queries by aria-label only (CLAUDE.md convention):
 *  - editMode is observed via the "Report instructions" editor container,
 *    which only renders the Lexical editor (not the read-only viewer) when
 *    editMode is true — detected via the presence of a contenteditable node.
 *  - isDirty is observed via the empty-state text next to "Run Now", read via
 *    a fixed aria-label on the run-content region added for this test... no
 *    such label exists yet, so instead we assert on the RunNowHeader's
 *    disabled state is out of scope; we use the visible empty-state Text
 *    which has no aria-label either. We add one aria-label to the empty
 *    state container in ReportView.tsx (`aria-label="No report runs"`) to
 *    make this queryable, matching AlertView's "No alert checks" pattern.
 */
import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import * as storeModule from '@/store/store';
import { setFile, setEdit } from '@/store/filesSlice';
import { setFileEditMode } from '@/store/uiSlice';
import ReportContainerV2 from '@/components/containers/ReportContainerV2';
import type { DbFile, ReportContent } from '@/lib/types';

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

vi.mock('@/lib/hooks/useContext', () => ({
  useContext: () => ({ databases: [] }),
}));

vi.mock('@/lib/hooks/useUsers', () => ({
  useUsers: () => ({ users: [], loading: false }),
}));

const REPORT_ID = 400;

function makeReportFile(content: Partial<ReportContent> = {}): DbFile {
  return {
    id: REPORT_ID,
    name: 'Weekly Report',
    type: 'report' as const,
    path: '/org/Weekly Report',
    content: {
      reportPrompt: '',
      recipients: [],
      schedule: { cron: '0 9 * * 1', timezone: 'America/New_York' },
      ...content,
    } as ReportContent,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    references: [] as number[],
    version: 1,
    last_edit_id: null,
  } as DbFile;
}

function setup(file: DbFile) {
  const testStore = storeModule.makeStore();
  vi.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
  testStore.dispatch(setFile({ file, references: [] }));
  return testStore;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ReportView via ReportContainerV2', () => {
  // Call site: selectFileEditMode(state, fileId)
  describe('editMode (selectFileEditMode)', () => {
    it('renders the editable Lexical editor for instructions when Redux fileEditMode is true', () => {
      const store = setup(makeReportFile());
      store.dispatch(setFileEditMode({ fileId: REPORT_ID, editMode: true }));

      renderWithProviders(<ReportContainerV2 fileId={REPORT_ID} />, { store });

      const editorBox = screen.getByLabelText('Report instructions');
      expect(editorBox.querySelector('[contenteditable="true"]')).toBeInTheDocument();
    });

    it('renders the read-only viewer for instructions when Redux fileEditMode is unset', () => {
      const store = setup(makeReportFile());

      renderWithProviders(<ReportContainerV2 fileId={REPORT_ID} />, { store });

      const editorBox = screen.getByLabelText('Report instructions');
      expect(editorBox.querySelector('[contenteditable="true"]')).not.toBeInTheDocument();
    });
  });

  // Call site: selectIsDirty(state, fileId) -> drives the empty-state message
  describe('isDirty (selectIsDirty)', () => {
    it('shows the "save your changes" message when the file is dirty and there are no runs', () => {
      const store = setup(makeReportFile({ reportPrompt: 'do the thing' }));
      store.dispatch(setEdit({ fileId: REPORT_ID, edits: { description: 'draft' } })); // isDirty: true

      renderWithProviders(<ReportContainerV2 fileId={REPORT_ID} />, { store });

      expect(screen.getByLabelText('No report runs').textContent)
        .toContain('Save your changes before running');
    });

    it('shows the "add instructions" message when clean with no prompt configured', () => {
      const store = setup(makeReportFile({ reportPrompt: '' })); // isDirty: false

      renderWithProviders(<ReportContainerV2 fileId={REPORT_ID} />, { store });

      expect(screen.getByLabelText('No report runs').textContent)
        .toContain('Add report instructions to run the report');
    });

    it('shows the "no runs yet" message when clean with a prompt configured', () => {
      const store = setup(makeReportFile({ reportPrompt: 'do the thing' })); // isDirty: false

      renderWithProviders(<ReportContainerV2 fileId={REPORT_ID} />, { store });

      expect(screen.getByLabelText('No report runs').textContent)
        .toContain('No runs yet. Click "Run Now" to test your report');
    });
  });
});
