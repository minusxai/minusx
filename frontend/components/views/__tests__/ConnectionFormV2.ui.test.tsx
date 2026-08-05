/**
 * ConnectionFormV2 — characterization tests written for the Container/View
 * discipline move (CLAUDE.md "Refactoring — Blue → Red → Blue"), which has since
 * LANDED: ConnectionFormV2.tsx is props-only now, and the 4 selector reads it
 * used to make — state.ui.colorMode, state.auth.user?.mode (userMode),
 * state.ui.devMode (showJson), state.auth.user?.home_folder (homeFolder) — live
 * in ConnectionContainerV2.
 *
 * Mounted via ConnectionContainerV2 (NOT ConnectionFormV2 directly).
 *
 * Per-selector testability (checked against the "can this go RED" bar):
 *  - showJson is the only one of the 4 with a LIVE, observable DOM effect
 *    right now: it gates the Form/JSON View TabSwitcher (only shown in the
 *    Settings section). Real characterization test below.
 *  - colorMode only feeds the globally-mocked Monaco `theme` prop (no
 *    observable jsdom effect — Monaco is a plain textarea in tests).
 *  - homeFolder only feeds `useContext(homePath)`, which every test mocks
 *    wholesale (repo convention), so the argument value is never observed.
 *  These two are moved as plumbing (matching the container's existing
 *  `state.auth.user?.mode` fallback pattern) and are NOT independently
 *  tested here; verify visually (dark-mode Monaco) in a browser pass instead
 *  of forcing a fake jsdom signal.
 *
 * (The former 5th call site, state.auth.user?.id / userId, only fed the
 * "Quick Actions" sidebar's whitelist-toggle/add-context handlers, whose only
 * call sites were commented-out JSX. Both the handlers and the sidebar were
 * deleted as dead code in the post-M4.2 audit.)
 *
 * @/lib/hooks/useContext is mocked wholesale (repo convention).
 * All element queries by aria-label only (CLAUDE.md "Writing tests").
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
  // MX_EGRESS_IPS reaches the form as a prop (this view is Redux-restricted), so a
  // hosted customer can see which source IPs to allow through their DB firewall.
  describe('egress IP hint (configs.egressIps)', () => {
    function setupWithEgress(ips: string[], connType = 'postgresql') {
      const testStore = storeModule.makeStore({
        configs: { ...storeModule.makeStore().getState().configs, egressIps: ips },
      } as never);
      vi.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
      testStore.dispatch(setFile({ file: makeConnectionFile({ type: connType } as never), references: [] }));
      return testStore;
    }

    it('lists the IPs for a network-reached engine', () => {
      const store = setupWithEgress(['34.34.220.153', '35.1.2.3']);
      renderWithProviders(<ConnectionContainerV2 fileId={CONNECTION_ID} />, { store });
      fireEvent.click(screen.getByLabelText('Settings view'));
      const hint = screen.getByLabelText('Database firewall allowlist');
      expect(hint.textContent).toContain('34.34.220.153');
      expect(hint.textContent).toContain('35.1.2.3');
    });

    it('shows nothing when unset — that is how self-hosted opts out', () => {
      const store = setupWithEgress([]);
      renderWithProviders(<ConnectionContainerV2 fileId={CONNECTION_ID} />, { store });
      fireEvent.click(screen.getByLabelText('Settings view'));
      expect(screen.queryByLabelText('Database firewall allowlist')).toBeNull();
    });

    it('shows nothing for an IAM-authenticated cloud API', () => {
      const store = setupWithEgress(['34.34.220.153'], 'bigquery');
      renderWithProviders(<ConnectionContainerV2 fileId={CONNECTION_ID} />, { store });
      fireEvent.click(screen.getByLabelText('Settings view'));
      expect(screen.queryByLabelText('Database firewall allowlist')).toBeNull();
    });
  });

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
