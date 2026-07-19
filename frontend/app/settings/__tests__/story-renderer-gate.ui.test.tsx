// storyRenderer is WORKSPACE-level: it resolves from the org config regardless of viewing mode
// (lib/data/configs.server.ts overlays org's value onto every mode). A write from a non-org Settings
// page lands on that mode's config, which the resolver then ignores — so the control would be a live
// no-op. Mirror the LLM Models section: gate the control to org mode, telling the user to switch.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { makeStore } from '@/store/store';
import { DEFAULT_CONFIG } from '@/lib/branding/whitelabel';
import SettingsPage from '@/app/settings/page';

let mockSearch = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/settings',
  useSearchParams: () => new URLSearchParams(mockSearch),
}));
vi.mock('@/lib/navigation/NavigationGuardProvider', () => ({
  useNavigationGuard: () => ({ navigate: vi.fn(), isBlocked: false, confirmNavigation: vi.fn(), cancelNavigation: vi.fn() }),
  NavigationGuardProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/lib/hooks/useConfigs', () => ({
  useConfigs: () => ({ config: { branding: { displayName: 'MinusX', agentName: 'MinusX' } } }),
  updateConfig: vi.fn(),
}));
vi.mock('next-auth/react', () => ({ signOut: vi.fn() }));
vi.mock('@/components/containers/ConfigContainerV2', () => ({ default: () => null }));
vi.mock('@/components/containers/StylesContainerV2', () => ({ default: () => null }));
vi.mock('@/components/dev/RecordingControl', () => ({ default: () => null }));
vi.mock('@/components/explore/ConversationList', () => ({ ConversationList: () => null }));
vi.mock('@/components/app-shell/CreateMenu', () => ({ default: () => null }));
vi.mock('@/components/selectors/ImpersonationSelector', () => ({ default: () => null }));

function storeForMode(mode: 'org' | 'tutorial') {
  return makeStore({
    configs: { creditsEnabled: false, config: DEFAULT_CONFIG },
    auth: { user: { name: 'Test User', email: 'test@example.com', role: 'admin', mode }, loading: false },
  } as never);
}

describe('Settings — Story Renderer control is org-gated (workspace-level)', () => {
  beforeEach(() => { mockSearch = ''; vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })); });
  afterEach(() => vi.unstubAllGlobals());

  it('enables the renderer buttons in org mode and shows no workspace notice', async () => {
    renderWithProviders(<SettingsPage />, { store: storeForMode('org') });
    await waitFor(() => expect(screen.getByLabelText('Settings section: General')).toBeInTheDocument());

    expect(screen.getByLabelText('Story renderer: Canvas')).toBeEnabled();
    expect(screen.queryByLabelText('Story renderer workspace-level notice')).not.toBeInTheDocument();
  });

  it('disables the renderer buttons outside org mode and shows the workspace notice', async () => {
    renderWithProviders(<SettingsPage />, { store: storeForMode('tutorial') });
    await waitFor(() => expect(screen.getByLabelText('Settings section: General')).toBeInTheDocument());

    expect(screen.getByLabelText('Story renderer: Canvas')).toBeDisabled();
    expect(screen.getByLabelText('Story renderer workspace-level notice')).toBeInTheDocument();
  });
});
