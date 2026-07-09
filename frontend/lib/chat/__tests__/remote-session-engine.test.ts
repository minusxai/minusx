// Remote Agent Sessions — the execution engine, end-to-end through the real routes:
// POST /s/<code>/tool (server tools in-process; frontend tools → 202 + browser round-trip),
// GET /s/<code>/result/<id>, /context, /end, the turns-route mutual-exclusion guard + completion
// short-circuit (NO LLM), stop-mid-call cleanup, and the log-invariant regression (a later normal
// faux-LLM turn on the same conversation still loads and runs).

import { NextRequest } from 'next/server';
import { POST as mintRoute, DELETE as stopRoute } from '@/app/api/conversations/[id]/remote-session/route';
import { POST as toolRoute } from '@/app/s/[code]/tool/route';
import { GET as resultRoute } from '@/app/s/[code]/result/[toolCallId]/route';
import { GET as contextRoute } from '@/app/s/[code]/context/route';
import { POST as endRoute } from '@/app/s/[code]/end/route';
import { POST as turnsRoute } from '@/app/api/conversations/[id]/turns/route';
import { GET as skillDocRoute } from '@/app/s/[code]/route';
import {
  createConversation,
  getConversation,
  loadMessages,
  loadLog,
  getMaxSeq,
} from '@/lib/data/conversations.server';
import { getRemoteToolResult } from '@/lib/chat/remote-session-engine.server';
import { fauxRegistration as webAnalystFaux } from '@/agents/web-analyst/web-analyst';
import { fauxAssistantMessage } from '@/orchestrator/llm/testing';
import { resetRemoteSessionRateLimit } from '@/lib/http/with-remote-session-auth';
import type { RemoteToolCallCompleted, RemoteToolCallPending } from '@/lib/data/remote-sessions.types';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';

const TEST_DB_PATH = getTestDbPath('remote_session_engine');
const idCtx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) }) as never;
const codeCtx = (code: string) => ({ params: Promise.resolve({ code }) }) as never;
const resultCtx = (code: string, toolCallId: string) =>
  ({ params: Promise.resolve({ code, toolCallId }) }) as never;

async function mintSession(): Promise<{ conversationId: number; code: string }> {
  const conv = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
  const res = await mintRoute(
    new NextRequest(`http://localhost:3000/api/conversations/${conv.id}/remote-session`, { method: 'POST' }),
    idCtx(conv.id),
  );
  const body = await res.json();
  return { conversationId: conv.id, code: body.data.code as string };
}

function callTool(code: string, payload: Record<string, unknown>): Promise<Response> {
  return toolRoute(
    new NextRequest(`http://localhost:3000/s/${code}/tool`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
    codeCtx(code),
  );
}

describe('remote session tool endpoint', () => {
  setupTestDb(TEST_DB_PATH);
  beforeEach(() => resetRemoteSessionRateLimit());

  it('executes a server tool in-process and appends well-formed log rows', async () => {
    const { conversationId, code } = await mintSession();
    const res = await callTool(code, { tool: 'SearchFiles', args: { query: 'revenue' } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as RemoteToolCallCompleted;
    expect(body.status).toBe('completed');
    expect(body.content.some((b) => b.type === 'text')).toBe(true);

    // Log shape: root invocation, then assistant(toolCall) + toolResult, all threaded to the root.
    const rows = await loadMessages(conversationId);
    expect(rows.map((r) => r.kind)).toEqual(['toolCall', 'assistant', 'toolResult']);
    const rootId = rows[0].piId;
    expect(rows[1].parentPiId).toBe(rootId);
    expect((rows[2].content as { toolCallId?: string }).toolCallId).toBe(body.toolCallId);
    expect((await getConversation(conversationId))!.runStatus).toBe('remote');
  });

  it('a failing server tool returns isError (recoverable), not a protocol error', async () => {
    const { code } = await mintSession();
    // ExecuteQuery with a connection that doesn't exist → tool-level error.
    const res = await callTool(code, {
      tool: 'ExecuteQuery',
      args: { query: 'SELECT 1', connectionId: 'no_such_connection' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as RemoteToolCallCompleted;
    expect(body.status).toBe('completed');
    expect(body.isError).toBe(true);
  });

  it('rejects unknown tools, agents, ClarifyFrontend, and invalid args with 400', async () => {
    const { code } = await mintSession();
    expect((await callTool(code, { tool: 'NoSuchTool', args: {} })).status).toBe(400);
    expect((await callTool(code, { tool: 'WebAnalystAgent', args: { userMessage: 'hi' } })).status).toBe(400);
    expect((await callTool(code, { tool: 'ClarifyFrontend', args: { question: 'hm' } })).status).toBe(400);
    // Non-coercible arg type (an object can't become the string `query` expects).
    const bad = await callTool(code, { tool: 'SearchFiles', args: { query: { nope: true } } });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(await bad.json())).toMatch(/invalid parameters/i);
  });

  it('frontend-bridged tool → 202 pending; browser completion via turns route unblocks the result (NO LLM)', async () => {
    webAnalystFaux.setResponses([]); // any LLM call would throw loudly
    const { conversationId, code } = await mintSession();
    const res = await callTool(code, {
      tool: 'EditFile',
      args: { fileId: 123, name: 'Renamed' },
      waitMs: 50,
    });
    expect(res.status).toBe(202);
    const pending = (await res.json()) as RemoteToolCallPending;
    expect(pending.status).toBe('pending');

    // Poll: still pending.
    let poll = await resultRoute(
      new NextRequest(`http://localhost:3000/s/${code}/result/${pending.toolCallId}?waitMs=0`),
      resultCtx(code, pending.toolCallId),
    );
    expect(poll.status).toBe(202);

    // Browser posts the completion through the EXISTING turns route → short-circuit (no orchestrator).
    const seqBefore = await getMaxSeq(conversationId);
    const turnRes = await turnsRoute(
      new NextRequest(`http://localhost:3000/api/conversations/${conversationId}/turns`, {
        method: 'POST',
        body: JSON.stringify({
          completedToolCalls: [[
            { id: pending.toolCallId, type: 'function', function: { name: 'EditFile', arguments: { fileId: 123 } } },
            { role: 'tool', tool_call_id: pending.toolCallId, content: 'File renamed.', details: { success: true } },
          ]],
        }),
      }),
      idCtx(conversationId),
    );
    expect(turnRes.status).toBe(200);
    expect(await getMaxSeq(conversationId)).toBe(seqBefore + 1);
    // Still a remote session (the LLM did NOT run and settle the status).
    expect((await getConversation(conversationId))!.runStatus).toBe('remote');

    poll = await resultRoute(
      new NextRequest(`http://localhost:3000/s/${code}/result/${pending.toolCallId}?waitMs=0`),
      resultCtx(code, pending.toolCallId),
    );
    expect(poll.status).toBe(200);
    const done = (await poll.json()) as RemoteToolCallCompleted;
    expect(done.isError).toBe(false);
    expect(done.content[0]).toEqual({ type: 'text', text: 'File renamed.' });

    // Dedupe: replaying the same completion appends nothing.
    const seqAfter = await getMaxSeq(conversationId);
    await turnsRoute(
      new NextRequest(`http://localhost:3000/api/conversations/${conversationId}/turns`, {
        method: 'POST',
        body: JSON.stringify({
          completedToolCalls: [[
            { id: pending.toolCallId, type: 'function', function: { name: 'EditFile', arguments: { fileId: 123 } } },
            { role: 'tool', tool_call_id: pending.toolCallId, content: 'File renamed.', details: { success: true } },
          ]],
        }),
      }),
      idCtx(conversationId),
    );
    expect(await getMaxSeq(conversationId)).toBe(seqAfter);
  });

  it('single-flight: a second call while one is pending → 409', async () => {
    const { code } = await mintSession();
    await callTool(code, { tool: 'EditFile', args: { fileId: 1 }, waitMs: 0 });
    const second = await callTool(code, { tool: 'SearchFiles', args: { query: 'x' }, waitMs: 0 });
    expect(second.status).toBe(409);
  });

  it('turns route refuses user messages and retries while the session is active', async () => {
    const { conversationId } = await mintSession();
    const userMsg = await turnsRoute(
      new NextRequest(`http://localhost:3000/api/conversations/${conversationId}/turns`, {
        method: 'POST', body: JSON.stringify({ userMessage: 'hello?' }),
      }),
      idCtx(conversationId),
    );
    expect(userMsg.status).toBe(409);
    const retry = await turnsRoute(
      new NextRequest(`http://localhost:3000/api/conversations/${conversationId}/turns`, {
        method: 'POST', body: JSON.stringify({ manualRetry: true }),
      }),
      idCtx(conversationId),
    );
    expect(retry.status).toBe(409);
  });

  it('Stop mid-pending-call resolves the dangling call and kills the code', async () => {
    const { conversationId, code } = await mintSession();
    const res = await callTool(code, { tool: 'EditFile', args: { fileId: 5 }, waitMs: 0 });
    const pending = (await res.json()) as RemoteToolCallPending;

    await stopRoute(
      new NextRequest(`http://localhost:3000/api/conversations/${conversationId}/remote-session`, { method: 'DELETE' }),
      idCtx(conversationId),
    );

    const log = await loadLog(conversationId);
    const closure = log.find(
      (e) => (e as { role?: string }).role === 'toolResult'
        && (e as { toolCallId?: string }).toolCallId === pending.toolCallId,
    ) as { isError?: boolean } | undefined;
    expect(closure?.isError).toBe(true);
    expect((await getConversation(conversationId))!.runStatus).toBe('idle');

    const dead = await resultRoute(
      new NextRequest(`http://localhost:3000/s/${code}/result/${pending.toolCallId}`),
      resultCtx(code, pending.toolCallId),
    );
    expect(dead.status).toBe(404);
  });

  it('browser-unreachable: a pending call older than the browser timeout closes with 410', async () => {
    const { conversationId, code } = await mintSession();
    const res = await callTool(code, { tool: 'EditFile', args: { fileId: 9 }, waitMs: 0 });
    const pending = (await res.json()) as RemoteToolCallPending;

    const conversation = (await getConversation(conversationId))!;
    const outcome = await getRemoteToolResult(conversation, pending.toolCallId, { waitMs: 0, browserTimeoutMs: 0 });
    expect(outcome.kind).toBe('browser_unreachable');

    // The dangling call was closed with an isError result so the log stays loadable.
    const log = await loadLog(conversationId);
    const closure = log.find(
      (e) => (e as { role?: string }).role === 'toolResult'
        && (e as { toolCallId?: string }).toolCallId === pending.toolCallId,
    );
    expect(closure).toBeTruthy();
  });

  it('GET /s/<code>/context returns orientation; POST /s/<code>/end ends the session', async () => {
    const { conversationId, code } = await mintSession();
    const ctx = await contextRoute(new NextRequest(`http://localhost:3000/s/${code}/context`), codeCtx(code));
    expect(ctx.status).toBe(200);
    const snapshot = (await ctx.json());
    expect(snapshot.conversationId).toBe(conversationId);
    expect(snapshot.toolNames).toContain('ExecuteQuery');
    expect(snapshot.toolNames).not.toContain('ClarifyFrontend');

    const end = await endRoute(new NextRequest(`http://localhost:3000/s/${code}/end`, { method: 'POST' }), codeCtx(code));
    expect(end.status).toBe(200);
    expect((await getConversation(conversationId))!.runStatus).toBe('idle');
    const doc = await skillDocRoute(new NextRequest(`http://localhost:3000/s/${code}`), codeCtx(code));
    expect(doc.status).toBe(410);
  });

  it('LOG INVARIANT: after a remote session, a normal faux-LLM turn on the same conversation works', async () => {
    const { conversationId, code } = await mintSession();
    await callTool(code, { tool: 'SearchFiles', args: { query: 'mrr' } });
    await endRoute(new NextRequest(`http://localhost:3000/s/${code}/end`, { method: 'POST' }), codeCtx(code));

    webAnalystFaux.setResponses([fauxAssistantMessage('All good.', { stopReason: 'stop' })]);
    const turnRes = await turnsRoute(
      new NextRequest(`http://localhost:3000/api/conversations/${conversationId}/turns`, {
        method: 'POST', body: JSON.stringify({ userMessage: 'summarize what you did' }),
      }),
      idCtx(conversationId),
    );
    expect(turnRes.status).toBe(200);

    // Wait for the detached turn to settle.
    const start = Date.now();
    for (;;) {
      const c = await getConversation(conversationId);
      if (c && c.runStatus === 'idle' && (await getMaxSeq(conversationId)) >= 4) break;
      if (c?.runStatus === 'error') throw new Error('normal turn errored after remote session');
      if (Date.now() - start > 5000) throw new Error(`turn did not settle (status=${c?.runStatus})`);
      await new Promise((r) => setTimeout(r, 25));
    }
    const log = await loadLog(conversationId);
    const last = log[log.length - 1] as { role?: string; content?: Array<{ type: string; text?: string }> };
    expect(last.role).toBe('assistant');
    expect(last.content?.[0]?.text).toBe('All good.');
  });
});
