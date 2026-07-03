/**
 * CREDIT BUDGETS — one place for every tuning knob for the credits / billing
 * module (mirrors `lib/context/context-budgets.ts`). Only the numbers/defaults
 * live here; env overrides are wired in `lib/config.ts` (server-only), and the
 * aggregation logic lives in `lib/analytics/credit-usage.server.ts`.
 *
 * Two DECOUPLED rolling windows per scope:
 *   - billing cycle — the longer window (e.g. monthly, 10k limit)
 *   - reset cycle   — a shorter window (e.g. daily/weekly, 1k limit)
 * The reset cycle should be ⊆ the billing cycle.
 *
 * Client-safe (plain constants, no `server-only`) — imported by the server
 * aggregation, `config.ts`, `costToCredits`, and tests.
 */
export const CREDIT_BUDGETS = {
  /** Credits per USD of LLM cost. v0: 1 credit = $0.001 → 1000. */
  creditsPerDollar: 1000,

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

  /** Upper bound on any cycle window IN DAYS — clamps CREDIT_BILLING_CYCLE / CREDIT_RESET_CYCLE. */
  maxBillingCycleDays: 366,
} as const;

/** Approximate days per unit (weeks/months are rolling approximations). */
const UNIT_DAYS: Record<string, number> = { d: 1, w: 7, m: 30 };
const UNIT_WORD: Record<string, string> = { d: 'day', w: 'week', m: 'month' };

export interface BillingCycle {
  /** Normalized spec actually used, e.g. '1m'. */
  raw: string;
  /** Rolling window length in DAYS (clamped to `maxBillingCycleDays`). */
  days: number;
  /** Human label for the card, e.g. 'last month', 'last 7 days'. */
  label: string;
}

/**
 * Parse a rolling cycle spec `<N><unit>` (unit d|w|m; e.g. '1d', '2w', '1m',
 * '3m') into a day window. Weeks/months are approximated in days (w=7, m=30).
 * Bad/empty specs fall back to `fallback`; the window is clamped to
 * `maxBillingCycleDays`.
 */
export function parseBillingCycle(raw?: string | null, fallback: string = CREDIT_BUDGETS.defaultBillingCycle): BillingCycle {
  const spec = (raw && raw.trim() ? raw : fallback).trim().toLowerCase();
  const valid = /^(\d+)([dwm])$/.test(spec) && parseInt(spec, 10) > 0;
  const usedRaw = valid ? spec : fallback.trim().toLowerCase();
  const m = /^(\d+)([dwm])$/.exec(usedRaw)!;
  const n = parseInt(m[1], 10);
  const unit = m[2];
  const days = Math.min(n * UNIT_DAYS[unit], CREDIT_BUDGETS.maxBillingCycleDays);
  const word = UNIT_WORD[unit];
  const label = n === 1 ? `last ${word}` : `last ${n} ${word}s`;
  return { raw: usedRaw, days, label };
}
