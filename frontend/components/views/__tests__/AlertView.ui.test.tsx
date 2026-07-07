/**
 * AlertView — characterizes CURRENT (pre-move) Redux behavior ahead of the
 * Container/View discipline move (CLAUDE.md "Refactoring — Blue -> Red -> Blue").
 * AlertView.tsx currently calls useAppSelector directly
 * at 2 sites (grep-verified, both read-only): selectFileEditMode (editMode),
 * selectIsDirty (isDirty).
 *
 * Mounted via AlertContainerV2 (NOT AlertView directly): the container's
 * fileId contract is stable across the refactor, so these same tests —
 * unchanged — must keep passing once the two selector calls move up from the
 * view into the container. Rendering AlertView directly would break across
 * the move since its prop interface is exactly what's being extended.
 *
 * useJobRuns is mocked to a static empty-runs stub (repo convention — see
 * components/containers/__tests__/context-edit-mode.ui.test.tsx) so the
 * useEffect-driven reload() network call never fires and `runs`/`isRunning`
 * are fully test-controlled. useUsers (pulled in transitively via
 * DeliveryPicker, rendered inside AlertView) is mocked for the same reason —
 * it fires an unmocked `/api/users` fetch on mount with no .catch, which
 * jsdom's undici can't resolve as a relative URL and turns into an unhandled
 * rejection that fails the run even though every assertion passes.
 *
 * All element queries by aria-label only (CLAUDE.md convention):
 *  - editMode is observed via TestList's "Delete test" button, which only
 *    renders when editMode is true and at least one test exists.
 *  - isDirty is observed via the AlertHistoryEmptyState hero (aria-label
 *    "No alert checks", from EmptyFileHero), whose description text varies
 *    with isDirty/tests.length; located by aria-label then read via
 *    textContent (not an additional query strategy).
 */
import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import * as storeModule from '@/store/store';
import { setFile, setEdit } from '@/store/filesSlice';
import { setFileEditMode } from '@/store/uiSlice';
import AlertContainerV2 from '@/components/containers/AlertContainerV2';
import type { DbFile, AlertContent, Test } from '@/lib/types';

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

vi.mock('@/lib/hooks/useUsers', () => ({
  useUsers: () => ({ users: [], loading: false }),
}));

// AlertHistoryEmptyState (rendered when there are no runs) calls useConfigs() for the
// branding agentName. Mocked so its fire-and-forget /api/configs fetch never runs in jsdom.
vi.mock('@/lib/hooks/useConfigs', () => ({
  useConfigs: () => ({ config: { branding: { agentName: 'MinusX' } }, loading: false }),
}));

const ALERT_ID = 300;

function makeTest(): Test {
  return {
    type: 'query',
    subject: { type: 'query', question_id: 1 },
    answerType: 'number',
    operator: '=',
    value: { type: 'constant', value: 1 },
  };
}

function makeAlertFile(content: Partial<AlertContent> = {}): DbFile {
  return {
    id: ALERT_ID,
    name: 'Revenue Alert',
    type: 'alert' as const,
    path: '/org/Revenue Alert',
    content: {
      tests: [],
      schedule: { cron: '0 9 * * 1', timezone: 'America/New_York' },
      recipients: [],
      ...content,
    } as AlertContent,
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

describe('AlertView via AlertContainerV2', () => {
  // Call site: selectFileEditMode(state, fileId)
  describe('editMode (selectFileEditMode)', () => {
    it('shows the Delete test control when Redux fileEditMode is true', () => {
      const store = setup(makeAlertFile({ tests: [makeTest()] }));
      store.dispatch(setFileEditMode({ fileId: ALERT_ID, editMode: true }));

      renderWithProviders(<AlertContainerV2 fileId={ALERT_ID} />, { store });

      expect(screen.getByLabelText('Delete test')).toBeInTheDocument();
    });

    it('hides the Delete test control when Redux fileEditMode is unset (defaults to false)', () => {
      const store = setup(makeAlertFile({ tests: [makeTest()] }));

      renderWithProviders(<AlertContainerV2 fileId={ALERT_ID} />, { store });

      expect(screen.queryByLabelText('Delete test')).not.toBeInTheDocument();
    });
  });

  // Call site: selectIsDirty(state, fileId) -> disables the run button + drives the empty-state message
  describe('isDirty (selectIsDirty)', () => {
    it('shows the "save your changes" message when the file is dirty and there are no runs', () => {
      const store = setup(makeAlertFile({ tests: [makeTest()] }));
      store.dispatch(setEdit({ fileId: ALERT_ID, edits: { description: 'draft' } })); // isDirty: true

      renderWithProviders(<AlertContainerV2 fileId={ALERT_ID} />, { store });

      expect(screen.getByLabelText('No alert checks').textContent)
        .toContain('Save your changes before checking');
    });

    it('shows the "add tests" message when clean with no tests configured', () => {
      const store = setup(makeAlertFile({ tests: [] })); // isDirty: false (no edits)

      renderWithProviders(<AlertContainerV2 fileId={ALERT_ID} />, { store });

      expect(screen.getByLabelText('No alert checks').textContent)
        .toContain('Add tests to monitor');
    });

    it('shows the "no checks yet" message when clean with tests configured', () => {
      const store = setup(makeAlertFile({ tests: [makeTest()] })); // isDirty: false (no edits)

      renderWithProviders(<AlertContainerV2 fileId={ALERT_ID} />, { store });

      expect(screen.getByLabelText('No alert checks').textContent)
        .toContain('No checks yet. Click "Check Now" to test your alert');
    });
  });
});
