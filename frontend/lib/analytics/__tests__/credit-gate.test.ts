// Enforcement ON: mock the org credit policy (getRawConfig) so limits are
// ENFORCED with a tiny daily cap (100 credits) and an effectively-unreachable
// weekly cap, then verify checkCreditGate blocks over-limit users. (The
// enforcement-OFF path is covered in credit-usage.server.test.ts.)

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));
vi.mock('@/lib/data/configs.server', () => ({
  getRawConfig: vi.fn(async () => ({
    credits: { enabled: true, limits: { company: { daily: 100, weekly: 100_000 } } },
  })),
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkCreditGate, creditEnforcer, CreditLimitError } from '@/lib/analytics/credit-usage.server';
import { getModules } from '@/lib/modules/registry';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

setupTestDb(getTestDbPath('credit_gate'));

const user = (userId: number) => ({ userId, role: 'viewer', mode: 'org', email: 'u@x.co' } as EffectiveUser);

async function seed(userId: number, cost: number): Promise<void> {
  await getModules().db.exec(
    `INSERT INTO llm_call_events (conversation_id, model, cost, user_id, mode, created_at)
     VALUES (0, 'm', $1, $2, 'org', NOW())`,
    [cost, userId],
  );
}

describe('checkCreditGate (enforced)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('allows a user under the reset allowance', async () => {
    await seed(1, 0.05); // 0.05*100 + 1 req = 6 credits < 100
    const gate = await checkCreditGate(user(1));
    expect(gate.allowed).toBe(true);
    expect(gate.exceeded).toBeNull();
  });

  it('blocks a user at/over the reset allowance', async () => {
    await seed(2, 1.2); // 1.2*100 + 1 req = 121 credits ≥ 100
    const gate = await checkCreditGate(user(2));
    expect(gate.allowed).toBe(false);
    expect(gate.exceeded).toBe('reset');
    expect(gate.message).toMatch(/credit limit reached/i);
  });

  it('scopes usage per user (another user over limit does not block this one)', async () => {
    await seed(3, 0.02); // this user: 0.02*100 + 1 = 3 credits (under)
    await seed(4, 5.0);  // other user: 501 credits (way over)
    expect((await checkCreditGate(user(3))).allowed).toBe(true);
    expect((await checkCreditGate(user(4))).allowed).toBe(false);
  });

  it('creditEnforcer (the beforeLlmCall hook) throws CreditLimitError when over', async () => {
    await seed(5, 2.0); // 2.0*100 + 1 req = 201 ≥ 100
    const enforce = creditEnforcer(user(5));
    await expect(enforce()).rejects.toBeInstanceOf(CreditLimitError);
  });

  it('creditEnforcer resolves (no throw) when under the limit', async () => {
    await seed(6, 0.03); // 0.03*100 + 1 = 4 < 100
    await expect(creditEnforcer(user(6))()).resolves.toBeUndefined();
  });
});
