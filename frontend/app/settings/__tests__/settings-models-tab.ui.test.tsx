import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { makeStore } from '@/store/store';
import { DEFAULT_CONFIG } from '@/lib/branding/whitelabel';
import SettingsPage from '@/app/settings/page';

const replaceSpy = vi.fn();
let mockSearch = '';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: replaceSpy, back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/settings',
  useSearchParams: () => new URLSearchParams(mockSearch),
}));
vi.mock('@/lib/navigation/NavigationGuardProvider', () => ({
  useNavigationGuard: () => ({ navigate: vi.fn(), isBlocked: false, confirmNavigation: vi.fn(), cancelNavigation: vi.fn() }),
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
vi.mock('@/components/settings/llm/LlmModelsSection', () => ({ LlmModelsSection: () => null }));

function storeWith({ showModelSettings = false } = {}) {
  return makeStore({
    configs: { config: DEFAULT_CONFIG, showModelSettings },
    auth: { user: { name: 'Test User', email: 'test@example.com', role: 'admin', mode: 'org' }, loading: false },
  } as never);
}

describe('Settings Models tab (SHOW_MODEL_SETTINGS gate)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearch = '';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [] }), text: async () => '' }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('hides the Models nav tab by default, even for admins', () => {
    renderWithProviders(<SettingsPage />, { store: storeWith() });

    expect(screen.getByLabelText('Settings tab: General')).toBeInTheDocument();
    expect(screen.queryByLabelText('Settings tab: Models')).not.toBeInTheDocument();
  });

  it('still reaches the Models tab directly via ?tab=models when the flag is off', () => {
    mockSearch = 'tab=models';
    renderWithProviders(<SettingsPage />, { store: storeWith() });

    // Nav trigger stays hidden, but the section content renders for the URL.
    expect(screen.queryByLabelText('Settings tab: Models')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Settings section: Models')).toBeInTheDocument();
  });

  it('shows the Models tab for admins when the flag is on', () => {
    renderWithProviders(<SettingsPage />, { store: storeWith({ showModelSettings: true }) });

    expect(screen.getByLabelText('Settings tab: Models')).toBeInTheDocument();
  });
});
