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
  used: 50,
  allowance: 10_000,
  rows: [{ provider: 'anthropic', model: 'opus', nonCachedInputTokens: 100, cachedTokens: 0, outputTokens: 50, credits: 50 }],
};

describe('CreditsUsageCards', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it('renders only the individual card when org is null (non-admin)', async () => {
    mockUsage({ individual, org: null });
    renderWithProviders(<CreditsUsageCards />);

    await waitFor(() => expect(screen.getByLabelText('Your usage')).toBeInTheDocument());
    expect(screen.queryByLabelText('Organization usage')).not.toBeInTheDocument();
  });

  it('renders both cards when org totals are present (admin)', async () => {
    mockUsage({ individual, org: { used: 150, allowance: 100_000, rows: individual.rows } });
    renderWithProviders(<CreditsUsageCards />);

    await waitFor(() => expect(screen.getByLabelText('Your usage')).toBeInTheDocument());
    expect(screen.getByLabelText('Organization usage')).toBeInTheDocument();
  });
});
