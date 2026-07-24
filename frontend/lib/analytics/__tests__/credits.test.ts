import { describe, it, expect } from 'vitest';
import { costToCredits, remainingCredits, remainingInWindow } from '@/lib/analytics/credits';
import type { CreditScope } from '@/lib/analytics/credits.types';
import { parseBillingCycle, cycleStartSql, cycleNextResetSql, resolveCreditConfig, CREDIT_BUDGETS, CYCLE_MODE } from '@/lib/analytics/credit-budgets';

describe('costToCredits (default weights: credits = cost*100 + 1 per request)', () => {
  it('applies the cost weight (×100) with no requests', () => {
    expect(costToCredits({ cachedTokens: 0, nonCachedTokens: 0, outputTokens: 0, cost: 0.5 })).toBe(50);
  });

  it('is 0 for zero cost and no requests', () => {
    expect(costToCredits({ cachedTokens: 10, nonCachedTokens: 20, outputTokens: 30, cost: 0 })).toBe(0);
  });

  it('handles fractional cost', () => {
    expect(costToCredits({ cachedTokens: 0, nonCachedTokens: 0, outputTokens: 0, cost: 1.2345 })).toBeCloseTo(123.45, 6);
  });

  it('ignores token fields (weight 0) but counts requests with default weights', () => {
    const a = costToCredits({ cachedTokens: 0, nonCachedTokens: 0, outputTokens: 0, requests: 3, cost: 2 });
    const b = costToCredits({ cachedTokens: 999, nonCachedTokens: 888, outputTokens: 777, requests: 3, cost: 2 });
    expect(a).toBe(b);       // token buckets have weight 0 → ignored
    expect(a).toBe(203);     // 2*100 + 3 requests
  });

  it('applies custom weights: cost + tokens + requests', () => {
    const weights = { cost: 10, cachedTokens: 1, nonCachedTokens: 2, outputTokens: 3, requests: 100 };
    // 0.5*10 + 20*2 + 10*1 + 5*3 + 2*100 = 5 + 40 + 10 + 15 + 200 = 270
    expect(costToCredits({ cost: 0.5, cachedTokens: 10, nonCachedTokens: 20, outputTokens: 5, requests: 2 }, weights)).toBe(270);
  });
});

describe('resolveCreditConfig', () => {
  it('returns the defaults for empty/invalid override', () => {
    expect(resolveCreditConfig(undefined)).toBe(CREDIT_BUDGETS);
    expect(resolveCreditConfig(null)).toBe(CREDIT_BUDGETS);
    expect(resolveCreditConfig('nope')).toBe(CREDIT_BUDGETS);
  });

  it('deep-merges weights and overrides scalar fields, leaving the rest as defaults', () => {
    const cfg = resolveCreditConfig({ weights: { requests: 5, outputTokens: 2 }, defaultIndividualAllowance: 42, defaultBillingCycle: '1w' });
    expect(cfg.weights.requests).toBe(5);
    expect(cfg.weights.outputTokens).toBe(2);
    expect(cfg.weights.cost).toBe(CREDIT_BUDGETS.weights.cost);           // untouched
    expect(cfg.defaultIndividualAllowance).toBe(42);
    expect(cfg.defaultBillingCycle).toBe('1w');
    expect(cfg.defaultOrgAllowance).toBe(CREDIT_BUDGETS.defaultOrgAllowance); // untouched
  });

  it('ignores non-numeric junk (keeps defaults)', () => {
    const cfg = resolveCreditConfig({ maxBillingCycleDays: 'nope', weights: { cost: 'bad' } });
    expect(cfg.maxBillingCycleDays).toBe(CREDIT_BUDGETS.maxBillingCycleDays);
    expect(cfg.weights.cost).toBe(CREDIT_BUDGETS.weights.cost);
  });
});

describe('remainingCredits', () => {
  const scope = (resetUsed: number, resetAllow: number, billUsed: number, billAllow: number): CreditScope => ({
    billing: { label: 'this month', used: billUsed, allowance: billAllow, resetsAt: null, rows: [] },
    reset: { label: 'today', used: resetUsed, allowance: resetAllow, resetsAt: null },
  });

  it('returns remaining in both cycles', () => {
    expect(remainingCredits(scope(200, 1_000, 3_000, 10_000))).toEqual({ reset: 800, billing: 7_000 });
  });

  it('floors an over-limit window at 0 (never negative)', () => {
    expect(remainingCredits(scope(1_200, 1_000, 3_000, 10_000))).toEqual({ reset: 0, billing: 7_000 });
  });

  it('remainingInWindow computes allowance - used floored at 0', () => {
    expect(remainingInWindow({ label: 't', used: 40, allowance: 100, resetsAt: null })).toBe(60);
    expect(remainingInWindow({ label: 't', used: 150, allowance: 100, resetsAt: null })).toBe(0);
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

  it('cycleNextResetSql builds the next calendar boundary', () => {
    expect(CYCLE_MODE).toBe('calendar');
    expect(cycleNextResetSql(parseBillingCycle('1d'))).toBe("date_trunc('day', NOW()) + INTERVAL '1 day'");
    expect(cycleNextResetSql(parseBillingCycle('1m'))).toBe("date_trunc('month', NOW()) + INTERVAL '1 month'");
  });
});
