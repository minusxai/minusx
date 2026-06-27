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

  it('stops when the server signals exhaustion (retryable:false) — the normal terminal path', async () => {
    // Server lets it retry twice, then flips to a non-retryable error (budget exhausted).
    streamScript = [
      [{ type: 'status', runStatus: 'error', retryable: true }, { type: 'done', seq: 0 }],
      [{ type: 'status', runStatus: 'error', retryable: true }, { type: 'done', seq: 0 }],
      [{ type: 'status', runStatus: 'error', retryable: false }, { type: 'done', seq: 0 }], // exhausted
    ];

    const res = await runV3Turn(7, 0, { userMessage: 'hi', agent: 'WebAnalystAgent', agentArgs: {} }, new AbortController().signal, cb);

    expect(res.status).toBe('error');
    expect(res.retryable).toBe(false);
    expect(streamOpens).toBe(3);  // initial + 2 retries, then the server said stop
  });

  it('caps at the client safety bound if the server never stops sending retryable', async () => {
    streamScript = Array.from({ length: 12 }, () => (
      [{ type: 'status', runStatus: 'error', retryable: true }, { type: 'done', seq: 0 }] as ConversationStreamEvent[]
    ));

    const res = await runV3Turn(7, 0, { userMessage: 'hi', agent: 'WebAnalystAgent', agentArgs: {} }, new AbortController().signal, cb);

    expect(res.status).toBe('error');
    expect(streamOpens).toBe(6);  // initial + 5 (MAX_CLIENT_AUTO_RETRIES safety bound)
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
