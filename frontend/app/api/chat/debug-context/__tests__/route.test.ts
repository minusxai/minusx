// POST /api/chat/debug-context — the /debug visualization's "Projected" data
// source: the exact next-call Context (system prompt + projected messages +
// tool-definition size) from the same preview path /api/chat/context-size
// uses. Admin only (it exposes the raw system prompt).

vi.mock('@/lib/auth/auth-helpers', () => ({ getEffectiveUser: vi.fn() }));
vi.mock('@/lib/chat/orchestration-core.server', () => ({ previewNextChatContext: vi.fn() }));
vi.mock('@/lib/data/conversations.server', () => ({ getConversation: vi.fn() }));

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/chat/debug-context/route';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { previewNextChatContext } from '@/lib/chat/orchestration-core.server';
import { getConversation } from '@/lib/data/conversations.server';

const post = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/chat/debug-context', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  }));

describe('POST /api/chat/debug-context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getConversation as Mock).mockResolvedValue({ id: 5 });
    (previewNextChatContext as Mock).mockResolvedValue({
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'hi', timestamp: 1 }],
      tools: [{ name: 'T', description: 'd', parameters: { type: 'object' } }],
    });
  });

  it('returns the projected context for admins', async () => {
    (getEffectiveUser as Mock).mockResolvedValue({ role: 'admin', userId: 1 });
    const res = await post({ conversationID: 5, user_message: ' ' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.systemPrompt).toBe('sys');
    expect(body.messages).toHaveLength(1);
    expect(body.toolDefsChars).toBeGreaterThan(0);
  });

  it('401s when unauthenticated', async () => {
    (getEffectiveUser as Mock).mockResolvedValue(null);
    expect((await post({ conversationID: 5 })).status).toBe(401);
  });

  it('403s for non-admins', async () => {
    (getEffectiveUser as Mock).mockResolvedValue({ role: 'user', userId: 2 });
    expect((await post({ conversationID: 5 })).status).toBe(403);
  });

  it('400s without a conversationID', async () => {
    (getEffectiveUser as Mock).mockResolvedValue({ role: 'admin', userId: 1 });
    expect((await post({})).status).toBe(400);
  });

  it('400s for a missing conversation', async () => {
    (getEffectiveUser as Mock).mockResolvedValue({ role: 'admin', userId: 1 });
    (getConversation as Mock).mockResolvedValue(null);
    expect((await post({ conversationID: 5 })).status).toBe(400);
  });
});
