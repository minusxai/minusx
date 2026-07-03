vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCreditUsage } from '@/lib/analytics/credit-usage.server';
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
}

async function seed(row: SeedRow): Promise<void> {
  await getModules().db.exec(
    `INSERT INTO llm_call_events
       (conversation_id, model, provider, prompt_tokens, cached_tokens, completion_tokens, cost, user_id, created_at)
     VALUES (0, $1, $2, $3, $4, $5, $6, $7, ${row.createdAtSql})`,
    [row.model, row.provider, row.promptTokens, row.cachedTokens, row.completionTokens, row.cost, row.userId],
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
    expect(individual.rows).toHaveLength(4);
    expect(individual.allowance).toBe(10_000);

    // opus group merges the two this-month user-1 rows (last-month row NOT included).
    const opus = findRow(individual.rows, 'anthropic', 'opus')!;
    expect(opus.nonCachedInputTokens).toBe(1200); // (1000-200) + (500-100)
    expect(opus.cachedTokens).toBe(300);
    expect(opus.outputTokens).toBe(700);
    expect(opus.credits).toBeCloseTo(40, 6); // (0.3 + 0.1) * 100

    // Individual used = 40 + 5 + 2 + 1
    expect(individual.used).toBeCloseTo(48, 6);
  });

  it('floors non-cached input at 0 when cached exceeds prompt', async () => {
    const { individual } = await getCreditUsage(1, 'viewer', false);
    const weird = findRow(individual.rows, 'weird', 'm')!;
    expect(weird.nonCachedInputTokens).toBe(0); // 100 - 300 floored to 0
    expect(weird.cachedTokens).toBe(300);
  });

  it('normalizes a NULL provider to an empty string', async () => {
    const { individual } = await getCreditUsage(1, 'viewer', false);
    const nullRow = findRow(individual.rows, '', 'nulltest')!;
    expect(nullRow).toBeDefined();
    expect(nullRow.credits).toBeCloseTo(1, 6);
  });

  it('returns org=null when includeOrg is false', async () => {
    const { org } = await getCreditUsage(1, 'viewer', false);
    expect(org).toBeNull();
  });

  it('aggregates all users for the org scope when includeOrg is true', async () => {
    const { individual, org } = await getCreditUsage(1, 'admin', true);
    expect(org).not.toBeNull();
    expect(org!.allowance).toBe(100_000);

    // org opus group = user1 (0.40) + user2 (1.00) = 1.40 → 140 credits
    const opus = findRow(org!.rows, 'anthropic', 'opus')!;
    expect(opus.credits).toBeCloseTo(140, 6);
    expect(opus.outputTokens).toBe(700 + 1000);

    // org used = individual (48) + user2 (100)
    expect(org!.used).toBeCloseTo(148, 6);

    // user 2's usage is absent from the individual scope
    expect(individual.used).toBeCloseTo(48, 6);
  });
});
