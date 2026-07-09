// Remote Agent Sessions — listener wiring (node): while a conversation is flagged remote, the
// completeToolCall listener POSTs completions APPEND-ONLY through the real turns route (short-
// circuit; no stream, no LLM) and clears pending. Exercises the real store + real route handlers.

import { NextRequest } from 'next/server';
import { setupTestStore, getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { setupMockFetch } from '@/test/harness/mock-fetch';
import { POST as mintRoute } from '@/app/api/conversations/[id]/remote-session/route';
import { POST as turnsRoute } from '@/app/api/conversations/[id]/turns/route';
import { POST as toolRoute } from '@/app/s/[code]/tool/route';
import { createConversation, getConversation, loadLog } from '@/lib/data/conversations.server';
import {
  loadConversation,
  setRemoteSession,
  completeToolCall,
  selectConversation,
} from '@/store/chatSlice';
import { resetRemoteSessionRateLimit } from '@/lib/http/with-remote-session-auth';
import type { RemoteToolCallPending } from '@/lib/data/remote-sessions.types';

const TEST_DB_PATH = getTestDbPath('remote_session_listener');
const idCtx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) }) as never;
const codeCtx = (code: string) => ({ params: Promise.resolve({ code }) }) as never;

describe('chatListener: remote session completions', () => {
  setupTestDb(TEST_DB_PATH);
  // Route the listener's POST /api/conversations/:id/turns to the real handler.
  setupMockFetch({
    additionalInterceptors: [async (urlStr, init) => {
      const m = urlStr.match(/\/api\/conversations\/(\d+)\/turns/);
      if (!m || (init?.method ?? 'GET') !== 'POST') return null;
      const req = new NextRequest(urlStr.startsWith('http') ? urlStr : `http://localhost:3000${urlStr}`, {
        method: 'POST', body: init?.body, headers: init?.headers,
      });
      return turnsRoute(req, { params: Promise.resolve({ id: m[1] }) } as never);
    }],
  });
  beforeEach(() => resetRemoteSessionRateLimit());

  it('completeToolCall in remote mode POSTs the completion append-only (status stays remote)', async () => {
    // Server side: mint a session and dispatch a frontend tool so a pending call exists.
    const conv = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
    const mintRes = await mintRoute(
      new NextRequest(`http://localhost:3000/api/conversations/${conv.id}/remote-session`, { method: 'POST' }),
      idCtx(conv.id),
    );
    const { code } = (await mintRes.json()).data as { code: string };
    const toolRes = await toolRoute(
      new NextRequest(`http://localhost:3000/s/${code}/tool`, {
        method: 'POST',
        body: JSON.stringify({ tool: 'EditFile', args: { fileId: 42, name: 'Renamed' }, waitMs: 0 }),
      }),
      codeCtx(code),
    );
    expect(toolRes.status).toBe(202);
    const pending = (await toolRes.json()) as RemoteToolCallPending;

    // Client side: a store whose conversation is flagged remote with that pending call COMPLETED.
    const store = setupTestStore();
    store.dispatch(loadConversation({
      conversation: {
        _id: 'remote-test',
        conversationID: conv.id,
        log_index: 2,
        messages: [],
        executionState: 'EXECUTING',
        pending_tool_calls: [{
          toolCall: { id: pending.toolCallId, type: 'function', function: { name: 'EditFile', arguments: { fileId: 42 } } },
          result: undefined,
        }],
        streamedCompletedToolCalls: [],
        streamedThinking: '',
        agent: 'WebAnalystAgent',
        agent_args: {},
        version: 3,
      } as never,
      setAsActive: false,
    }));
    store.dispatch(setRemoteSession({ conversationID: conv.id, active: true }));

    // Completing the tool fires the completeToolCall listener → remote branch → POST /turns.
    store.dispatch(completeToolCall({
      conversationID: conv.id,
      tool_call_id: pending.toolCallId,
      result: { role: 'tool', tool_call_id: pending.toolCallId, content: 'File renamed.', details: { success: true } } as never,
    }));

    // The toolResult row lands durably and the conversation REMAINS a remote session (no LLM run).
    await vi.waitFor(async () => {
      const log = await loadLog(conv.id);
      const result = log.find(
        (e) => (e as { role?: string }).role === 'toolResult'
          && (e as { toolCallId?: string }).toolCallId === pending.toolCallId,
      );
      expect(result).toBeTruthy();
    }, { timeout: 4000 });
    expect((await getConversation(conv.id))!.runStatus).toBe('remote');

    // Pending cleared client-side; the session flag survives (freeze stays until Stop/expiry).
    await vi.waitFor(() => {
      const c = selectConversation(store.getState() as never, conv.id)!;
      expect(c.pending_tool_calls.filter((p) => !p.result).length).toBe(0);
      expect(c.remoteSession?.active).toBe(true);
    });
  });

  it('setRemoteSession(false) clears the freeze flag and pending calls', async () => {
    const store = setupTestStore();
    store.dispatch(loadConversation({
      conversation: {
        _id: 'remote-clear',
        conversationID: 777,
        log_index: 0,
        messages: [],
        executionState: 'EXECUTING',
        pending_tool_calls: [{ toolCall: { id: 'x1', type: 'function', function: { name: 'EditFile', arguments: {} } }, result: undefined }],
        streamedCompletedToolCalls: [],
        streamedThinking: '',
        agent: 'WebAnalystAgent',
        agent_args: {},
        version: 3,
      } as never,
      setAsActive: false,
    }));
    store.dispatch(setRemoteSession({ conversationID: 777, active: true, expiresAt: '2026-07-09T16:00:00Z' }));
    let c = selectConversation(store.getState() as never, 777)!;
    expect(c.remoteSession).toEqual({ active: true, expiresAt: '2026-07-09T16:00:00Z' });

    store.dispatch(setRemoteSession({ conversationID: 777, active: false }));
    c = selectConversation(store.getState() as never, 777)!;
    expect(c.remoteSession?.active).toBe(false);
    expect(c.pending_tool_calls.length).toBe(0);
    expect(c.executionState).toBe('FINISHED');
  });
});
