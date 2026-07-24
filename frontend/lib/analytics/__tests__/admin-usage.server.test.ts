vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAdminUsageBreakdown, type UsageBreakdownEntry } from '@/lib/analytics/admin-usage.server';
import { getModules } from '@/lib/modules/registry';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';

const TEST_DB_PATH = getTestDbPath('admin_usage');

interface SeedRow {
  userId: number;
  provider: string;
  model: string;
  grade: string;
  agent: string;
  cost: number;
  completionTokens?: number;
  createdAtSql?: string;
  mode?: string | null;
}

async function seedEvent(r: SeedRow): Promise<void> {
  await getModules().db.exec(
    `INSERT INTO llm_call_events
       (conversation_id, model, provider, grade, agent, prompt_tokens, cached_tokens, completion_tokens, cost, user_id, mode, created_at)
     VALUES (0, $1, $2, $3, $4, 0, 0, $5, $6, $7, $8, ${r.createdAtSql ?? 'NOW()'})`,
    [r.model, r.provider, r.grade, r.agent, r.completionTokens ?? 0, r.cost, r.userId, r.mode ?? 'org'],
  );
}

async function seedUser(id: number, email: string, role: string): Promise<void> {
  await getModules().db.exec(
    `INSERT INTO users (id, email, name, role) VALUES ($1, $2, $2, $3) ON CONFLICT (id) DO NOTHING`,
    [id, email, role],
  );
}

const byKey = (rows: UsageBreakdownEntry[], key: string) => rows.find((r) => r.key === key);

describe('getAdminUsageBreakdown', () => {
  setupTestDb(TEST_DB_PATH);

  beforeEach(async () => {
    await seedUser(90001, 'admin@x.co', 'admin');
    await seedUser(90002, 'viewer@x.co', 'viewer');
    // admin@x.co: openai/core/analyst + openai/lite/micro
    await seedEvent({ userId: 90001, provider: 'openai', model: 'gpt-a', grade: 'core', agent: 'analyst', cost: 0.50 });
    await seedEvent({ userId: 90001, provider: 'openai', model: 'gpt-mini', grade: 'lite', agent: 'micro', cost: 0.10 });
    // viewer@x.co: anthropic/advanced/web-analyst
    await seedEvent({ userId: 90002, provider: 'anthropic', model: 'opus', grade: 'advanced', agent: 'web-analyst', cost: 1.00 });
    // internals mode row — must be excluded from user-facing totals
    await seedEvent({ userId: 90001, provider: 'openai', model: 'gpt-a', grade: 'core', agent: 'analyst', cost: 99, mode: 'internals' });
    // last-month row — excluded from the billing window
    await seedEvent({ userId: 90002, provider: 'anthropic', model: 'opus', grade: 'advanced', agent: 'web-analyst', cost: 88, createdAtSql: "NOW() - INTERVAL '40 days'" });
  });

  it('slices usage by grade / provider / agent (the Models-page axes)', async () => {
    const b = await getAdminUsageBreakdown();
    expect(byKey(b.byGrade, 'core')?.cost).toBeCloseTo(0.50, 6);
    expect(byKey(b.byGrade, 'lite')?.cost).toBeCloseTo(0.10, 6);
    expect(byKey(b.byGrade, 'advanced')?.cost).toBeCloseTo(1.00, 6);
    expect(byKey(b.byProvider, 'openai')?.cost).toBeCloseTo(0.60, 6);
    expect(byKey(b.byProvider, 'anthropic')?.cost).toBeCloseTo(1.00, 6);
    expect(byKey(b.byAgent, 'analyst')?.requests).toBe(1);
    expect(byKey(b.byAgent, 'web-analyst')?.requests).toBe(1);
  });

  it('slices by user and role via the users join', async () => {
    const b = await getAdminUsageBreakdown();
    expect(byKey(b.byUser, 'admin@x.co')?.cost).toBeCloseTo(0.60, 6);
    expect(byKey(b.byUser, 'viewer@x.co')?.cost).toBeCloseTo(1.00, 6);
    expect(byKey(b.byRole, 'admin')?.cost).toBeCloseTo(0.60, 6);
    expect(byKey(b.byRole, 'viewer')?.cost).toBeCloseTo(1.00, 6);
    expect(b.activeUsers).toBe(2);
  });

  it('excludes internals mode and out-of-window rows from totals', async () => {
    const b = await getAdminUsageBreakdown();
    // Only the 3 in-window, user-facing rows: 0.50 + 0.10 + 1.00 = 1.60 in cost.
    const totalCost = b.byProvider.reduce((s, r) => s + r.cost, 0);
    expect(totalCost).toBeCloseTo(1.60, 6);
    expect(b.totalRequests).toBe(3);
    expect(b.byGrade.some((r) => r.cost > 50)).toBe(false); // the 99 internals + 88 old row are gone
  });

  it('is sorted by credits descending within each dimension', async () => {
    const b = await getAdminUsageBreakdown();
    for (let i = 1; i < b.byGrade.length; i++) {
      expect(b.byGrade[i - 1].credits).toBeGreaterThanOrEqual(b.byGrade[i].credits);
    }
  });

  it('returns a per-day timeseries covering today', async () => {
    const b = await getAdminUsageBreakdown();
    expect(b.overTime.length).toBeGreaterThanOrEqual(1);
    expect(b.totalCredits).toBeGreaterThan(0);
  });
});
