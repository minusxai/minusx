/**
 * CREDIT POLICY — the admin-configurable credit levers, resolved from the org
 * config document's `credits` section (NOT env vars anymore). Pure + client-safe
 * (no `server-only`): imported by the server aggregation/gate, the settings UI,
 * and tests. Defaults live in `credit-budgets.ts`.
 *
 * Two windows per user: DAILY and WEEKLY. Each window's limit resolves by
 * specificity — per-user → per-role → company-wide → built-in default — so an
 * admin can cap "the whole company", "all viewers", or "one user".
 */
import { type CreditWeights, CREDIT_BUDGETS } from './credit-budgets';

/** Per-window credit limits for one scope (a user, a role, or the company). */
export interface CreditScopeLimits {
  daily?: number;
  weekly?: number;
}

/** The `credits` section of the org config document (admin-editable). */
export interface CreditsConfig {
  /** Credits on: show the UI (Usage tab, /usage, sidebar), track usage, AND enforce
   *  limits (block over-limit users). Replaces CREDITS_ENABLED + ENFORCE_CREDIT_LIMITS. */
  enabled?: boolean;
  /** costToCredits weights; defaults to 1 credit per $0.01 (cost×100). */
  weights?: Partial<CreditWeights>;
  /** Cycle specs `<N><unit>` (d|w|m). Defaults: daily '1d', weekly '1w'. */
  dailyCycle?: string;
  weeklyCycle?: string;
  /** Auto-reset cron schedules (5-field), evaluated in `resetTimeZone`.
   *  Defaults: daily '59 23 * * *' (11:59 PM), weekly '59 23 * * 0' (Sun 11:59 PM). */
  dailyResetCron?: string;
  weeklyResetCron?: string;
  /** IANA timezone for the reset crons. Default 'America/Los_Angeles'. */
  resetTimeZone?: string;
  /** Limits by scope. Most specific wins: users → roles → company. */
  limits?: {
    company?: CreditScopeLimits;
    roles?: Record<string, CreditScopeLimits>;
    /** Keyed by user id (as string) or email. */
    users?: Record<string, CreditScopeLimits>;
  };
}

export interface ResolvedCreditWindow {
  cycle: string;
  limit: number;
}

export interface ResolvedCreditPolicy {
  enabled: boolean;
  weights: CreditWeights;
  daily: ResolvedCreditWindow;
  weekly: ResolvedCreditWindow;
}

/** Built-in default limits when nothing is configured. */
export const DEFAULT_DAILY_LIMIT = 1_000;
export const DEFAULT_WEEKLY_LIMIT = 5_000;

export interface CreditUserRef {
  role?: string;
  userId?: number;
  email?: string;
}

function pickLimit(cfg: CreditsConfig, user: CreditUserRef, win: 'daily' | 'weekly', dflt: number): number {
  const users = cfg.limits?.users;
  const byUser =
    (user.userId != null ? users?.[String(user.userId)] : undefined) ??
    (user.email ? users?.[user.email] : undefined);
  const byRole = user.role ? cfg.limits?.roles?.[user.role] : undefined;
  const byCompany = cfg.limits?.company;
  return byUser?.[win] ?? byRole?.[win] ?? byCompany?.[win] ?? dflt;
}

/** Resolve the effective policy for a specific user. */
export function resolveCreditPolicy(cfg: CreditsConfig | undefined, user: CreditUserRef): ResolvedCreditPolicy {
  const c = cfg ?? {};
  return {
    enabled: c.enabled ?? false,
    weights: { ...CREDIT_BUDGETS.weights, ...(c.weights ?? {}) },
    daily: { cycle: c.dailyCycle ?? '1d', limit: pickLimit(c, user, 'daily', DEFAULT_DAILY_LIMIT) },
    weekly: { cycle: c.weeklyCycle ?? '1w', limit: pickLimit(c, user, 'weekly', DEFAULT_WEEKLY_LIMIT) },
  };
}

export const DEFAULT_DAILY_RESET_CRON = '59 23 * * *';   // 11:59 PM
export const DEFAULT_WEEKLY_RESET_CRON = '59 23 * * 0';  // Sunday 11:59 PM
export const DEFAULT_RESET_TIMEZONE = 'America/Los_Angeles';

/** A 5-field cron with numeric/./,-/* fields — good enough to reject obvious garbage. */
function isValidCron(expr: unknown): expr is string {
  if (typeof expr !== 'string') return false;
  const parts = expr.trim().split(/\s+/);
  return parts.length === 5 && parts.every((p) => /^[\d*,\-/]+$/.test(p));
}

/** Resolve the auto-reset schedule (crons + timezone), falling back to LA-time defaults on invalid input. */
export function resolveResetSchedule(cfg: CreditsConfig | undefined): { dailyCron: string; weeklyCron: string; timeZone: string } {
  const c = cfg ?? {};
  return {
    dailyCron: isValidCron(c.dailyResetCron) ? c.dailyResetCron : DEFAULT_DAILY_RESET_CRON,
    weeklyCron: isValidCron(c.weeklyResetCron) ? c.weeklyResetCron : DEFAULT_WEEKLY_RESET_CRON,
    timeZone: typeof c.resetTimeZone === 'string' && c.resetTimeZone.trim() ? c.resetTimeZone : DEFAULT_RESET_TIMEZONE,
  };
}

/** Resolve the COMPANY-wide window limits (used for the org scope on the admin card). */
export function resolveOrgCreditPolicy(cfg: CreditsConfig | undefined): { daily: ResolvedCreditWindow; weekly: ResolvedCreditWindow } {
  const c = cfg ?? {};
  const co = c.limits?.company;
  return {
    daily: { cycle: c.dailyCycle ?? '1d', limit: co?.daily ?? DEFAULT_DAILY_LIMIT },
    weekly: { cycle: c.weeklyCycle ?? '1w', limit: co?.weekly ?? DEFAULT_WEEKLY_LIMIT },
  };
}
