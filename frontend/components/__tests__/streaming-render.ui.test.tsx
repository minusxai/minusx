// FULL streaming E2E, rendered: drives the real production streaming transport
// (chatListener → XHR → in-process /api/chat/stream → JS orchestrator + faux LLM →
// SSE → listener → Redux) AND renders <ChatInterface>, asserting the streamed
// thoughts, tool call, and answer text actually appear in the DOM.
//
//   dispatch(sendMessage) → chatListener → streamChatSSE (MockXHR)
//                                              ↓
//                                  in-process /api/chat/stream?v=2
//                                              ↓
//                                    orchestrator + faux LLM (thinking → tool → text)
//                                              ↓
//                                       SSE → listener → Redux
//                                              ↓
//                                  <ChatInterface> renders → assert aria-labels

import React from 'react';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined, DB_PATH: undefined, DB_DIR: undefined, getDbType: () => 'pglite' as const,
}));
// Force the production XHR streaming path (not the fetch/non-stream test fallback).
vi.mock('@/lib/constants', async () => {
  const actual = await vi.importActual<typeof import('@/lib/constants')>('@/lib/constants');
  return { ...actual, IS_TEST: false };
});
// Route handler auth.
const ADMIN = { userId: 1, email: 'test@example.com', name: 'Test User', role: 'admin' as const, home_folder: '/org', mode: 'org' as const };
vi.mock('@/lib/auth/auth-helpers', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/auth-helpers')>('@/lib/auth/auth-helpers');
  return { ...actual, getEffectiveUser: vi.fn(async () => ADMIN) };
});
// v2 mode via ?v=2 (drives useUseChatV2 + the listener's URL).
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/explore',
  useSearchParams: () => new URLSearchParams('v=2'),
}));
vi.mock('@/lib/navigation/NavigationGuardProvider', () => ({
  useNavigationGuard: () => ({ navigate: vi.fn(), isBlocked: false, confirmNavigation: vi.fn(), cancelNavigation: vi.fn() }),
  NavigationGuardProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/lib/hooks/useConfigs', () => ({ useConfigs: () => ({ config: { branding: { agentName: 'MinusX' } } }) }));
vi.mock('@/lib/hooks/useContext', () => ({
  useContext: () => ({ contextId: 1, databases: [], documentation: '', availableSkills: [], contextLoading: false }),
}));
vi.mock('@/lib/chart/chart-attachments', () => ({ buildChartAttachments: vi.fn().mockResolvedValue([]) }));
// Markdown → plain text so answer text is visible inside the "Answer block".
vi.mock('@/components/Markdown', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => React.createElement('span', null, children),
}));
// Leaf input — we drive sending via dispatch, not the editor.
vi.mock('@/components/explore/ChatInput', () => ({
  __esModule: true,
  default: () => React.createElement('div', { 'aria-label': 'chat input' }),
}));

import { fauxAssistantMessage, fauxToolCall } from '@/orchestrator/llm/testing';
import { fauxRegistration as webAnalystFaux } from '@/agents/web-analyst/web-analyst';
import { POST as chatStreamPostHandler } from '@/app/api/chat/stream/route';
import { createConversation, sendMessage, selectConversation } from '@/store/chatSlice';
import { setShowExpandedMessages } from '@/store/uiSlice';
import * as storeModule from '@/store/store';
import type { RootState } from '@/store/store';
import { FilesAPI } from '@/lib/data/files.server';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { NextRequest } from 'next/server';
import ChatInterface from '@/components/explore/ChatInterface';

// ─── MockXHR: bridge the listener's XHR to the in-process stream route ───────
class MockXHR {
  method = ''; url = ''; responseText = ''; status = 0; readyState = 0;
  onprogress: (() => void) | null = null; onload: (() => void) | null = null;
  onerror: (() => void) | null = null; onabort: (() => void) | null = null;
  onreadystatechange: (() => void) | null = null;
  private headers: Record<string, string> = {}; private aborted = false;
  open(m: string, u: string) { this.method = m; this.url = u; }
  setRequestHeader(k: string, v: string) { this.headers[k] = v; }
  abort() { this.aborted = true; this.onabort?.(); }
  async send(body?: string) {
    try {
      const url = this.url.startsWith('http') ? this.url : `http://localhost:3000${this.url}`;
      const res = await chatStreamPostHandler(new NextRequest(url, { method: this.method, body: body ?? null, headers: this.headers }));
      this.status = res.status; this.readyState = 2; this.onreadystatechange?.();
      const reader = res.body?.getReader();
      if (!reader) { this.onload?.(); return; }
      const dec = new TextDecoder();
      while (true) {
        if (this.aborted) return;
        const { value, done } = await reader.read();
        if (done) break;
        this.responseText += dec.decode(value, { stream: true });
        this.onprogress?.();
      }
      this.responseText += dec.decode(); this.onprogress?.();
      this.readyState = 4; this.onreadystatechange?.(); this.onload?.();
    } catch (err) { console.error('[MockXHR]', err); this.onerror?.(); }
  }
}

describe('streaming chat renders thoughts + tool + answer (full e2e UI)', () => {
  setupTestDb(getTestDbPath('streaming_render_ui'));
  let originalXHR: typeof XMLHttpRequest | undefined;

  beforeAll(() => {
    Element.prototype.scrollTo = vi.fn(); // jsdom lacks scrollTo; ChatInterface auto-scrolls
    originalXHR = (globalThis as { XMLHttpRequest?: typeof XMLHttpRequest }).XMLHttpRequest;
    (globalThis as { XMLHttpRequest: typeof XMLHttpRequest }).XMLHttpRequest = MockXHR as unknown as typeof XMLHttpRequest;
    Object.defineProperty(window, 'location', {
      value: { search: '?v=2', origin: 'http://localhost:3000', pathname: '/explore' },
      writable: true, configurable: true,
    });
  });
  afterAll(() => {
    if (originalXHR) (globalThis as { XMLHttpRequest: typeof XMLHttpRequest }).XMLHttpRequest = originalXHR;
  });

  it('streams thinking → tool → text and renders each in the chat', async () => {
    const created = await FilesAPI.createFile(
      {
        name: 'conv', path: '/org/logs/conversations/1/conv.chat.json', type: 'conversation',
        content: { metadata: { userId: '1', name: 'conv', createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z', logLength: 0 }, log: [] } as never,
        meta: { version: 2 },
        options: { createPath: true, returnExisting: false },
      },
      ADMIN,
    );
    const conversationId = created.data.id;

    // Two LLM turns: (1) thinking + a SearchFiles tool call; (2) thinking + final text.
    webAnalystFaux.setResponses([
      fauxAssistantMessage([{ type: 'thinking', thinking: 'Let me search the files.' }, fauxToolCall('SearchFiles', { queries: ['revenue'] })], { stopReason: 'toolUse' }),
      fauxAssistantMessage([{ type: 'thinking', thinking: 'Got it.' }, { type: 'text', text: 'The answer is 42.' }], { stopReason: 'stop' }),
    ]);

    const store = storeModule.makeStore();
    vi.spyOn(storeModule, 'getStore').mockReturnValue(store);
    store.dispatch(setShowExpandedMessages(true)); // 'detailed' → inline SimpleChatMessage rows

    store.dispatch(createConversation({ conversationID: conversationId, agent: 'AnalystAgent', agent_args: {} }));

    renderWithProviders(
      <ChatInterface conversationId={conversationId} contextPath="/org/context" container="page" appState={null} />,
      { store },
    );

    store.dispatch(sendMessage({ conversationID: conversationId, message: 'What is the answer?' }));

    // Wait for the stream to finish.
    await waitFor(() => {
      const c = selectConversation(store.getState() as RootState, conversationId);
      expect(c?.executionState).toBe('FINISHED');
    }, { timeout: 12000 });

    // Rendered (all delivered via the streaming pipeline):
    // 1. The tool call streamed in and rendered as a tool row.
    expect(await screen.findByLabelText('Tool: SearchFiles')).toBeTruthy();

    // 2. The final answer text rendered.
    const answer = await screen.findByLabelText('Answer block');
    expect(answer.textContent).toContain('The answer is 42.');

    // 3. Thinking streamed in (collapsed by default) — expand and assert the text.
    fireEvent.click((await screen.findAllByLabelText('Show Thinking'))[0]);
    const thinkingBlocks = await screen.findAllByLabelText('Thinking block');
    const thinkingText = thinkingBlocks.map((b) => b.textContent ?? '').join(' ');
    expect(thinkingText).toContain('Let me search the files.');
  }, 20000);
});
