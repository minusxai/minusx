/**
 * Tests for POST /api/chat/feedback
 *
 * Covers:
 *  1. Validation — rejects malformed bodies (missing fields, wrong types, bad rating)
 *  2. Happy path — valid feedback publishes AppEvents.FEEDBACK with correct payload
 *  3. Optional comment — omitted comment defaults to ''
 */

vi.mock('server-only', () => ({}));

// Stub withAuth to pass a fixed user through.
const MOCK_USER = {
  userId: 42,
  email: 'tester@example.com',
  name: 'Tester',
  role: 'admin',
  home_folder: '/org',
  mode: 'org' as const,
};
vi.mock('@/lib/api/with-auth', () => ({
  withAuth: (handler: (req: any, user: any) => Promise<any>) =>
    async (request: any) => handler(request, MOCK_USER),
}));

// Capture published events instead of hitting real analytics/notifier.
const publishSpy = vi.fn();
vi.mock('@/lib/app-event-registry', () => ({
  appEventRegistry: { publish: (...args: any[]) => publishSpy(...args) },
  AppEvents: { FEEDBACK: 'user:feedback' },
}));

import { NextRequest } from 'next/server';
import { POST } from '../feedback/route';

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/chat/feedback', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/chat/feedback', () => {
  beforeEach(() => {
    publishSpy.mockClear();
  });

  // ── Validation ────────────────────────────────────────────────────────────

  it.each([
    ['empty object', {}],
    ['missing conversationId', { userMessageLogIndex: 0, rating: 'positive', tags: [] }],
    ['missing rating', { conversationId: 1, userMessageLogIndex: 0, tags: [] }],
    ['invalid rating value', { conversationId: 1, userMessageLogIndex: 0, rating: 'meh', tags: [] }],
    ['tags not an array', { conversationId: 1, userMessageLogIndex: 0, rating: 'positive', tags: 'oops' }],
    ['tags with non-string element', { conversationId: 1, userMessageLogIndex: 0, rating: 'negative', tags: [1] }],
    ['conversationId is string', { conversationId: '1', userMessageLogIndex: 0, rating: 'positive', tags: [] }],
    ['comment is number', { conversationId: 1, userMessageLogIndex: 0, rating: 'positive', tags: [], comment: 123 }],
  ])('returns 400 for %s', async (_label, body) => {
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(publishSpy).not.toHaveBeenCalled();
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it('returns 200 and publishes FEEDBACK event for valid positive feedback', async () => {
    const body = {
      conversationId: 10,
      userMessageLogIndex: 3,
      rating: 'positive' as const,
      tags: ['Accurate', 'Fast'],
      comment: 'Great answer!',
    };
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });

    expect(publishSpy).toHaveBeenCalledOnce();
    expect(publishSpy).toHaveBeenCalledWith('user:feedback', {
      conversationId: 10,
      userMessageLogIndex: 3,
      rating: 'positive',
      tags: ['Accurate', 'Fast'],
      comment: 'Great answer!',
      mode: 'org',
      userId: 42,
      userEmail: 'tester@example.com',
    });
  });

  it('returns 200 for valid negative feedback with empty tags', async () => {
    const body = {
      conversationId: 5,
      userMessageLogIndex: 1,
      rating: 'negative' as const,
      tags: [],
    };
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(200);

    expect(publishSpy).toHaveBeenCalledOnce();
    // comment omitted → defaults to ''
    expect(publishSpy.mock.calls[0][1]).toMatchObject({
      conversationId: 5,
      rating: 'negative',
      comment: '',
    });
  });
});
