/**
 * Regression: the no-usable-LLM guard lived in ONE caller, so every other route to
 * completion walked straight past it.
 *
 * `handleSkipToHome` (the top-right "Skip Setup" button) checked `hasUsableLlmProvider`
 * and bounced to the models step. But HelloWorldContent handed the RAW `handleComplete`
 * to ConnectionWizard as `onComplete`, and the wizard calls that from several places —
 * the step-indicator "Skip" link, StepSlack's "Skip for now", StepContext's
 * "Skip & figure out later", StepGenerating's skip links. Each of those could mark setup
 * complete over a workspace with no provider that can authenticate.
 *
 * That state is unrecoverable by design: completion is also what stops the wizard being
 * offered, so the one step that could add a provider is no longer reachable — the exact
 * outcome the guard exists to prevent.
 *
 * The fix puts the guard inside the completion path itself, so no caller can bypass it.
 * This test drives one of the real bypass routes end to end.
 */

type ConfigPatch = { setupWizard?: { status?: string; step?: string } };
const { updateConfigMock } = vi.hoisted(() => ({
  updateConfigMock: vi.fn(async (_partial: { setupWizard?: { status?: string; step?: string } }) => {}),
}));

const CONFIG_HOLDER: { llm: unknown } = { llm: {} };

vi.mock('@/lib/hooks/useConfigs', () => ({
  updateConfig: updateConfigMock,
  reloadConfigs: vi.fn(async () => {}),
  useConfigs: () => ({
    config: {
      branding: { agentName: 'MinusX' },
      llm: CONFIG_HOLDER.llm,
      // Park the wizard on the Slack step so "Skip for now" is one click away.
      setupWizard: { status: 'pending', step: 'slack', connectionId: 1, connectionName: 'static' },
    },
    loaded: true,
  }),
}));

vi.mock('@/lib/hooks/file-state-hooks', () => ({
  useFilesByCriteria: () => ({ files: [], loading: false, error: null }),
  useFile: () => ({ fileState: undefined }),
}));

// StepSlack probes this on mount; keep it deterministic and irrelevant to the guard.
global.fetch = vi.fn(async () => new Response(
  JSON.stringify({ success: true, data: { configured: false } }),
  { status: 200, headers: { 'Content-Type': 'application/json' } },
)) as unknown as typeof fetch;

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { makeStore } from '@/store/store';
import { setUser } from '@/store/authSlice';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { HelloWorldContent } from '@/app/hello-world/HelloWorldContent';

const PROVIDER_WITH_KEY = { providers: [{ name: 'minusx', provider: 'minusx', apiKey: 'sk-real-key' }] };
const PROVIDER_WITHOUT_KEY = { providers: [{ name: 'minusx', provider: 'minusx', apiKey: '' }] };

function render() {
  const store = makeStore();
  store.dispatch(setUser({
    userId: 1, email: 'test@example.com', name: 'Test', role: 'admin', home_folder: '/org', mode: 'org',
  } as never));
  return renderWithProviders(<HelloWorldContent />, { store });
}

async function clickSkipForNow() {
  const user = userEvent.setup();
  const btn = await screen.findByRole('button', { name: /Skip for now/i });
  await user.click(btn);
}

describe('HelloWorldContent — completion guard applies to every caller', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('refuses to mark setup complete when no provider can authenticate', async () => {
    CONFIG_HOLDER.llm = PROVIDER_WITHOUT_KEY;
    render();

    await clickSkipForNow();

    await waitFor(() => expect(updateConfigMock).toHaveBeenCalled());
    const completed = updateConfigMock.mock.calls.some(
      ([arg]: [ConfigPatch]) => arg?.setupWizard?.status === 'complete'
    );
    expect(completed).toBe(false);
  });

  it('redirects that caller to the models step instead', async () => {
    CONFIG_HOLDER.llm = PROVIDER_WITHOUT_KEY;
    render();

    await clickSkipForNow();

    await waitFor(() => {
      const wentToModels = updateConfigMock.mock.calls.some(
        ([arg]: [ConfigPatch]) => arg?.setupWizard?.step === 'models'
      );
      expect(wentToModels).toBe(true);
    });
  });

  it('completes normally once a provider can authenticate', async () => {
    CONFIG_HOLDER.llm = PROVIDER_WITH_KEY;
    render();

    await clickSkipForNow();

    await waitFor(() => {
      const completed = updateConfigMock.mock.calls.some(
        ([arg]: [ConfigPatch]) => arg?.setupWizard?.status === 'complete'
      );
      expect(completed).toBe(true);
    });
  });
});
