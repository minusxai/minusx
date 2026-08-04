/**
 * Regression: on an instance without hosted Slack OAuth, step 4 of the wizard was a dead end —
 * an "Add to Slack" card with no button and the line "Slack OAuth is not configured. You can set
 * this up later in Settings." A quarter of the progress bar that could do nothing, and a pointer
 * so vague it did not say the thing that matters: you CAN connect Slack, by registering your own
 * app, and Settings already walks you through it.
 *
 * There are three genuinely different instance states and they need three different answers:
 *
 *   configured                        -> hosted OAuth, one click ("Add to Slack")
 *   !configured && selfHostedEnabled  -> bring your own Slack app; Settings has the guide
 *   !configured && !selfHostedEnabled -> no public HTTPS URL, so Slack cannot reach this
 *                                        instance at all; offering either flow would be a lie
 *
 * The self-hosted guide is deliberately NOT duplicated here. It spans a public-URL field, a
 * generated app manifest, a round trip to api.slack.com and two pasted secrets — the heaviest
 * task in the product, and wrong to inline at the end of first-run setup. The step signposts it.
 */

const CAPABILITIES: { configured: boolean; selfHostedEnabled: boolean } = {
  configured: false,
  selfHostedEnabled: false,
};

/** When true, the capability probe fails — as it did twice against a real deployment (HTTP 502). */
const FAIL_PROBE = { value: false };

vi.mock('@/lib/hooks/useConfigs', () => ({
  useConfigs: () => ({ config: { branding: { agentName: 'MinusX' }, bots: [] }, loaded: true }),
}));

global.fetch = vi.fn(async () => {
  if (FAIL_PROBE.value) throw new Error('HTTP 502: Bad Gateway');
  return new Response(
    JSON.stringify({ success: true, data: { ...CAPABILITIES } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}) as unknown as typeof fetch;

import { screen, waitFor } from '@testing-library/react';
import { makeStore } from '@/store/store';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import StepSlack from '@/components/connection-wizard/steps/StepSlack';

function render() {
  return renderWithProviders(<StepSlack onComplete={vi.fn()} />, { store: makeStore() });
}

describe('StepSlack — one honest state per instance capability', () => {
  beforeEach(() => { vi.clearAllMocks(); FAIL_PROBE.value = false; });

  it('offers one-click install when hosted OAuth is configured', async () => {
    CAPABILITIES.configured = true;
    CAPABILITIES.selfHostedEnabled = true;
    render();

    expect(await screen.findByRole('button', { name: /Add to Slack/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Slack in Settings/i })).not.toBeInTheDocument();
  });

  it('points at the self-hosted guide when OAuth is absent but the instance is reachable', async () => {
    CAPABILITIES.configured = false;
    CAPABILITIES.selfHostedEnabled = true;
    render();

    const link = await screen.findByRole('link', { name: /Slack in Settings/i });
    expect(link).toHaveAttribute('href', expect.stringContaining('/settings'));
    expect(link).toHaveAttribute('href', expect.stringContaining('integrations'));
    expect(screen.queryByRole('button', { name: /Add to Slack/i })).not.toBeInTheDocument();
  });

  it('offers nothing, and says why, when the instance has no public HTTPS URL', async () => {
    CAPABILITIES.configured = false;
    CAPABILITIES.selfHostedEnabled = false;
    render();

    await waitFor(() => expect(screen.getByText(/public HTTPS URL/i)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Add to Slack/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Slack in Settings/i })).not.toBeInTheDocument();
  });

  it('does not claim a missing public URL when it simply could not check', async () => {
    // "We failed to ask" is not "the answer is no". This probe 502'd twice against a real
    // deployment; treating that as a definitive capability answer tells the user a falsehood
    // about their own instance and hides the flow that may well work.
    FAIL_PROBE.value = true;
    render();

    expect(await screen.findByRole('button', { name: /Skip for now/i })).toBeInTheDocument();
    expect(screen.queryByText(/public HTTPS URL/i)).not.toBeInTheDocument();
  });

  it('always leaves a way forward', async () => {
    CAPABILITIES.configured = false;
    CAPABILITIES.selfHostedEnabled = false;
    render();

    expect(await screen.findByRole('button', { name: /Skip for now/i })).toBeInTheDocument();
  });
});
