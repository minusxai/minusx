import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { CreditsUsageCards } from '@/components/settings/CreditsCard';
import type { CreditUsageResponse } from '@/lib/analytics/credits.types';

function mockUsage(data: CreditUsageResponse) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, data }) }),
  );
}

const individual: CreditUsageResponse['individual'] = {
  billing: {
    label: 'this month',
    used: 50,
    allowance: 10_000,
    resetsAt: '2026-08-01T00:00:00.000Z',
    rows: [{ provider: 'anthropic', model: 'opus', trigger: 'explore', nonCachedInputTokens: 100, cachedTokens: 0, outputTokens: 50, credits: 50 }],
  },
  reset: { label: 'today', used: 20, allowance: 1_000, resetsAt: '2026-07-04T00:00:00.000Z' },
};

describe('CreditsUsageCards', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it('renders only the individual card when org is null (non-admin)', async () => {
    mockUsage({ individual, org: null, enforced: false });
    renderWithProviders(<CreditsUsageCards />);

    await waitFor(() => expect(screen.getByLabelText('Your usage')).toBeInTheDocument());
    expect(screen.queryByLabelText('Organization usage')).not.toBeInTheDocument();
  });

  it('renders both cards when org totals are present (admin)', async () => {
    mockUsage({
      individual,
      enforced: false,
      org: {
        billing: { label: 'this month', used: 150, allowance: 100_000, resetsAt: '2026-08-01T00:00:00.000Z', rows: individual.billing.rows },
        reset: { label: 'today', used: 40, allowance: 10_000, resetsAt: '2026-07-04T00:00:00.000Z' },
      },
    });
    renderWithProviders(<CreditsUsageCards />);

    await waitFor(() => expect(screen.getByLabelText('Your usage')).toBeInTheDocument());
    expect(screen.getByLabelText('Organization usage')).toBeInTheDocument();
  });
});
