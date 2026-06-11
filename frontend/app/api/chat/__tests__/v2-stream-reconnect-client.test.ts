// Client-side reconnect+resume — full pipeline test.
//
// Simulates the prod failure: the XHR carrying /api/chat/stream is severed
// mid-stream (app restart, corporate middlebox, network blip) — MockXHR fires
// `onerror` after the first streaming frame, exactly like a dropped socket.
// Desired behavior (red before the chatListener resume work): the listener
// reconnects with `resume.afterSeq`, replays the missed frames, and the
// conversation finishes cleanly — the user never sees an error.

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

// Force IS_TEST=false so chatListener uses the XHR streaming path.
vi.mock('@/lib/constants', async () => {
  const actual = await vi.importActual<typeof import('@/lib/constants')>('@/lib/constants');
  return { ...actual, IS_TEST: false };
});

import { fauxAssistantMessage } from '@/orchestrator/llm/testing';
import { fauxRegistration as webAnalystFaux } from '@/agents/web-analyst/web-analyst';
import { POST as chatStreamPostHandler } from '@/app/api/chat/stream/route';
import { GET as fileGetHandler } from '@/app/api/files/[id]/route';
import { setupMockFetch } from '@/test/harness/mock-fetch';
import { __clearAllRuns } from '@/lib/chat/run-registry.server';
import { createConversation, sendMessage, selectConversation } from '@/store/chatSlice';
import { makeStore } from '@/store/store';
import type { RootState } from '@/store/store';
import { FilesAPI } from '@/lib/data/files.server';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { NextRequest } from 'next/server';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const TEST_DB_PATH = getTestDbPath('v2_stream_reconnect_client');

const ADMIN: EffectiveUser = {
  userId: 1,
  email: 'test@example.com',
  name: 'Test User',
  role: 'admin',
  home_folder: '/org',
  mode: 'org',
};

vi.mock('@/lib/auth/auth-helpers', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/auth-helpers')>('@/lib/auth/auth-helpers');
  return {
    ...actual,
    getEffectiveUser: vi.fn(async () => ADMIN),
  };
});

// ─── MockXHR with a kill switch ──────────────────────────────────────
//
// Same in-process bridge as v2-streaming-xhr.test.ts, plus `severNextRequest`:
// when armed, the NEXT non-resume request stops reading mid-stream after the
// first streaming_event bytes arrive and fires `onerror` — byte-for-byte what
// a severed connection looks like to the chatListener.

let severNextRequest = false;
let severFirstBytes = false; // sever on the first bytes (before any frame) instead of after streaming_event
let severedCount = 0;
const seenRequestBodies: any[] = [];

class MockXHR {
  method = '';
  url = '';
  responseText = '';
  status = 0;
  readyState = 0;
  onprogress: (() => void) | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  onreadystatechange: (() => void) | null = null;
  private headers: Record<string, string> = {};
  private aborted = false;

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(key: string, value: string): void {
    this.headers[key] = value;
  }

  abort(): void {
    this.aborted = true;
    this.onabort?.();
  }

  async send(body: string | undefined): Promise<void> {
    try {
      const parsedBody = body ? JSON.parse(body) : {};
      seenRequestBodies.push(parsedBody);
      const shouldSever = severNextRequest && !parsedBody.resume;

      const url = this.url.startsWith('http') ? this.url : `http://localhost:3000${this.url}`;
      const req = new NextRequest(url, { method: this.method, body: body ?? null, headers: this.headers });
      const res = await chatStreamPostHandler(req);
      this.status = res.status;
      this.readyState = 2;
      this.onreadystatechange?.();
      const reader = res.body?.getReader();
      if (!reader) {
        this.onload?.();
        return;
      }
      const decoder = new TextDecoder();
      while (true) {
        if (this.aborted) return;
        const { value, done } = await reader.read();
        if (done) break;
        this.responseText += decoder.decode(value, { stream: true });
        this.onprogress?.();
        if (shouldSever && (severFirstBytes || this.responseText.includes('event: streaming_event'))) {
          // Connection severed mid-stream: no more bytes, transport error.
          severNextRequest = false;
          severedCount += 1;
          await reader.cancel();
          this.onerror?.();
          return;
        }
      }
      this.responseText += decoder.decode();
      this.onprogress?.();
      this.readyState = 4;
      this.onreadystatechange?.();
      this.onload?.();
    } catch (err) {
      console.error('[MockXHR] send failed:', err);
      this.onerror?.();
    }
  }
}

// ─── Test ────────────────────────────────────────────────────────────

describe('chatListener reconnect+resume after a mid-stream transport drop', () => {
  setupTestDb(TEST_DB_PATH);

  // The file-recovery fallback fetches GET /api/files/:id — route it to the
  // real handler in-process (getEffectiveUser is mocked above).
  setupMockFetch({
    additionalInterceptors: [
      async (urlStr: string, init?: any) => {
        const m = urlStr.match(/\/api\/files\/(\d+)/);
        if (!m || (init?.method && init.method !== 'GET')) return null;
        const fullUrl = urlStr.startsWith('http') ? urlStr : `http://localhost:3000${urlStr}`;
        const req = new NextRequest(fullUrl, { method: 'GET' });
        const res = await fileGetHandler(req, { params: Promise.resolve({ id: m[1] }) });
        return { ok: res.status === 200, status: res.status, json: async () => res.json() } as Response;
      },
    ],
  });

  let originalXHR: typeof XMLHttpRequest | undefined;

  beforeAll(() => {
    originalXHR = (globalThis as { XMLHttpRequest?: typeof XMLHttpRequest }).XMLHttpRequest;
    (globalThis as { XMLHttpRequest: typeof XMLHttpRequest }).XMLHttpRequest =
      MockXHR as unknown as typeof XMLHttpRequest;
  });

  afterAll(() => {
    if (originalXHR) {
      (globalThis as { XMLHttpRequest: typeof XMLHttpRequest }).XMLHttpRequest = originalXHR;
    } else {
      delete (globalThis as { XMLHttpRequest?: typeof XMLHttpRequest }).XMLHttpRequest;
    }
  });

  beforeEach(() => {
    __clearAllRuns();
    severNextRequest = false;
    severFirstBytes = false;
    severedCount = 0;
    seenRequestBodies.length = 0;
  });

  it('recovers silently: resumes the stream and finishes without surfacing an error', async () => {
    const created = await FilesAPI.createFile(
      {
        name: 'reconnect-test',
        path: '/org/logs/conversations/1/reconnect-test.chat.json',
        type: 'conversation',
        content: {
          metadata: { userId: '1', name: 'reconnect-test', createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z', logLength: 0 },
          log: [],
        } as never,
        meta: { version: 2 },
        options: { createPath: true, returnExisting: false },
      },
      ADMIN,
    );
    const conversationId = created.data.id;

    webAnalystFaux.setResponses([
      fauxAssistantMessage(
        'The connection may drop but this answer must arrive intact.',
        { stopReason: 'stop' },
      ),
    ]);

    const store = makeStore();
    Object.defineProperty(globalThis, 'window', {
      value: { location: { search: '?v=2', origin: 'http://localhost:3000' } },
      writable: true,
      configurable: true,
    });

    store.dispatch(createConversation({ conversationID: conversationId, agent: 'AnalystAgent', agent_args: {} }));

    // Arm the kill switch: the sendMessage stream will be severed mid-turn.
    severNextRequest = true;
    store.dispatch(sendMessage({ conversationID: conversationId, message: 'Will you survive a drop?' }));

    // Wait for terminal state (generous: includes the reconnect backoff).
    const t0 = Date.now();
    for (;;) {
      const conv = selectConversation(store.getState() as RootState, conversationId);
      if (conv && (conv.executionState === 'FINISHED' || conv.error)) break;
      if (Date.now() - t0 > 20000) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    const conv = selectConversation(store.getState() as RootState, conversationId)!;

    // The drop genuinely happened…
    expect(severedCount).toBe(1);
    // …a resume request was issued with a sequence cursor…
    const resumeBodies = seenRequestBodies.filter((b) => b.resume);
    expect(resumeBodies.length).toBeGreaterThanOrEqual(1);
    expect(typeof resumeBodies[0].resume.afterSeq).toBe('number');
    // …and the user never saw an error: the turn completed.
    expect(conv.error).toBeUndefined();
    expect(conv.executionState).toBe('FINISHED');
    const allMessages = JSON.stringify(conv.messages);
    expect(allMessages).toContain('The connection may drop but this answer must arrive intact.');
  }, 30000);

  it('resume_miss with a persisted turn: recovers from the conversation file instead of erroring', async () => {
    const created = await FilesAPI.createFile(
      {
        name: 'miss-recover-test',
        path: '/org/logs/conversations/1/miss-recover-test.chat.json',
        type: 'conversation',
        content: {
          metadata: { userId: '1', name: 'miss-recover-test', createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z', logLength: 0 },
          log: [],
        } as never,
        meta: { version: 2 },
        options: { createPath: true, returnExisting: false },
      },
      ADMIN,
    );
    const conversationId = created.data.id;

    // Gate the reply so the sever provably happens before any frame.
    let releaseTurn!: () => void;
    const gate = new Promise<void>((r) => { releaseTurn = r; });
    webAnalystFaux.setResponses([
      async () => {
        await gate;
        return fauxAssistantMessage('Recovered from the file after restart.', { stopReason: 'stop' });
      },
    ]);

    const store = makeStore();
    Object.defineProperty(globalThis, 'window', {
      value: { location: { search: '?v=2', origin: 'http://localhost:3000' } },
      writable: true,
      configurable: true,
    });

    store.dispatch(createConversation({ conversationID: conversationId, agent: 'AnalystAgent', agent_args: {} }));

    // Sever on first bytes — the client got NOTHING; the turn keeps running.
    severNextRequest = true;
    severFirstBytes = true;
    store.dispatch(sendMessage({ conversationID: conversationId, message: 'Recover me from the file' }));

    // Wait for the sever, then simulate a server restart: registry state gone.
    const tSever = Date.now();
    while (severedCount === 0 && Date.now() - tSever < 5000) await new Promise((r) => setTimeout(r, 20));
    expect(severedCount).toBe(1);
    releaseTurn();              // turn completes + persists server-side
    await new Promise((r) => setTimeout(r, 300)); // let persistence land
    __clearAllRuns();           // "server restarted": nothing to resume

    // Desired: the client's resume gets resume_miss, falls back to the
    // conversation FILE, finds the completed turn, and renders it — no error.
    const t0 = Date.now();
    for (;;) {
      const conv = selectConversation(store.getState() as RootState, conversationId);
      if (conv && (conv.executionState === 'FINISHED' || conv.error)) break;
      if (Date.now() - t0 > 20000) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    const conv = selectConversation(store.getState() as RootState, conversationId)!;
    expect(conv.error).toBeUndefined();
    expect(conv.executionState).toBe('FINISHED');
    expect(JSON.stringify(conv.messages)).toContain('Recovered from the file after restart.');
  }, 30000);
});
