/**
 * The sidebar account menu exposes a "Developer Mode" toggle (admins only),
 * alongside the Dark/Light toggle. It flips uiSlice devMode — which gates the
 * admin Code view. All queries by aria-label.
 */
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import * as storeModule from '@/store/store';
import { setUser } from '@/store/authSlice';
import type { UserRole } from '@/lib/types';
import { NavigationGuardProvider } from '@/lib/navigation/NavigationGuardProvider';

// The history list background-fetches /api/conversations (irrelevant here + noisy in jsdom).
vi.mock('@/components/explore/ConversationList', () => ({
  ConversationList: () => null,
}));

import Sidebar from '@/components/Sidebar';

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

describe('Sidebar developer-mode toggle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the Developer Mode toggle for admins and flips devMode on click', async () => {
    const store = setup('admin');
    renderSidebar(store);

    fireEvent.click(screen.getByLabelText('Account menu'));

    const toggle = await screen.findByLabelText('Turn on developer mode');
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
    expect(screen.queryByLabelText('Turn on developer mode')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Turn off developer mode')).not.toBeInTheDocument();
  });
});
