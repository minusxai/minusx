/**
 * Settings → Integrations → Slack, gated on the same two capabilities as the wizard step.
 *
 * The manual flow needs a public HTTPS base URL — `manifest` and `manual-install` both 403
 * without it. Nothing told the browser, so this panel rendered the entire guide on a localhost
 * install and revealed the truth as a 403 at "Generate manifest", two steps in.
 *
 * The failure case matters as much as the capability case: a non-200 or a thrown probe must not
 * read as "the answer is no". This endpoint's host returned 502 twice during one manual run, and
 * a pessimistic default would hide the whole setup UI and tell an admin their instance cannot
 * host Slack when we simply never asked.
 */

const CAPABILITIES: { configured: boolean; selfHostedEnabled: boolean } = {
  configured: false,
  selfHostedEnabled: true,
};
const FAIL_PROBE = { value: false };

vi.mock('@/lib/hooks/useConfigs', () => ({
  useConfigs: () => ({ config: { branding: { agentName: 'MinusX' }, bots: [] }, loaded: true }),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

global.fetch = vi.fn(async () => {
  if (FAIL_PROBE.value) throw new Error('HTTP 502: Bad Gateway');
  return new Response(
    JSON.stringify({ success: true, data: { ...CAPABILITIES } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}) as unknown as typeof fetch;

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { makeStore } from '@/store/store';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { SlackIntegration } from '@/components/settings/integrations/SlackIntegration';

/** The Slack panel is collapsed until clicked, so every case opens it first. */
async function render() {
  const r = renderWithProviders(<SlackIntegration />, { store: makeStore() });
  await userEvent.click(await screen.findByText(/Not connected — click to set up/i));
  return r;
}

const NO_URL_COPY = /Slack needs a public HTTPS URL/i;

describe('SlackIntegration — manual guide gated on selfHostedEnabled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FAIL_PROBE.value = false;
    CAPABILITIES.configured = false;
    CAPABILITIES.selfHostedEnabled = true;
  });

  it('offers the manual guide when the instance is publicly reachable', async () => {
    await render();

    expect(await screen.findByLabelText(/Generate Slack manifest|Create Slack app from manifest/i))
      .toBeInTheDocument();
    expect(screen.queryByText(NO_URL_COPY)).not.toBeInTheDocument();
  });

  it('replaces it with the reason when there is no public HTTPS URL', async () => {
    CAPABILITIES.selfHostedEnabled = false;
    await render();

    await waitFor(() => expect(screen.getByText(NO_URL_COPY)).toBeInTheDocument());
    expect(screen.queryByLabelText(/Slack bot token/i)).not.toBeInTheDocument();
  });

  it('keeps the guide available when the probe fails, rather than claiming a missing URL', async () => {
    FAIL_PROBE.value = true;
    await render();

    await waitFor(() => expect(screen.queryByText(NO_URL_COPY)).not.toBeInTheDocument());
    expect(await screen.findByLabelText(/Generate Slack manifest|Create Slack app from manifest/i))
      .toBeInTheDocument();
  });

  it('offers OAuth, and hides the dead-end copy, when hosted credentials exist', async () => {
    CAPABILITIES.configured = true;
    await render();

    expect(await screen.findByLabelText(/Add MinusX to Slack via OAuth/i)).toBeInTheDocument();
    expect(screen.queryByText(NO_URL_COPY)).not.toBeInTheDocument();
  });
});
