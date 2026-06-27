// Unit test for the v3 streaming client's silent auto-retry loop. Mocks the POST /turns (fetch) and
// the GET /stream (XHR) so we can script a crash-interruption (retryable error) and assert the client
// re-issues the turn, bounded by MAX_CLIENT_AUTO_RETRIES.
import { runV3Turn } from '@/store/conversation-stream-client';
import type { ConversationStreamEvent } from '@/lib/data/conversations.types';

// Each entry is the SSE event list one GET /stream "open" will emit before onload.
let streamScript: ConversationStreamEvent[][] = [];
let streamOpens = 0;
let postCount = 0;
let lastPostBodies: Array<Record<string, unknown>> = [];

class FakeXHR {
  onprogress: (() => void) | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  responseText = '';
  open(): void {}
  setRequestHeader(): void {}
  abort(): void {}
  send(): void {
    const frames = streamScript[streamOpens] ?? [];
    streamOpens++;
    queueMicrotask(() => {
      this.responseText = frames.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
      this.onprogress?.();
      this.onload?.();
    });
  }
}

const cb = { onDelta: () => {}, onPending: () => {}, onMessageSeq: () => {} };

describe('runV3Turn — silent auto-retry on crash interruption', () => {
  beforeEach(() => {
    streamScript = [];
    streamOpens = 0;
    postCount = 0;
    lastPostBodies = [];
    (global as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXHR;
    global.fetch = (async (_url: string, init?: { body?: string }) => {
      postCount++;
      if (init?.body) lastPostBodies.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ ok: true, started: true }) } as Response;
    }) as unknown as typeof fetch;
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('re-issues the turn once after a retryable error, then succeeds', async () => {
    streamScript = [
      [{ type: 'status', runStatus: 'error', retryable: true }, { type: 'done', seq: 0 }],     // attempt 1: crash-interrupted
      [{ type: 'message', seq: 1, message: {} as never }, { type: 'status', runStatus: 'idle' }, { type: 'done', seq: 1 }], // retry: ok
    ];

    const res = await runV3Turn(7, 0, { userMessage: 'hi', agent: 'WebAnalystAgent', agentArgs: {} }, new AbortController().signal, cb);

    expect(res.status).toBe('idle');
    expect(streamOpens).toBe(2);  // initial + 1 retry
    expect(postCount).toBe(2);
    expect(lastPostBodies[0].autoRetry).toBeUndefined();   // first POST is a normal turn
    expect(lastPostBodies[1].autoRetry).toBe(true);        // retry POST flags autoRetry
    expect(lastPostBodies[1].userMessage).toBeUndefined(); // server replays from the log
  });

  it('stops after MAX_CLIENT_AUTO_RETRIES when the error stays retryable', async () => {
    // Every attempt reports a retryable crash → client caps the loop.
    streamScript = Array.from({ length: 6 }, () => (
      [{ type: 'status', runStatus: 'error', retryable: true }, { type: 'done', seq: 0 }] as ConversationStreamEvent[]
    ));

    const res = await runV3Turn(7, 0, { userMessage: 'hi', agent: 'WebAnalystAgent', agentArgs: {} }, new AbortController().signal, cb);

    expect(res.status).toBe('error');
    expect(streamOpens).toBe(3);  // initial + 2 retries (MAX_CLIENT_AUTO_RETRIES), then give up
  });

  it('does NOT retry a non-retryable error (e.g. an LLM failure)', async () => {
    streamScript = [
      [{ type: 'status', runStatus: 'error' }, { type: 'done', seq: 0 }],  // error without retryable
    ];

    const res = await runV3Turn(7, 0, { userMessage: 'hi', agent: 'WebAnalystAgent', agentArgs: {} }, new AbortController().signal, cb);

    expect(res.status).toBe('error');
    expect(streamOpens).toBe(1);  // no retry
  });
});
