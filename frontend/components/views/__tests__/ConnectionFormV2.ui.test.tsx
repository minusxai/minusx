/**
 * ConnectionFormV2 — characterizes CURRENT (pre-move) Redux behavior ahead of
 * the Container/View discipline move (CLAUDE.md "Refactoring — Blue -> Red ->
 * Blue", Refactor-v2.md M4.2). ConnectionFormV2.tsx currently calls
 * useAppSelector directly at 5 sites (grep-verified): state.ui.colorMode,
 * state.auth.user?.mode (userMode), state.ui.devMode (showJson),
 * state.auth.user?.home_folder (homeFolder), state.auth.user?.id (userId).
 *
 * Mounted via ConnectionContainerV2 (NOT ConnectionFormV2 directly).
 *
 * Per-selector testability (checked against the "can this go RED" bar):
 *  - showJson is the only one of the 5 with a LIVE, observable DOM effect
 *    right now: it gates the Form/JSON View TabSwitcher (only shown in the
 *    Settings section). Real characterization test below.
 *  - colorMode only feeds the globally-mocked Monaco `theme` prop (no
 *    observable jsdom effect — Monaco is a plain textarea in tests).
 *  - homeFolder only feeds `useContext(homePath)`, which every test mocks
 *    wholesale (repo convention), so the argument value is never observed.
 *  - userId only feeds `handleWhitelistToggle`/`handleAddContext`, whose only
 *    call sites (the "Quick Actions" sidebar JSX) are currently commented out
 *    in ConnectionFormV2.tsx (dead code, not a live UI surface) — there is
 *    nothing to observe today.
 *  These three are moved as plumbing (matching the container's existing
 *  `state.auth.user?.mode` fallback pattern) and are NOT independently
 *  tested here; verify visually (dark-mode Monaco, whitelist toggle if it's
 *  ever un-commented) in a browser pass instead of forcing a fake jsdom signal.
 *
 * @/lib/hooks/useContext is mocked wholesale (repo convention).
 * All element queries by aria-label only (CLAUDE.md convention).
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import * as storeModule from '@/store/store';
import { setFile } from '@/store/filesSlice';
import { setDevMode } from '@/store/uiSlice';
import ConnectionContainerV2 from '@/components/containers/ConnectionContainerV2';
import type { DbFile, ConnectionContent } from '@/lib/types';

vi.mock('@/lib/hooks/useContext', () => ({
  useContext: () => ({ databases: [], contextDocs: undefined, hasContext: false, contextId: undefined }),
}));

const CONNECTION_ID = 700;

function makeConnectionFile(content: Partial<ConnectionContent> = {}): DbFile {
  return {
    id: CONNECTION_ID,
    name: 'analytics_prod',
    type: 'connection' as const,
    path: '/org/database/analytics_prod',
    content: {
      type: 'postgresql',
      config: { host: 'localhost', port: 5432, database: 'analytics', username: 'admin', password: '' },
      schema: { schemas: [] },
      ...content,
    } as ConnectionContent,
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
  testStore.dispatch(setFile({ file: makeConnectionFile(), references: [] }));
  return testStore;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ConnectionFormV2 via ConnectionContainerV2', () => {
  // Call site: state.ui.devMode (showJson)
  describe('showJson (state.ui.devMode)', () => {
    it('shows the Form/JSON View tab switcher in the Settings section when devMode is on', () => {
      const store = setup();
      store.dispatch(setDevMode(true));

      renderWithProviders(<ConnectionContainerV2 fileId={CONNECTION_ID} />, { store });
      fireEvent.click(screen.getByLabelText('Settings view'));

      expect(screen.getByLabelText('JSON View')).toBeInTheDocument();
    });

    it('hides the Form/JSON View tab switcher when devMode is off', () => {
      const store = setup();

      renderWithProviders(<ConnectionContainerV2 fileId={CONNECTION_ID} />, { store });
      fireEvent.click(screen.getByLabelText('Settings view'));

      expect(screen.queryByLabelText('JSON View')).not.toBeInTheDocument();
    });
  });
});
