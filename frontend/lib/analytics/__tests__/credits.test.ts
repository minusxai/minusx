import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { costToCredits } from '@/lib/analytics/credits';
import { parseBillingCycle, cycleStartSql, CREDIT_BUDGETS, CYCLE_MODE } from '@/lib/analytics/credit-budgets';

describe('costToCredits (v0: credits = cost * 1000)', () => {
  it('multiplies cost by 1000', () => {
    expect(costToCredits({ cachedTokens: 0, nonCachedTokens: 0, outputTokens: 0, cost: 0.5 })).toBe(500);
  });

  it('is 0 for zero cost', () => {
    expect(costToCredits({ cachedTokens: 10, nonCachedTokens: 20, outputTokens: 30, cost: 0 })).toBe(0);
  });

  it('handles fractional cost', () => {
    expect(costToCredits({ cachedTokens: 0, nonCachedTokens: 0, outputTokens: 0, cost: 1.2345 })).toBeCloseTo(1234.5, 6);
  });

  it('ignores token fields in v0 (only cost drives credits)', () => {
    const a = costToCredits({ cachedTokens: 0, nonCachedTokens: 0, outputTokens: 0, cost: 2 });
    const b = costToCredits({ cachedTokens: 999, nonCachedTokens: 888, outputTokens: 777, cost: 2 });
    expect(a).toBe(b);
    expect(a).toBe(2000);
  });
});

describe('parseBillingCycle', () => {
  it('parses days/weeks/months into a rolling day window', () => {
    expect(parseBillingCycle('1d').days).toBe(1);
    expect(parseBillingCycle('7d').days).toBe(7);
    expect(parseBillingCycle('1w').days).toBe(7);
    expect(parseBillingCycle('2w').days).toBe(14);
    expect(parseBillingCycle('1m').days).toBe(30);
    expect(parseBillingCycle('3m').days).toBe(90);
  });

  it('produces human labels (default calendar mode: "today" / "this month")', () => {
    // Guard: these expected labels assume the default CYCLE_MODE.
    expect(CYCLE_MODE).toBe('calendar');
    expect(parseBillingCycle('1m').label).toBe('this month');
    expect(parseBillingCycle('1d').label).toBe('today');
    expect(parseBillingCycle('7d').label).toBe('last 7 days');
    expect(parseBillingCycle('2w').label).toBe('last 2 weeks');
  });

  it('clamps to the max window and falls back on bad specs', () => {
    expect(parseBillingCycle('24m').days).toBe(CREDIT_BUDGETS.maxBillingCycleDays); // 720 > 366
    expect(parseBillingCycle('garbage').raw).toBe(CREDIT_BUDGETS.defaultBillingCycle);
    expect(parseBillingCycle('').raw).toBe(CREDIT_BUDGETS.defaultBillingCycle);
    expect(parseBillingCycle(undefined, '1w').raw).toBe('1w'); // custom fallback
  });

  it('cycleStartSql builds calendar-aligned window boundaries', () => {
    expect(CYCLE_MODE).toBe('calendar');
    expect(cycleStartSql(parseBillingCycle('1m'))).toBe("date_trunc('month', NOW())");
    expect(cycleStartSql(parseBillingCycle('1d'))).toBe("date_trunc('day', NOW())");
    expect(cycleStartSql(parseBillingCycle('1w'))).toBe("date_trunc('week', NOW())");
    expect(cycleStartSql(parseBillingCycle('3m'))).toBe("date_trunc('month', NOW()) - INTERVAL '2 month'");
  });
});

describe('allowance resolvers', () => {
  const ORIGINAL = process.env.CREDIT_ALLOWANCES;

  beforeEach(() => {
    vi.resetModules();
  });
  const ORIGINAL_RESET = process.env.CREDIT_RESET_ALLOWANCES;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.CREDIT_ALLOWANCES;
    else process.env.CREDIT_ALLOWANCES = ORIGINAL;
    if (ORIGINAL_RESET === undefined) delete process.env.CREDIT_RESET_ALLOWANCES;
    else process.env.CREDIT_RESET_ALLOWANCES = ORIGINAL_RESET;
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

  it('resolves reset-cycle allowances independently (default 1,000 / 10,000)', async () => {
    delete process.env.CREDIT_RESET_ALLOWANCES;
    const cfg = await import('@/lib/config');
    expect(cfg.resolveIndividualResetAllowance('viewer')).toBe(1_000);
    expect(cfg.resolveOrgResetAllowance()).toBe(10_000);
  });

  it('applies role-wise CREDIT_RESET_ALLOWANCES overrides', async () => {
    process.env.CREDIT_RESET_ALLOWANCES = JSON.stringify({ viewer: 200, org: 3000 });
    const cfg = await import('@/lib/config');
    expect(cfg.resolveIndividualResetAllowance('viewer')).toBe(200);
    expect(cfg.resolveIndividualResetAllowance('admin')).toBe(1_000); // default fallback
    expect(cfg.resolveOrgResetAllowance()).toBe(3000);
  });
});
