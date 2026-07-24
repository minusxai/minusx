import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { makeStore } from '@/store/store';
import { DEFAULT_CONFIG } from '@/lib/branding/whitelabel';
import type { CreditUsageResponse } from '@/lib/analytics/credits.types';
import SettingsPage from '@/app/settings/page';
import Sidebar from '@/components/app-shell/Sidebar';

const replaceSpy = vi.fn();
const navigateSpy = vi.fn();
let mockSearch = '';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: replaceSpy, back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/settings',
  useSearchParams: () => new URLSearchParams(mockSearch),
}));
vi.mock('@/lib/navigation/NavigationGuardProvider', () => ({
  useNavigationGuard: () => ({ navigate: navigateSpy, isBlocked: false, confirmNavigation: vi.fn(), cancelNavigation: vi.fn() }),
  NavigationGuardProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/lib/hooks/useConfigs', () => ({
  useConfigs: () => ({ config: { branding: { displayName: 'MinusX', agentName: 'MinusX' }, analytics: { enabled: true } } }),
  updateConfig: vi.fn(),
}));
vi.mock('next-auth/react', () => ({ signOut: vi.fn() }));
// Heavy leaf components irrelevant to tab routing — stubbed for jsdom.
vi.mock('@/components/containers/ConfigContainerV2', () => ({ default: () => null }));
vi.mock('@/components/containers/StylesContainerV2', () => ({ default: () => null }));
vi.mock('@/components/dev/RecordingControl', () => ({ default: () => null }));
vi.mock('@/components/explore/ConversationList', () => ({ ConversationList: () => null }));
vi.mock('@/components/app-shell/CreateMenu', () => ({ default: () => null }));
vi.mock('@/components/selectors/ImpersonationSelector', () => ({ default: () => null }));

const individual: CreditUsageResponse['individual'] = {
  billing: { label: 'this month', used: 50, allowance: 10_000, resetsAt: '2026-08-01T00:00:00.000Z', rows: [] },
  reset: { label: 'today', used: 20, allowance: 1_000, resetsAt: '2026-07-04T00:00:00.000Z' },
};

// Branch by URL: admin controls hit /credits/events + /api/configs; the user card hits /credits/usage.
function mockUsageFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => url.includes('/credits/events') ? { success: true, data: { events: [] } }
        : url.includes('/api/configs') ? { success: true, data: { config: { credits: {} } } }
        : { success: true, data: { individual, org: null, enabled: false } satisfies CreditUsageResponse },
    })),
  );
}

function storeWith({ creditsEnabled = true, role = 'admin' } = {}) {
  return makeStore({
    configs: { creditsEnabled, config: DEFAULT_CONFIG },
    auth: { user: { name: 'Test User', email: 'test@example.com', role, mode: 'org' }, loading: false },
  } as never);
}

describe('Settings Usage tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearch = '';
    mockUsageFetch();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows a Usage tab with the personal credits card for a non-admin', async () => {
    mockSearch = 'tab=usage';
    renderWithProviders(<SettingsPage />, { store: storeWith({ role: 'viewer' }) });

    expect(screen.getByLabelText('Settings tab: Usage')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Credits usage')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByLabelText('Your usage')).toBeInTheDocument());
  });

  it('shows the credit controls panel on the Usage tab for an admin', async () => {
    mockSearch = 'tab=usage';
    renderWithProviders(<SettingsPage />, { store: storeWith({ role: 'admin' }) });

    expect(screen.getByLabelText('Settings tab: Usage')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Credit controls')).toBeInTheDocument());
    // The analytics link points at the seeded internals dashboard, not a bespoke breakdown.
    expect(screen.getByLabelText('Open credit analytics')).toBeInTheDocument();
  });

  it('does not render the credits card on the General tab', async () => {
    renderWithProviders(<SettingsPage />, { store: storeWith() });

    // General tab content is up (user info card present) but no credits card.
    await waitFor(() => expect(screen.getByLabelText('Settings section: General')).toBeInTheDocument());
    expect(screen.queryByLabelText('Credits usage')).not.toBeInTheDocument();
  });

  it('hides the Usage tab from non-admins when the credits module is off', () => {
    renderWithProviders(<SettingsPage />, { store: storeWith({ creditsEnabled: false, role: 'viewer' }) });

    expect(screen.getByLabelText('Settings tab: General')).toBeInTheDocument();
    expect(screen.queryByLabelText('Settings tab: Usage')).not.toBeInTheDocument();
  });

  it('still shows the Usage tab to admins when credits is off, so they can turn it on', () => {
    // The credits on/off switch lives INSIDE this tab (Credit controls); gating the tab
    // purely on creditsEnabled would deadlock — an admin could never reach the toggle.
    renderWithProviders(<SettingsPage />, { store: storeWith({ creditsEnabled: false, role: 'admin' }) });

    expect(screen.getByLabelText('Settings tab: Usage')).toBeInTheDocument();
  });

  it('groups settings in a dedicated navigation index', () => {
    renderWithProviders(<SettingsPage />, { store: storeWith() });

    const navigation = screen.getByRole('navigation', { name: 'Settings navigation' });
    expect(navigation).toHaveTextContent('Workspace');
    expect(navigation).toHaveTextContent('Management');
    expect(navigation).toHaveTextContent('General');
    expect(navigation).toHaveTextContent('AI Models');
  });

  it('does not expose the retired Viz V2 format toggle', () => {
    renderWithProviders(<SettingsPage />, { store: storeWith() });

    expect(screen.queryByText('Viz V2 Format (Beta)')).not.toBeInTheDocument();
  });

  it('searches setting labels and descriptions across sections', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />, { store: storeWith() });

    await user.type(screen.getByLabelText('Search settings'), 'confidence');

    expect(screen.getByLabelText('Settings search results')).toBeInTheDocument();
    expect(screen.getByLabelText('Settings > General > Trust Score')).toBeInTheDocument();
    expect(screen.queryByLabelText('Settings > General > Confirm Actions')).not.toBeInTheDocument();
  });

  it('finds nested settings destinations such as Slack', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />, { store: storeWith() });

    await user.type(screen.getByLabelText('Search settings'), 'signing secret');

    expect(screen.getByLabelText('Open Integrations: Slack')).toBeInTheDocument();
    expect(screen.getByText('Connect a Slack app using OAuth or manual credentials.')).toBeInTheDocument();
  });
});

describe('Sidebar usage donuts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearch = '';
    mockUsageFetch();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('navigates to the Usage settings tab when the donuts are clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Sidebar />, { store: storeWith() });

    await user.click(screen.getByLabelText('Account menu'));
    const donuts = await screen.findByLabelText('Credits usage bars');
    await user.click(donuts);

    expect(navigateSpy).toHaveBeenCalledWith('/settings?tab=usage');
  });
});
