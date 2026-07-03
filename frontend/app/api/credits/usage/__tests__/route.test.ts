// GET /api/credits/usage — current-month credit usage. Individual scope for the
// signed-in user; org totals additionally returned for admins. Aggregation logic
// is covered in lib/analytics/__tests__/credit-usage.server.test.ts.

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));
vi.mock('@/lib/auth/auth-helpers', () => ({ getEffectiveUser: vi.fn() }));

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { GET } from '@/app/api/credits/usage/route';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { getModules } from '@/lib/modules/registry';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { NextRequest } from 'next/server';
import type { CreditUsageResponse } from '@/lib/analytics/credits.types';

const TEST_DB_PATH = getTestDbPath('credits_usage_route');

async function seed(userId: number, cost: number): Promise<void> {
  await getModules().db.exec(
    `INSERT INTO llm_call_events
       (conversation_id, model, provider, prompt_tokens, cached_tokens, completion_tokens, cost, user_id, created_at)
     VALUES (0, 'opus', 'anthropic', 100, 0, 50, $1, $2, NOW())`,
    [cost, userId],
  );
}

const get = () => GET(new NextRequest('http://localhost/api/credits/usage'), undefined as never);

describe('GET /api/credits/usage', () => {
  setupTestDb(TEST_DB_PATH);

  beforeEach(async () => {
    await seed(1, 0.5); // signed-in user → 500 credits
    await seed(2, 1.0); // another user → 1000 credits (org only)
  });

  it('returns individual + org totals for an admin', async () => {
    (getEffectiveUser as Mock).mockResolvedValue({ userId: 1, role: 'admin', email: 'a@x.co', mode: 'org' });
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    const data = body.data as CreditUsageResponse;

    expect(data.enforced).toBe(false); // ENFORCE_CREDIT_LIMITS unset → not enforced
    expect(data.individual.billing.used).toBeCloseTo(500, 6);
    expect(data.individual.billing.allowance).toBe(10_000);
    expect(data.individual.reset.allowance).toBe(1_000);
    expect(data.org).not.toBeNull();
    expect(data.org!.billing.used).toBeCloseTo(1500, 6); // user1 (500) + user2 (1000)
    expect(data.org!.billing.allowance).toBe(100_000);
  });

  it('returns only the individual scope for a non-admin', async () => {
    (getEffectiveUser as Mock).mockResolvedValue({ userId: 1, role: 'viewer', email: 'v@x.co', mode: 'org' });
    const res = await get();
    expect(res.status).toBe(200);
    const data = (await res.json()).data as CreditUsageResponse;

    expect(data.individual.billing.used).toBeCloseTo(500, 6); // scoped to user 1 only
    expect(data.org).toBeNull();
  });

  it('401s when there is no session', async () => {
    (getEffectiveUser as Mock).mockResolvedValue(null);
    expect((await get()).status).toBe(401);
  });
});
