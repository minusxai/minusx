/**
 * v3: when the chatListener encounters a transport / session failure while running a turn
 * (POST /api/conversations/:id/turns), it fire-and-forget posts a structured error entry to
 * /api/chat/log-error so it lands on the conversation's errors and survives reload.
 *
 * Verified by intercepting the log-error POST and asserting the payload shape.
 */

import * as storeModule from '@/store/store';
import { makeStore } from '@/store/store';
import { createConversation } from '@/store/chatSlice';

describe('client-side error reporters → POST /api/chat/log-error', () => {
  let store: ReturnType<typeof makeStore>;
  let capturedLogErrorBody: Record<string, any> | null;

  beforeEach(() => {
    capturedLogErrorBody = null;
    store = makeStore();
    vi.spyOn(storeModule, 'getStore').mockReturnValue(store);

    global.fetch = vi.fn(async (url: any, init?: any) => {
      const u = String(url);
      if (u.includes('/api/chat/log-error')) {
        capturedLogErrorBody = init?.body ? JSON.parse(init.body) : null;
        return { ok: true, status: 200, json: async () => ({ success: true }) } as Response;
      }
      if (/\/api\/conversations\/\d+\/turns/.test(u)) {
        // Simulate a real transport failure (the canonical "fetch failed" from prod).
        throw new TypeError('fetch failed (ECONNREFUSED)');
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    }) as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Cycle 7: 401 session expiry posts with source:"session" (not opaque "transport")', async () => {
    const CONV_ID = 22222;
    global.fetch = vi.fn(async (url: any, init?: any) => {
      const u = String(url);
      if (u.includes('/api/chat/log-error')) {
        capturedLogErrorBody = init?.body ? JSON.parse(init.body) : null;
        return { ok: true, status: 200, json: async () => ({ success: true }) } as Response;
      }
      if (/\/api\/conversations\/\d+\/turns/.test(u)) {
        // NextAuth 401 with a JSON body (the production shape from withAuth).
        return { ok: false, status: 401, json: async () => ({ error: 'unauthorized' }) } as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    }) as any;

    store.dispatch(createConversation({
      conversationID: CONV_ID,
      agent: 'WebAnalystAgent',
      version: 3,
      agent_args: { goal: 'do stuff' } as any,
      message: 'hello',
    }));

    await vi.waitFor(() => expect(capturedLogErrorBody).not.toBeNull(), { timeout: 5000, interval: 50 });
    expect(capturedLogErrorBody!.error).toMatchObject({ _type: 'error', source: 'session' });
    expect(capturedLogErrorBody!.error.details?.http_status).toBe(401);
  });

  it('posts to /api/chat/log-error with source:"transport" and the original error message', async () => {
    const CONV_ID = 12345;
    store.dispatch(createConversation({
      conversationID: CONV_ID,
      agent: 'WebAnalystAgent',
      version: 3,
      agent_args: { goal: 'do stuff' } as any,
      message: 'hello',
    }));

    await vi.waitFor(
      () => expect(capturedLogErrorBody).not.toBeNull(),
      { timeout: 5000, interval: 50 },
    );

    expect(capturedLogErrorBody!.conversationID).toBe(CONV_ID);
    expect(capturedLogErrorBody!.error).toMatchObject({
      _type: 'error',
      source: 'transport',
    });
    expect(String(capturedLogErrorBody!.error.message)).toMatch(/fetch failed/i);
    expect(typeof capturedLogErrorBody!.error.timestamp).toBe('number');
  });

  it('Cycle 9: logInitFailure posts to the active conversation when /api/conversations create has nowhere else to attach', async () => {
    const { logInitFailure } = await import('@/lib/messaging/report-client-error');

    // Seed an "active" conversation in the store (some prior chat the user has open).
    const ACTIVE_CONV = 7777;
    store.dispatch(createConversation({
      conversationID: ACTIVE_CONV,
      agent: 'WebAnalystAgent',
      agent_args: {} as any,
      // no message → no listener fire, conversation just sits as active
    }));

    logInitFailure('init endpoint returned 500', 500);

    await vi.waitFor(() => expect(capturedLogErrorBody).not.toBeNull(), { timeout: 5000, interval: 50 });
    expect(capturedLogErrorBody!.conversationID).toBe(ACTIVE_CONV);
    expect(capturedLogErrorBody!.error).toMatchObject({ _type: 'error', source: 'transport', message: 'init endpoint returned 500' });
    expect(capturedLogErrorBody!.error.details?.http_status).toBe(500);
  });

  it('Cycle 9: logInitFailure is a no-op when no active conversation exists (cold-start init failure)', async () => {
    const { logInitFailure } = await import('@/lib/messaging/report-client-error');
    // store has no active conversation
    logInitFailure('init endpoint returned 500', 500);
    // Wait a tick to be sure no post fires.
    await new Promise(r => setTimeout(r, 50));
    expect(capturedLogErrorBody).toBeNull();
  });
});
