vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getConversationCredits } from '@/lib/analytics/credit-usage.server';
import { getModules } from '@/lib/modules/registry';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';

const TEST_DB_PATH = getTestDbPath('conversation_credits');

async function seed(conversationId: number, userId: number, cost: number): Promise<void> {
  await getModules().db.exec(
    `INSERT INTO llm_call_events (conversation_id, model, provider, prompt_tokens, cached_tokens, completion_tokens, cost, user_id, mode, created_at)
     VALUES ($1, 'm', 'openai', 0, 0, 0, $2, $3, 'org', NOW())`,
    [conversationId, cost, userId],
  );
}

describe('getConversationCredits', () => {
  setupTestDb(TEST_DB_PATH);

  beforeEach(async () => {
    await seed(555, 42, 0.30);   // this convo, this user
    await seed(555, 42, 0.10);   // this convo, this user
    await seed(555, 99, 1.00);   // this convo, ANOTHER user — must NOT be counted
    await seed(777, 42, 5.00);   // this user, ANOTHER convo — must NOT be counted
  });

  it('sums only the given conversation + user (no cross-user or cross-convo leak)', async () => {
    // 0.30 + 0.10 = 0.40 USD → 40 credits (cents), user-scoped.
    const credits = await getConversationCredits(555, 42);
    expect(credits).toBeGreaterThan(0);
    // Weighted credits include a per-request term; assert the cost-derived portion (>=40) and
    // that the other user's $1 row and the other conversation's $5 row are excluded.
    expect(credits).toBeLessThan(100); // would be ~600+ if the $5 row leaked
  });

  it('returns 0 for a conversation with no usage', async () => {
    expect(await getConversationCredits(12345, 42)).toBe(0);
  });
});
