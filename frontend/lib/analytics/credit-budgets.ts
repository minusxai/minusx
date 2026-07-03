/**
 * CREDIT BUDGETS — one place for every tuning knob for the credits / billing
 * module (mirrors `lib/context/context-budgets.ts`). Only the numbers/defaults
 * live here; env overrides are wired in `lib/config.ts` (server-only), and the
 * aggregation logic lives in `lib/analytics/credit-usage.server.ts`.
 *
 * Two DECOUPLED windows per scope:
 *   - billing cycle — the longer window (e.g. monthly, 10k limit)
 *   - reset cycle   — a shorter window (e.g. daily/weekly, 1k limit)
 * The reset cycle should be ⊆ the billing cycle.
 *
 * Client-safe (plain constants, no `server-only`) — imported by the server
 * aggregation, `config.ts`, `costToCredits`, and tests.
 */
/**
 * Weights for the `costToCredits` formula — credits are a weighted sum of the
 * per-call cost + token buckets + request count:
 *   credits = cost·cost + nonCachedTokens·nonCachedTokens + cachedTokens·cachedTokens
 *           + outputTokens·outputTokens + requests·requests
 * v0 default: credits = cost × 1000 (1 credit = $0.001), everything else 0.
 */
export interface CreditWeights {
  /** Credits per $1 of USD cost. */
  cost: number;
  /** Credits per cached (read) input token. */
  cachedTokens: number;
  /** Credits per non-cached input token. */
  nonCachedTokens: number;
  /** Credits per output token. */
  outputTokens: number;
  /** Credits per LLM request (flat per-call charge). */
  requests: number;
}

/** All the credit knobs. Defaults live in CREDIT_BUDGETS; override via the CREDIT_CONFIG env JSON. */
export interface CreditConfig {
  weights: CreditWeights;
  defaultBillingCycle: string;
  defaultIndividualAllowance: number;
  defaultOrgAllowance: number;
  defaultResetCycle: string;
  defaultIndividualResetAllowance: number;
  defaultOrgResetAllowance: number;
  maxBillingCycleDays: number;
}

export const CREDIT_BUDGETS: CreditConfig = {
  /** costToCredits weights (see CreditWeights). */
  weights: { cost: 100, cachedTokens: 0, nonCachedTokens: 0, outputTokens: 0, requests: 1 },

  // ── Billing cycle (longer window) ──────────────────────────────────────────
  /** Default billing-cycle window `<N><unit>` (unit d|w|m). Override: CREDIT_BILLING_CYCLE. */
  defaultBillingCycle: '1m',
  /** Default per-user allowance for one billing cycle. Override per-role: CREDIT_ALLOWANCES. */
  defaultIndividualAllowance: 5_000,
  /** Default org-wide allowance (all users) for one billing cycle. */
  defaultOrgAllowance: 5_000,

  // ── Reset cycle (shorter window) ───────────────────────────────────────────
  /** Default reset-cycle window `<N><unit>`. Override: CREDIT_RESET_CYCLE. */
  defaultResetCycle: '1d',
  /** Default per-user allowance per reset cycle. Override per-role: CREDIT_RESET_ALLOWANCES. */
  defaultIndividualResetAllowance: 1_000,
  /** Default org-wide allowance per reset cycle. */
  defaultOrgResetAllowance: 1_000,

  /** Upper bound on the ROLLING window IN DAYS — clamps the rolling day count. */
  maxBillingCycleDays: 366,
};

/**
 * Deep-merge a partial override (parsed from the CREDIT_CONFIG env JSON) over the
 * CREDIT_BUDGETS defaults. Only known keys are taken, numeric fields coerced;
 * `weights` is merged field-by-field. Invalid input falls back to the defaults.
 */
export function resolveCreditConfig(override: unknown): CreditConfig {
  if (!override || typeof override !== 'object') return CREDIT_BUDGETS;
  const o = override as Record<string, unknown>;
  const num = (v: unknown, fallback: number): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const str = (v: unknown, fallback: string): string => (typeof v === 'string' && v.trim() ? v : fallback);
  const w = (o.weights && typeof o.weights === 'object' ? o.weights : {}) as Record<string, unknown>;
  const d = CREDIT_BUDGETS;
  return {
    weights: {
      cost: num(w.cost, d.weights.cost),
      cachedTokens: num(w.cachedTokens, d.weights.cachedTokens),
      nonCachedTokens: num(w.nonCachedTokens, d.weights.nonCachedTokens),
      outputTokens: num(w.outputTokens, d.weights.outputTokens),
      requests: num(w.requests, d.weights.requests),
    },
    defaultBillingCycle: str(o.defaultBillingCycle, d.defaultBillingCycle),
    defaultIndividualAllowance: num(o.defaultIndividualAllowance, d.defaultIndividualAllowance),
    defaultOrgAllowance: num(o.defaultOrgAllowance, d.defaultOrgAllowance),
    defaultResetCycle: str(o.defaultResetCycle, d.defaultResetCycle),
    defaultIndividualResetAllowance: num(o.defaultIndividualResetAllowance, d.defaultIndividualResetAllowance),
    defaultOrgResetAllowance: num(o.defaultOrgResetAllowance, d.defaultOrgResetAllowance),
    maxBillingCycleDays: num(o.maxBillingCycleDays, d.maxBillingCycleDays),
  };
}

/**
 * How a cycle's window boundary is computed (flip this arg to change behavior):
 *   - 'calendar' → aligned to day/week/month boundaries. '1d' = today,
 *                  '1w' = this week, '1m' = this month.
 *   - 'rolling'  → the last N days from now. '1d' = last 24h, '1m' = last 30d.
 */
export const CYCLE_MODE: 'calendar' | 'rolling' = 'calendar';

/** Approximate days per unit (used for the rolling-window length). */
const UNIT_DAYS: Record<string, number> = { d: 1, w: 7, m: 30 };
const UNIT_WORD: Record<string, string> = { d: 'day', w: 'week', m: 'month' };

export type CycleUnit = 'd' | 'w' | 'm';

export interface BillingCycle {
  /** Normalized spec actually used, e.g. '1m'. */
  raw: string;
  /** Multiplier, e.g. 3 in '3m'. */
  n: number;
  /** Unit d|w|m. */
  unit: CycleUnit;
  /** Rolling window length in DAYS (clamped to `maxBillingCycleDays`). */
  days: number;
  /** Human label for the card, honoring CYCLE_MODE, e.g. 'this month' / 'last 7 days'. */
  label: string;
}

function cycleLabel(n: number, unit: CycleUnit): string {
  const word = UNIT_WORD[unit];
  if (CYCLE_MODE === 'calendar' && n === 1) return unit === 'd' ? 'today' : `this ${word}`;
  return n === 1 ? `last ${word}` : `last ${n} ${word}s`;
}

/**
 * Parse a cycle spec `<N><unit>` (unit d|w|m; e.g. '1d', '2w', '1m', '3m').
 * Bad/empty specs fall back to `fallback`; the rolling day length is clamped to
 * `maxBillingCycleDays`.
 */
export function parseBillingCycle(
  raw?: string | null,
  fallback: string = CREDIT_BUDGETS.defaultBillingCycle,
  maxDays: number = CREDIT_BUDGETS.maxBillingCycleDays,
): BillingCycle {
  const spec = (raw && raw.trim() ? raw : fallback).trim().toLowerCase();
  const valid = /^(\d+)([dwm])$/.test(spec) && parseInt(spec, 10) > 0;
  const usedRaw = valid ? spec : fallback.trim().toLowerCase();
  const m = /^(\d+)([dwm])$/.exec(usedRaw)!;
  const n = parseInt(m[1], 10);
  const unit = m[2] as CycleUnit;
  const days = Math.min(n * UNIT_DAYS[unit], maxDays);
  return { raw: usedRaw, n, unit, days, label: cycleLabel(n, unit) };
}

/**
 * SQL expression for the START of the current window, honoring CYCLE_MODE.
 * Safe to interpolate: values come from a strict parse (integer `n`/`days`,
 * whitelisted unit word) — never raw user input.
 */
export function cycleStartSql(cycle: BillingCycle): string {
  if (CYCLE_MODE === 'rolling') return `NOW() - INTERVAL '${cycle.days} days'`;
  const word = UNIT_WORD[cycle.unit];
  const base = `date_trunc('${word}', NOW())`;
  return cycle.n > 1 ? `${base} - INTERVAL '${cycle.n - 1} ${word}'` : base;
}

/**
 * SQL expression for WHEN the current window next resets (the next calendar
 * boundary). Returns `NULL` in rolling mode (a rolling window never resets — it
 * slides continuously). Safe to interpolate (whitelisted unit word only).
 */
export function cycleNextResetSql(cycle: BillingCycle): string {
  if (CYCLE_MODE === 'rolling') return 'NULL';
  const word = UNIT_WORD[cycle.unit];
  return `date_trunc('${word}', NOW()) + INTERVAL '1 ${word}'`;
}
