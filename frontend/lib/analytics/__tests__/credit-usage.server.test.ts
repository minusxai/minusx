vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCreditUsage, checkCreditGate } from '@/lib/analytics/credit-usage.server';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import { getModules } from '@/lib/modules/registry';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import type { CreditBreakdownRow } from '@/lib/analytics/credits.types';

const TEST_DB_PATH = getTestDbPath('credit_usage');

interface SeedRow {
  userId: number;
  provider: string | null;
  model: string;
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
  cost: number;
  /** SQL expression for created_at, e.g. `NOW()` or `NOW() - INTERVAL '40 days'`. */
  createdAtSql: string;
  trigger?: string | null;
  mode?: string | null;
}

async function seed(row: SeedRow): Promise<void> {
  await getModules().db.exec(
    `INSERT INTO llm_call_events
       (conversation_id, model, provider, prompt_tokens, cached_tokens, completion_tokens, cost, user_id, trigger, mode, created_at)
     VALUES (0, $1, $2, $3, $4, $5, $6, $7, $8, $9, ${row.createdAtSql})`,
    [row.model, row.provider, row.promptTokens, row.cachedTokens, row.completionTokens, row.cost, row.userId, row.trigger ?? null, row.mode ?? null],
  );
}

const findRow = (rows: CreditBreakdownRow[], provider: string, model: string) =>
  rows.find((r) => r.provider === provider && r.model === model);

describe('getCreditUsage', () => {
  setupTestDb(TEST_DB_PATH);

  beforeEach(async () => {
    // User 1 — two rows this month in the same (anthropic, opus) group
    await seed({ userId: 1, provider: 'anthropic', model: 'opus', promptTokens: 1000, cachedTokens: 200, completionTokens: 500, cost: 0.3, createdAtSql: 'NOW()' });
    await seed({ userId: 1, provider: 'anthropic', model: 'opus', promptTokens: 500, cachedTokens: 100, completionTokens: 200, cost: 0.1, createdAtSql: 'NOW()' });
    // User 1 — a different group this month
    await seed({ userId: 1, provider: 'openai', model: 'gpt', promptTokens: 100, cachedTokens: 0, completionTokens: 50, cost: 0.05, createdAtSql: 'NOW()' });
    // User 1 — LAST month, must be excluded (40 days back is always before start-of-month)
    await seed({ userId: 1, provider: 'anthropic', model: 'opus', promptTokens: 9999, cachedTokens: 0, completionTokens: 9999, cost: 99, createdAtSql: "NOW() - INTERVAL '40 days'" });
    // User 1 — cached > prompt (non-cached input must floor at 0)
    await seed({ userId: 1, provider: 'weird', model: 'm', promptTokens: 100, cachedTokens: 300, completionTokens: 10, cost: 0.02, createdAtSql: 'NOW()' });
    // User 1 — NULL provider (must group as '')
    await seed({ userId: 1, provider: null, model: 'nulltest', promptTokens: 50, cachedTokens: 0, completionTokens: 10, cost: 0.01, createdAtSql: 'NOW()' });
    // User 2 — this month, same (anthropic, opus) group as user 1
    await seed({ userId: 2, provider: 'anthropic', model: 'opus', promptTokens: 2000, cachedTokens: 0, completionTokens: 1000, cost: 1.0, createdAtSql: 'NOW()' });
  });

  it('aggregates the current-user scope for this month only', async () => {
    const { individual } = await getCreditUsage(1, 'viewer', false);

    // 4 groups: (anthropic,opus), (openai,gpt), (weird,m), ('',nulltest) — last-month row excluded.
    expect(individual.billing.rows).toHaveLength(4);
    expect(individual.billing.allowance).toBe(10_000);
    expect(individual.reset.allowance).toBe(1_000);

    // opus group merges the two this-month user-1 rows (last-month row NOT included).
    const opus = findRow(individual.billing.rows, 'anthropic', 'opus')!;
    expect(opus.nonCachedInputTokens).toBe(1200); // (1000-200) + (500-100)
    expect(opus.cachedTokens).toBe(300);
    expect(opus.outputTokens).toBe(700);
    expect(opus.requests).toBe(2); // two this-month opus calls merged
    expect(opus.credits).toBeCloseTo(400, 6); // (0.3 + 0.1) * 1000

    // Billing used = 400 + 50 + 20 + 10. Every seeded row is at NOW(), so the
    // reset window (today) captures the same total.
    expect(individual.billing.used).toBeCloseTo(480, 6);
    expect(individual.reset.used).toBeCloseTo(480, 6);

    // Calendar mode → each window reports when it next resets (a future instant).
    expect(individual.reset.resetsAt).toBeTruthy();
    expect(individual.billing.resetsAt).toBeTruthy();
    expect(new Date(individual.reset.resetsAt!).getTime()).toBeGreaterThan(Date.now());
  });

  it('floors non-cached input at 0 when cached exceeds prompt', async () => {
    const { individual } = await getCreditUsage(1, 'viewer', false);
    const weird = findRow(individual.billing.rows, 'weird', 'm')!;
    expect(weird.nonCachedInputTokens).toBe(0); // 100 - 300 floored to 0
    expect(weird.cachedTokens).toBe(300);
  });

  it("counts org + tutorial modes (incl. legacy null) but excludes 'internals'", async () => {
    await seed({ userId: 8, provider: 'openai', model: 'm', promptTokens: 10, cachedTokens: 0, completionTokens: 5, cost: 1.0, createdAtSql: 'NOW()', mode: 'org' });
    await seed({ userId: 8, provider: 'openai', model: 'm', promptTokens: 10, cachedTokens: 0, completionTokens: 5, cost: 1.0, createdAtSql: 'NOW()', mode: 'tutorial' });
    await seed({ userId: 8, provider: 'openai', model: 'm', promptTokens: 10, cachedTokens: 0, completionTokens: 5, cost: 1.0, createdAtSql: 'NOW()', mode: null }); // legacy → org
    await seed({ userId: 8, provider: 'openai', model: 'm', promptTokens: 10, cachedTokens: 0, completionTokens: 5, cost: 99.0, createdAtSql: 'NOW()', mode: 'internals' }); // excluded

    const { individual } = await getCreditUsage(8, 'viewer', false);
    // 3 counted rows (org + tutorial + null) at $1 each = 3000 credits; the $99 internals row is excluded.
    expect(individual.billing.used).toBeCloseTo(3000, 6);
  });

  it('reset usage is a subset of billing usage (reset window ⊆ billing window)', async () => {
    // An older row anchored to the start of the billing month: always inside the
    // billing window, and (except on the 1st) outside the daily reset window.
    await seed({ userId: 5, provider: 'openai', model: 'r', promptTokens: 10, cachedTokens: 0, completionTokens: 5, cost: 1.0, createdAtSql: "date_trunc('month', NOW()) + INTERVAL '1 second'" });
    // A row now: inside both windows.
    await seed({ userId: 5, provider: 'openai', model: 'r', promptTokens: 10, cachedTokens: 0, completionTokens: 5, cost: 0.5, createdAtSql: 'NOW()' });

    const { individual } = await getCreditUsage(5, 'viewer', false);
    expect(individual.billing.used).toBeCloseTo(1500, 6);            // both rows (1.0 + 0.5) * 1000
    expect(individual.reset.used).toBeLessThanOrEqual(individual.billing.used);
    expect(individual.reset.used).toBeGreaterThanOrEqual(500 - 1e-6); // at least the NOW() row
  });

  it('normalizes a NULL provider to an empty string', async () => {
    const { individual } = await getCreditUsage(1, 'viewer', false);
    const nullRow = findRow(individual.billing.rows, '', 'nulltest')!;
    expect(nullRow).toBeDefined();
    expect(nullRow.credits).toBeCloseTo(10, 6);
  });

  it('splits the same provider+model into separate rows by trigger', async () => {
    // Same (openai, gpt) but two surfaces → two distinct breakdown rows.
    await seed({ userId: 1, provider: 'openai', model: 'gpt', promptTokens: 10, cachedTokens: 0, completionTokens: 5, cost: 0.02, createdAtSql: 'NOW()', trigger: 'explore' });
    await seed({ userId: 1, provider: 'openai', model: 'gpt', promptTokens: 10, cachedTokens: 0, completionTokens: 5, cost: 0.03, createdAtSql: 'NOW()', trigger: 'slack' });

    const { individual } = await getCreditUsage(1, 'viewer', false);
    const gptRows = individual.billing.rows.filter((r) => r.provider === 'openai' && r.model === 'gpt');
    const byTrigger = Object.fromEntries(gptRows.map((r) => [r.trigger, r]));

    // 'unknown' (the beforeEach openai/gpt row, no trigger → normalized), 'explore', and 'slack'
    expect(byTrigger['explore']).toBeDefined();
    expect(byTrigger['slack']).toBeDefined();
    expect(byTrigger['unknown']).toBeDefined();
    expect(byTrigger['']).toBeUndefined(); // never empty
    expect(byTrigger['explore'].credits).toBeCloseTo(20, 6); // 0.02 * 1000
    expect(byTrigger['slack'].credits).toBeCloseTo(30, 6); // 0.03 * 1000
  });

  it('checkCreditGate allows everything when enforcement is off (default env)', async () => {
    // Huge usage, but ENFORCE_CREDIT_LIMITS is unset in the test env → always allowed.
    await seed({ userId: 9, provider: 'openai', model: 'm', promptTokens: 10, cachedTokens: 0, completionTokens: 5, cost: 9999, createdAtSql: 'NOW()' });
    const gate = await checkCreditGate({ userId: 9, role: 'viewer', mode: 'org', email: 'x@x.co' } as EffectiveUser);
    expect(gate.allowed).toBe(true);
    expect(gate.exceeded).toBeNull();
  });

  it('returns org=null when includeOrg is false', async () => {
    const { org } = await getCreditUsage(1, 'viewer', false);
    expect(org).toBeNull();
  });

  it('aggregates all users for the org scope when includeOrg is true', async () => {
    const { individual, org } = await getCreditUsage(1, 'admin', true);
    expect(org).not.toBeNull();
    expect(org!.billing.allowance).toBe(100_000);
    expect(org!.reset.allowance).toBe(10_000);

    // org opus group = user1 (0.40) + user2 (1.00) = 1.40 → 1400 credits
    const opus = findRow(org!.billing.rows, 'anthropic', 'opus')!;
    expect(opus.credits).toBeCloseTo(1400, 6);
    expect(opus.outputTokens).toBe(700 + 1000);

    // org used = individual (480) + user2 (1000)
    expect(org!.billing.used).toBeCloseTo(1480, 6);

    // user 2's usage is absent from the individual scope
    expect(individual.billing.used).toBeCloseTo(480, 6);
  });
});
