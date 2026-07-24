import { describe, it, expect } from 'vitest';
import {
  resolveCreditPolicy, resolveOrgCreditPolicy, resolveResetSchedule,
  DEFAULT_DAILY_LIMIT, DEFAULT_WEEKLY_LIMIT,
  DEFAULT_DAILY_RESET_CRON, DEFAULT_WEEKLY_RESET_CRON, DEFAULT_RESET_TIMEZONE,
  type CreditsConfig,
} from '@/lib/analytics/credit-policy';

describe('resolveCreditPolicy', () => {
  it('falls back to built-in defaults when nothing is configured', () => {
    const p = resolveCreditPolicy(undefined, { role: 'viewer', userId: 1 });
    expect(p.enabled).toBe(false);
    expect(p.daily).toEqual({ cycle: '1d', limit: DEFAULT_DAILY_LIMIT });
    expect(p.weekly).toEqual({ cycle: '1w', limit: DEFAULT_WEEKLY_LIMIT });
    expect(p.weights.cost).toBe(100); // 1 credit per $0.01
  });

  it('resolves limits by specificity: user > role > company > default', () => {
    const cfg: CreditsConfig = {
      enabled: true,
      limits: {
        company: { daily: 100, weekly: 500 },
        roles: { viewer: { daily: 50 }, admin: { daily: 999, weekly: 9999 } },
        users: { '7': { daily: 10 }, 'vip@x.co': { weekly: 42 } },
      },
    };
    // user 7 → user daily wins (10); weekly not set for user → role viewer has no weekly → company 500
    expect(resolveCreditPolicy(cfg, { role: 'viewer', userId: 7 }).daily.limit).toBe(10);
    expect(resolveCreditPolicy(cfg, { role: 'viewer', userId: 7 }).weekly.limit).toBe(500);
    // role viewer daily (50) when no per-user override; weekly → company 500
    expect(resolveCreditPolicy(cfg, { role: 'viewer', userId: 8 }).daily.limit).toBe(50);
    // admin role both set
    const admin = resolveCreditPolicy(cfg, { role: 'admin', userId: 9 });
    expect(admin.daily.limit).toBe(999);
    expect(admin.weekly.limit).toBe(9999);
    // by email key
    expect(resolveCreditPolicy(cfg, { role: 'viewer', email: 'vip@x.co' }).weekly.limit).toBe(42);
    expect(p_enabled(cfg)).toBe(true);
  });

  it('honors custom weights and cycles', () => {
    const cfg: CreditsConfig = { weights: { cost: 200 }, dailyCycle: '1d', weeklyCycle: '2w' };
    const p = resolveCreditPolicy(cfg, { role: 'viewer' });
    expect(p.weights.cost).toBe(200);
    expect(p.weekly.cycle).toBe('2w');
  });
});

describe('resolveResetSchedule', () => {
  it('defaults to LA-time 11:59 PM daily and Sunday 11:59 PM weekly', () => {
    expect(resolveResetSchedule(undefined)).toEqual({
      dailyCron: DEFAULT_DAILY_RESET_CRON, weeklyCron: DEFAULT_WEEKLY_RESET_CRON, timeZone: DEFAULT_RESET_TIMEZONE,
    });
    expect(DEFAULT_DAILY_RESET_CRON).toBe('59 23 * * *');
    expect(DEFAULT_WEEKLY_RESET_CRON).toBe('59 23 * * 0');
    expect(DEFAULT_RESET_TIMEZONE).toBe('America/Los_Angeles');
  });

  it('honors valid overrides', () => {
    expect(resolveResetSchedule({ dailyResetCron: '0 6 * * *', weeklyResetCron: '0 6 * * 1', resetTimeZone: 'UTC' }))
      .toEqual({ dailyCron: '0 6 * * *', weeklyCron: '0 6 * * 1', timeZone: 'UTC' });
  });

  it('falls back to defaults on invalid cron', () => {
    const s = resolveResetSchedule({ dailyResetCron: 'not a cron', weeklyResetCron: '1 2 3' /* 3 fields */ });
    expect(s.dailyCron).toBe(DEFAULT_DAILY_RESET_CRON);
    expect(s.weeklyCron).toBe(DEFAULT_WEEKLY_RESET_CRON);
  });
});

describe('resolveOrgCreditPolicy', () => {
  it('uses company limits (or defaults)', () => {
    expect(resolveOrgCreditPolicy({ limits: { company: { daily: 1234, weekly: 5678 } } }))
      .toEqual({ daily: { cycle: '1d', limit: 1234 }, weekly: { cycle: '1w', limit: 5678 } });
    expect(resolveOrgCreditPolicy(undefined).weekly.limit).toBe(DEFAULT_WEEKLY_LIMIT);
  });
});

function p_enabled(cfg: CreditsConfig): boolean {
  return resolveCreditPolicy(cfg, { role: 'viewer' }).enabled;
}
