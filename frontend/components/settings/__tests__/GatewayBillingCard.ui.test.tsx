/**
 * The plan & balance panel.
 *
 * Every element is located by `aria-label`, per the repo's UI test convention.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';

import { GatewayBillingCard } from '../GatewayBillingCard';

function reply(body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(
    JSON.stringify({ data: body }), { status: 200 },
  )));
}

const SUBSCRIBED = {
  enabled: true, reachable: true, usage: [],
  status: {
    orgId: 'org_1', subscribed: true, willRenew: true, plan: 'plus',
    accessExpiresAt: '2026-09-01T00:00:00Z', nextPlan: 'plus',
    balanceMicroUsd: 7_500_000, expiringSoonMicroUsd: 0,
    periodGrantedMicroUsd: 10_000_000, periodUsedMicroUsd: 2_500_000,
    percentUsed: 0.25,
  },
};

beforeEach(() => vi.restoreAllMocks());

describe('GatewayBillingCard', () => {
  it('renders nothing at all when this install has no gateway', async () => {
    // Such a workspace is not in an error state — it simply has no billing,
    // and an empty card would be noise on every one of those settings pages.
    reply({ enabled: false });
    const { container } = renderWithProviders(<GatewayBillingCard />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('shows the balance', async () => {
    reply(SUBSCRIBED);
    renderWithProviders(<GatewayBillingCard />);
    expect(await screen.findByLabelText('Credit balance')).toHaveTextContent('$7.50');
  });

  it('distinguishes a renewing plan from one that is ending', async () => {
    reply(SUBSCRIBED);
    renderWithProviders(<GatewayBillingCard />);
    expect(await screen.findByLabelText('Subscription status')).toHaveTextContent(/renews/i);

    reply({ ...SUBSCRIBED, status: { ...SUBSCRIBED.status, willRenew: false } });
    renderWithProviders(<GatewayBillingCard />);
    await waitFor(() => {
      const nodes = screen.getAllByLabelText('Subscription status');
      expect(nodes[nodes.length - 1]).toHaveTextContent(/ends/i);
    });
  });

  it('says lapsed but still shows credits they own', async () => {
    // A balance without an active plan is a normal state — hiding the balance
    // or showing "$0" here would be wrong.
    reply({
      enabled: true, reachable: true, usage: [],
      status: {
        ...SUBSCRIBED.status, subscribed: false, willRenew: false, plan: null,
        balanceMicroUsd: 5_000_000, periodGrantedMicroUsd: null,
        periodUsedMicroUsd: null, percentUsed: null,
      },
    });
    renderWithProviders(<GatewayBillingCard />);

    expect(await screen.findByLabelText('Subscription status')).toHaveTextContent(/no active plan/i);
    expect(screen.getByLabelText('Credit balance')).toHaveTextContent('$5.00');
  });

  it('hides the plan usage bar when there is no plan to measure against', async () => {
    reply({
      enabled: true, reachable: true, usage: [],
      status: { ...SUBSCRIBED.status, subscribed: false, percentUsed: null,
                periodGrantedMicroUsd: null, periodUsedMicroUsd: null },
    });
    renderWithProviders(<GatewayBillingCard />);
    await screen.findByLabelText('Credit balance');
    expect(screen.queryByLabelText('Plan usage')).toBeNull();
  });

  it('warns about credits that are about to expire', async () => {
    reply({ ...SUBSCRIBED, status: { ...SUBSCRIBED.status, expiringSoonMicroUsd: 3_000_000 } });
    renderWithProviders(<GatewayBillingCard />);
    expect(await screen.findByLabelText('Expiring soon')).toHaveTextContent('$3.00');
  });

  it('says so when the gateway is unreachable rather than showing a stale zero', async () => {
    reply({ enabled: true, reachable: false });
    renderWithProviders(<GatewayBillingCard />);
    expect(await screen.findByLabelText('Billing unavailable')).toBeInTheDocument();
    expect(screen.queryByLabelText('Credit balance')).toBeNull();
  });
  it('is not titled "Credits" — the limits card below already is', async () => {
    // Two adjacent cards headed "Credits" showing different numbers is
    // unreadable; caught by looking at the settings page.
    reply(SUBSCRIBED);
    renderWithProviders(<GatewayBillingCard />);
    await screen.findByLabelText('Credit balance');
    expect(screen.getByLabelText('Billing')).toHaveTextContent(/plan & balance/i);
  });
});
