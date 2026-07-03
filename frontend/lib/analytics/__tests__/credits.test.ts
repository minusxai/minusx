import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { costToCredits } from '@/lib/analytics/credits';

describe('costToCredits (v0: 1 credit = $0.01)', () => {
  it('multiplies cost by 100', () => {
    expect(costToCredits({ cachedTokens: 0, nonCachedTokens: 0, outputTokens: 0, cost: 0.5 })).toBe(50);
  });

  it('is 0 for zero cost', () => {
    expect(costToCredits({ cachedTokens: 10, nonCachedTokens: 20, outputTokens: 30, cost: 0 })).toBe(0);
  });

  it('handles fractional cost', () => {
    expect(costToCredits({ cachedTokens: 0, nonCachedTokens: 0, outputTokens: 0, cost: 1.2345 })).toBeCloseTo(123.45, 6);
  });

  it('ignores token fields in v0 (only cost drives credits)', () => {
    const a = costToCredits({ cachedTokens: 0, nonCachedTokens: 0, outputTokens: 0, cost: 2 });
    const b = costToCredits({ cachedTokens: 999, nonCachedTokens: 888, outputTokens: 777, cost: 2 });
    expect(a).toBe(b);
    expect(a).toBe(200);
  });
});

describe('allowance resolvers', () => {
  const ORIGINAL = process.env.CREDIT_ALLOWANCES;

  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.CREDIT_ALLOWANCES;
    else process.env.CREDIT_ALLOWANCES = ORIGINAL;
    vi.resetModules();
  });

  it('defaults to 10,000 per user and 100,000 for org when unset', async () => {
    delete process.env.CREDIT_ALLOWANCES;
    const { resolveIndividualAllowance, resolveOrgAllowance } = await import('@/lib/config');
    expect(resolveIndividualAllowance('admin')).toBe(10_000);
    expect(resolveIndividualAllowance('viewer')).toBe(10_000);
    expect(resolveOrgAllowance()).toBe(100_000);
  });

  it('applies role-wise overrides from CREDIT_ALLOWANCES', async () => {
    process.env.CREDIT_ALLOWANCES = JSON.stringify({ admin: 5000, editor: 3000, viewer: 2000, org: 50000 });
    const { resolveIndividualAllowance, resolveOrgAllowance } = await import('@/lib/config');
    expect(resolveIndividualAllowance('admin')).toBe(5000);
    expect(resolveIndividualAllowance('editor')).toBe(3000);
    expect(resolveIndividualAllowance('viewer')).toBe(2000);
    expect(resolveOrgAllowance()).toBe(50000);
  });

  it('falls back to the default for a role missing from the override', async () => {
    process.env.CREDIT_ALLOWANCES = JSON.stringify({ admin: 5000 });
    const { resolveIndividualAllowance, resolveOrgAllowance } = await import('@/lib/config');
    expect(resolveIndividualAllowance('viewer')).toBe(10_000);
    expect(resolveOrgAllowance()).toBe(100_000);
  });

  it('falls back to defaults when CREDIT_ALLOWANCES is invalid JSON', async () => {
    process.env.CREDIT_ALLOWANCES = 'not-json';
    const { resolveIndividualAllowance, resolveOrgAllowance } = await import('@/lib/config');
    expect(resolveIndividualAllowance('admin')).toBe(10_000);
    expect(resolveOrgAllowance()).toBe(100_000);
  });
});
