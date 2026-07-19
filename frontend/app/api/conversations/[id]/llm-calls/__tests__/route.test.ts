// GET /api/conversations/[id]/llm-calls — the /debug visualization's batch
// data source: every recorded LLM call of one conversation (stats + raw
// request blob) plus per-model catalog rates. Admin only.

vi.mock('@/lib/auth/auth-helpers', () => ({ getEffectiveUser: vi.fn() }));

import { describe, it, expect, vi, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/conversations/[id]/llm-calls/route';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { recordLlmCallEvent, recordLlmRequest } from '@/lib/analytics/file-analytics.db';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';

const TEST_DB_PATH = getTestDbPath('llm_calls_route');

const get = (id: string) =>
  GET(new NextRequest(`http://localhost/api/conversations/${id}/llm-calls`), {
    params: Promise.resolve({ id }),
  });

describe('GET /api/conversations/[id]/llm-calls', () => {
  setupTestDb(TEST_DB_PATH);

  it('returns calls in order with rates for the models seen (admin)', async () => {
    (getEffectiveUser as Mock).mockResolvedValue({ role: 'admin', userId: 1 });
    await recordLlmCallEvent({
      conversationId: 7, llmCallId: 'c1', model: 'claude-test', provider: 'anthropic',
      totalTokens: 10, promptTokens: 8, completionTokens: 2, cost: 0.01, durationS: 1,
    });
    await recordLlmRequest('c1', '{"messages":[]}');

    const res = await get('7');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.calls).toHaveLength(1);
    expect(body.calls[0].callId).toBe('c1');
    expect(body.calls[0].requestJson).toBe('{"messages":[]}');
    // Catalog is unavailable in tests → rates resolve to null (client falls
    // back to usage-derived rates).
    expect(body.rates).toHaveProperty('claude-test', null);
  });

  it('returns empty calls for a conversation with none', async () => {
    (getEffectiveUser as Mock).mockResolvedValue({ role: 'admin', userId: 1 });
    const body = await (await get('12345')).json();
    expect(body.calls).toEqual([]);
    expect(body.rates).toEqual({});
  });

  it('forbids non-admins', async () => {
    (getEffectiveUser as Mock).mockResolvedValue({ role: 'user', userId: 2 });
    expect((await get('7')).status).toBe(403);
  });

  it('rejects unauthenticated requests', async () => {
    (getEffectiveUser as Mock).mockResolvedValue(null);
    expect((await get('7')).status).toBe(403);
  });

  it('rejects a non-numeric conversation id', async () => {
    (getEffectiveUser as Mock).mockResolvedValue({ role: 'admin', userId: 1 });
    expect((await get('nope')).status).toBe(400);
  });
});
