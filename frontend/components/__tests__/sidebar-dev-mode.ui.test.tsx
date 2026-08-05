/**
 * The sidebar account menu exposes a "Developer Mode" toggle (admins only),
 * alongside the Dark/Light toggle. It flips uiSlice devMode — which gates the
 * admin Code view. All queries by aria-label.
 */
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import * as storeModule from '@/store/store';
import { setUser } from '@/store/authSlice';
import { setFile } from '@/store/filesSlice';
import { setEnableCustomAgents } from '@/store/uiSlice';
import type { DbFile, UserRole } from '@/lib/types';
import { NavigationGuardProvider } from '@/lib/navigation/NavigationGuardProvider';

// The history list background-fetches /api/conversations (irrelevant here + noisy in jsdom).
vi.mock('@/components/explore/ConversationList', () => ({
  ConversationList: () => null,
}));

import Sidebar from '@/components/app-shell/Sidebar';

const renderSidebar = (store: ReturnType<typeof storeModule.makeStore>) =>
  renderWithProviders(
    <NavigationGuardProvider>
      <Sidebar />
    </NavigationGuardProvider>,
    { store },
  );

function setup(role: UserRole) {
  const testStore = storeModule.makeStore();
  vi.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
  testStore.dispatch(setUser({ id: 1, email: 'a@b.co', name: 'Admin', role, mode: 'org' }));
  return testStore;
}

function addKnowledgeBase(store: ReturnType<typeof storeModule.makeStore>) {
  store.dispatch(setEnableCustomAgents(true));
  store.dispatch(setFile({
    file: {
      id: 1008,
      name: 'Knowledge Base',
      path: '/org/Knowledge Base',
      type: 'context',
      content: { published: { all: 1 }, agents: [] },
      references: [],
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      version: 1,
      last_edit_id: null,
    } as DbFile,
  }));
}

describe('Sidebar developer-mode toggle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the Developer Mode toggle for admins and flips devMode on click', async () => {
    const store = setup('admin');
    renderSidebar(store);

    fireEvent.click(screen.getByLabelText('Account menu'));

    const toggle = await screen.findByLabelText('Dev mode toggle');
    expect(store.getState().ui.devMode).toBe(false);

    fireEvent.click(toggle);
    await waitFor(() => expect(store.getState().ui.devMode).toBe(true));
  });

  it('hides the Developer Mode toggle for non-admins', async () => {
    const store = setup('viewer');
    renderSidebar(store);

    fireEvent.click(screen.getByLabelText('Account menu'));

    // The menu is open (Dark/Light toggle is present) but the dev toggle is not.
    await screen.findByLabelText('Account menu');
    expect(screen.queryByLabelText('Dev mode toggle')).not.toBeInTheDocument();
  });
});

describe('Sidebar Agents navigation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each<UserRole>(['viewer', 'editor', 'admin'])(
    'shows the resolved context Agents page to %s users',
    (role) => {
      const store = setup(role);
      addKnowledgeBase(store);
      renderSidebar(store);

      expect(screen.getByLabelText('Agents').closest('a')).toHaveAttribute(
        'href',
        '/f/1008?tab=agents',
      );
    },
  );

  it('does not expose a dead Agents link when Custom Agents is disabled', () => {
    const store = setup('viewer');
    renderSidebar(store);

    expect(screen.queryByLabelText('Agents')).not.toBeInTheDocument();
  });
});
