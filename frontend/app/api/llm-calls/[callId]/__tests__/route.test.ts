// GET /api/llm-calls/[callId] — the debug UI's single-call data source: per-call
// stats plus the raw pi-format request/response blobs.
//
// Admin only, for the same reason as the sibling batch route
// (`/api/conversations/[id]/llm-calls`): the blobs carry the full system prompt
// and conversation content. This route shipped with NO authorization at all —
// middleware requires a session, so it was reachable by ANY logged-in role, and
// a call id is the only thing needed to read someone else's conversation.

vi.mock('@/lib/auth/auth-helpers', () => ({ getEffectiveUser: vi.fn() }));

import { describe, it, expect, vi, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/llm-calls/[callId]/route';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { recordLlmCallEvent, recordLlmRequest } from '@/lib/analytics/file-analytics.db';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';

const TEST_DB_PATH = getTestDbPath('llm_call_by_id_route');

const get = (callId: string) =>
  GET(new NextRequest(`http://localhost/api/llm-calls/${callId}`), {
    params: Promise.resolve({ callId }),
  });

async function seedCall(callId: string) {
  await recordLlmCallEvent({
    conversationId: 7, llmCallId: callId, model: 'claude-test', provider: 'anthropic',
    totalTokens: 10, promptTokens: 8, completionTokens: 2, cost: 0.01, durationS: 1,
  });
  await recordLlmRequest(callId, '{"messages":[{"role":"system","content":"SECRET PROMPT"}]}');
}

describe('GET /api/llm-calls/[callId]', () => {
  setupTestDb(TEST_DB_PATH);

  it('returns stats and raw blobs for an admin', async () => {
    (getEffectiveUser as Mock).mockResolvedValue({ role: 'admin', userId: 1 });
    await seedCall('call-admin');

    const res = await get('call-admin');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stats).toBeTruthy();
    expect(body.logs.request_json).toContain('SECRET PROMPT');
  });

  // The defect this file exists for: a viewer could read any call by id.
  it('forbids a non-admin', async () => {
    (getEffectiveUser as Mock).mockResolvedValue({ role: 'viewer', userId: 2 });
    await seedCall('call-viewer');

    const res = await get('call-viewer');
    expect(res.status).toBe(403);
    // The blob must not ride along with the rejection.
    expect(JSON.stringify(await res.json())).not.toContain('SECRET PROMPT');
  });

  it('forbids an editor', async () => {
    (getEffectiveUser as Mock).mockResolvedValue({ role: 'editor', userId: 3 });
    expect((await get('call-admin')).status).toBe(403);
  });

  it('forbids an unauthenticated caller', async () => {
    (getEffectiveUser as Mock).mockResolvedValue(null);
    expect((await get('call-admin')).status).toBe(403);
  });
});
