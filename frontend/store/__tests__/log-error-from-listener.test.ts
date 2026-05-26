/**
 * Cycle 5: when chatListener encounters a transport failure (network error from
 * /api/chat), it fire-and-forget posts a structured error entry to
 * /api/chat/log-error so it lands on the conversation document and survives reload.
 *
 * Verified by intercepting the log-error POST and asserting the payload shape.
 */

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

import * as storeModule from '@/store/store';
import { makeStore } from '@/store/store';
import { createConversation } from '@/store/chatSlice';

describe('chatListener — transport error → POST /api/chat/log-error', () => {
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
      if (u.includes('/api/chat')) {
        // Simulate a real transport failure (the canonical "fetch failed" from prod).
        throw new TypeError('fetch failed (ECONNREFUSED)');
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    }) as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('posts to /api/chat/log-error with source:"transport" and the original error message', async () => {
    const CONV_ID = 12345;
    store.dispatch(createConversation({
      conversationID: CONV_ID,
      agent: 'WebAnalystAgent',
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
});
