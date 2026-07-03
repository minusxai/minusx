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
export const CREDIT_BUDGETS = {
  // ── Billing cycle (longer window) ──────────────────────────────────────────
  /** Default billing-cycle window `<N><unit>` (unit d|w|m). Override: CREDIT_BILLING_CYCLE. */
  defaultBillingCycle: '1m',
  /** Default per-user allowance for one billing cycle. Override per-role: CREDIT_ALLOWANCES. */
  defaultIndividualAllowance: 10_000,
  /** Default org-wide allowance (all users) for one billing cycle. */
  defaultOrgAllowance: 100_000,

  // ── Reset cycle (shorter window) ───────────────────────────────────────────
  /** Default reset-cycle window `<N><unit>`. Override: CREDIT_RESET_CYCLE. */
  defaultResetCycle: '1d',
  /** Default per-user allowance per reset cycle. Override per-role: CREDIT_RESET_ALLOWANCES. */
  defaultIndividualResetAllowance: 1_000,
  /** Default org-wide allowance per reset cycle. */
  defaultOrgResetAllowance: 10_000,

  /** Upper bound on the ROLLING window IN DAYS — clamps the rolling day count. */
  maxBillingCycleDays: 366,
} as const;

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
export function parseBillingCycle(raw?: string | null, fallback: string = CREDIT_BUDGETS.defaultBillingCycle): BillingCycle {
  const spec = (raw && raw.trim() ? raw : fallback).trim().toLowerCase();
  const valid = /^(\d+)([dwm])$/.test(spec) && parseInt(spec, 10) > 0;
  const usedRaw = valid ? spec : fallback.trim().toLowerCase();
  const m = /^(\d+)([dwm])$/.exec(usedRaw)!;
  const n = parseInt(m[1], 10);
  const unit = m[2] as CycleUnit;
  const days = Math.min(n * UNIT_DAYS[unit], CREDIT_BUDGETS.maxBillingCycleDays);
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
