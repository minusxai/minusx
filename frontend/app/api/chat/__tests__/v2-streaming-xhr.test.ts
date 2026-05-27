// V=2 streaming end-to-end via XHR — exercises the FULL production
// streaming pipeline that handler-only tests skip.
//
//   chatSlice.sendMessage  →  chatListener  →  streamChatSSE (XHR)
//                                                    ↓
//                                        in-process /api/chat/stream
//                                                    ↓
//                                          orchestrator + translator
//                                                    ↓
//                                         SSE bytes back via onprogress
//                                                    ↓
//                                       chatListener parses + dispatches
//                                                    ↓
//                                      addStreamingMessage + applyDoneEvent
//                                                    ↓
//                                          assertions on Redux state
//
// This catches integration-level breakage (URL params dropped, SSE event
// names mismatched, reducer not handling a new event type, mode-mismatch
// guards firing wrong) that handler-only tests miss.

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

// Force IS_TEST=false so chatListener uses the XHR path (not the
// fetchChatNonStreaming fallback). Our MockXHR intercepts and routes to
// the in-process route handler.
vi.mock('@/lib/constants', async () => {
  const actual = await vi.importActual<typeof import('@/lib/constants')>('@/lib/constants');
  return { ...actual, IS_TEST: false };
});

import { fauxAssistantMessage } from '@/orchestrator/llm/testing';
import { fauxRegistration as webAnalystFaux } from '@/agents/web-analyst/web-analyst';
import { POST as chatStreamPostHandler } from '@/app/api/chat/stream/route';
import {
  createConversation,
  sendMessage,
  selectConversation,
} from '@/store/chatSlice';
import { makeStore } from '@/store/store';
import type { RootState } from '@/store/store';
import { FilesAPI } from '@/lib/data/files.server';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { NextRequest } from 'next/server';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const TEST_DB_PATH = getTestDbPath('v2_streaming_xhr');

const ADMIN: EffectiveUser = {
  userId: 1,
  email: 'test@example.com',
  name: 'Test User',
  role: 'admin',
  home_folder: '/org',
  mode: 'org',
};

// ─── MockXHR ─────────────────────────────────────────────────────────
//
// Drop-in replacement for `globalThis.XMLHttpRequest`. When `chatListener`
// opens an XHR against `/api/chat/stream`, the mock invokes the in-process
// route handler, then streams the handler's response body back through
// `onprogress` events — exactly mirroring how the browser would deliver
// SSE bytes to the parser. Headers + status are surfaced via
// onreadystatechange + xhr.status, matching real XHR semantics.

interface MockXHREventHandlers {
  onprogress: (() => void) | null;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  onreadystatechange: (() => void) | null;
}

class MockXHR implements MockXHREventHandlers {
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
      const url = this.url.startsWith('http') ? this.url : `http://localhost:3000${this.url}`;
      const req = new NextRequest(url, {
        method: this.method,
        body: body ?? null,
        headers: this.headers,
      });
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

// ─── Auth mock ───────────────────────────────────────────────────────
//
// chatStreamPostHandler calls getEffectiveUser() → auth-helpers → cookie
// reads. In tests we can't easily fake cookies, so override the auth at
// the helper level.

vi.mock('@/lib/auth/auth-helpers', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/auth-helpers')>('@/lib/auth/auth-helpers');
  return {
    ...actual,
    getEffectiveUser: vi.fn(async () => ADMIN),
  };
});

// ─── Test ────────────────────────────────────────────────────────────

describe('XHR-driven /api/chat/stream?v=2 — full streaming pipeline', () => {
  setupTestDb(TEST_DB_PATH);

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

  it('chatListener drives v=2 streaming via XHR; thinking + text deltas land in the right Redux fields', async () => {
    // Seed a v=2 conversation file directly.
    const created = await FilesAPI.createFile(
      {
        name: 'test',
        path: '/org/logs/conversations/1/test.chat.json',
        type: 'conversation',
        content: {
          metadata: { userId: '1', name: 'test', createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z', logLength: 0 },
          log: [],
        } as never,
        meta: { version: 2 },
        options: { createPath: true, returnExisting: false },
      },
      ADMIN,
    );
    const conversationId = created.data.id;

    // Faux LLM: ONE assistant message with both thinking and text content
    // blocks, stopReason=stop. The model will stream this as a sequence of
    // thinking_delta + text_delta events.
    webAnalystFaux.setResponses([
      fauxAssistantMessage(
        [
          { type: 'thinking', thinking: 'Let me consider…' },
          { type: 'text', text: 'The answer is 42.' },
        ],
        { stopReason: 'stop' },
      ),
    ]);

    const store = makeStore();

    // Override fetch-patch for this test environment so XHR URLs include
    // ?v=2 — the chatListener.patchApiUrl reads window.location.search
    // which is empty in node. Manually patch the search to include v=2 so
    // the chatListener appends v=2 when constructing the XHR URL.
    Object.defineProperty(globalThis, 'window', {
      value: {
        location: {
          search: '?v=2',
          origin: 'http://localhost:3000',
        },
      },
      writable: true,
      configurable: true,
    });

    // Step 1: createConversation in chatSlice (sets conversationID +
    // messages=[user_message]). Then sendMessage to drive chatListener.
    store.dispatch(
      createConversation({
        conversationID: conversationId,
        agent: 'AnalystAgent',
        agent_args: {},
        message: 'What is the answer?',
      }),
    );
    // Capture the MAX values of streamedThinking and streamedCompletedToolCalls
    // observed mid-stream. Without subscribing per-action, the post-`done`
    // reducer may have already cleared them by the time we assert below.
    let maxStreamedThinking = '';
    let sawTtuStreaming = false;
    const unsub = store.subscribe(() => {
      const c = selectConversation(store.getState() as RootState, conversationId);
      if (!c) return;
      if (c.streamedThinking && c.streamedThinking.length > maxStreamedThinking.length) {
        maxStreamedThinking = c.streamedThinking;
      }
      if (c.streamedCompletedToolCalls?.some(
        (m) => (m as { function?: { name?: string } }).function?.name === 'TalkToUser',
      )) {
        sawTtuStreaming = true;
      }
    });

    store.dispatch(sendMessage({ conversationID: conversationId, message: 'What is the answer?' }));

    // Wait for streaming to complete — executionState transitions through
    // STREAMING → FINISHED (or stays at the last state the reducer set).
    const t0 = Date.now();
    while (Date.now() - t0 < 10000) {
      const conv = selectConversation(store.getState() as RootState, conversationId);
      if (conv && conv.executionState === 'FINISHED') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    unsub();

    // Critical assertions: thinking actually streamed through StreamedThinking
    // (NOT through StreamedContent — which would land it in
    // streamedCompletedToolCalls and render as plain answer text). And the
    // final-text TalkToUser stream WAS observed mid-stream. These are the
    // wire-level guarantees the user's "thinking shows as regular text"
    // bug would violate.
    expect(maxStreamedThinking.length).toBeGreaterThan(0);
    expect(maxStreamedThinking).toContain('Let me consider');
    expect(sawTtuStreaming).toBe(true);

    const conv = selectConversation(store.getState() as RootState, conversationId)!;
    expect(conv).toBeDefined();
    expect(conv.executionState).toBe('FINISHED');
    expect(conv.error).toBeUndefined();

    // The user message + at least one TalkToUser tool call (translated
    // assistant message) should be in messages.
    const userMessages = conv.messages.filter((m) => m.role === 'user');
    expect(userMessages.length).toBeGreaterThanOrEqual(1);
    expect((userMessages[0] as { content: string }).content).toBe('What is the answer?');

    const ttuCalls = conv.messages.filter(
      (m) => m.role === 'tool' && (m as { function?: { name?: string } }).function?.name === 'TalkToUser',
    );
    expect(ttuCalls.length).toBeGreaterThan(0);

    // Final TalkToUser content is JSON-stringified {success, content_blocks}
    // with thinking+text blocks (translator's v=1-compat shape).
    const ttu = ttuCalls[ttuCalls.length - 1] as { content: string | object };
    const parsed = typeof ttu.content === 'string' ? JSON.parse(ttu.content) : ttu.content;
    expect(parsed.content_blocks).toEqual([
      { type: 'thinking', thinking: 'Let me consider…' },
      { type: 'text', text: 'The answer is 42.' },
    ]);
  }, 15000);
});
