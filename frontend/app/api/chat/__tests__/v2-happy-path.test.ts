// Full v=2 happy-path integration test for /api/chat?v=2.
//
// Validates:
//   1. POST /api/chat?v=2 with `user_message` (no conversationID) creates
//      a fresh v=2 conversation file, runs the orchestrator (faux LLM),
//      and returns a legacy `ChatResponse`.
//   2. The persisted file has `meta.version === 2` and `content.log` in
//      orchestrator log shape.
//   3. The conversation file is renamed from "New Conversation" to a
//      preview of the first user message (the v=2 rename fix).
//   4. The legacy `completed_tool_calls` field carries the assistant's
//      reply (translated TalkToUser tool entry).
//   5. The frontend never sees orchestrator log shape — the response is in legacy
//      ChatResponse shape with debug entries derived from orchestrator usage.

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

import { fauxAssistantMessage } from '@/orchestrator/llm/testing';
import { fauxRegistration as webAnalystFaux } from '@/agents/web-analyst/web-analyst';
import { POST as chatPostHandler } from '@/app/api/chat/route';
import { FilesAPI } from '@/lib/data/files.server';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { NextRequest } from 'next/server';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const TEST_DB_PATH = getTestDbPath('chat_v2_happy_path');

const ADMIN: EffectiveUser = {
  userId: 1,
  email: 'test@example.com',
  name: 'Test User',
  role: 'admin',
  home_folder: '/org',
  mode: 'org',
};

function makeRequest(url: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

interface LegacyChatResponse {
  conversationID: number;
  log_index: number;
  pending_tool_calls: Array<{ id: string; type: string; function: { name: string; arguments: Record<string, unknown> } }>;
  completed_tool_calls: Array<{
    role: 'tool';
    tool_call_id: string;
    content: string;
    function: { name: string; arguments: Record<string, unknown> };
  }>;
  debug: Array<{ role: 'debug'; llmDebug: Array<{ total_tokens: number }> }>;
  error?: string;
}

describe('POST /api/chat?v=2 — happy path (orchestrator runs, response is legacy shape)', () => {
  setupTestDb(TEST_DB_PATH);

  it('first turn: creates v=2 conversation, runs orchestrator, returns legacy ChatResponse, renames file, persists orchestrator log', async () => {
    // Faux LLM auto-computes its own usage from prompt + response size; we
    // don't override (test asserts presence, not exact values).
    webAnalystFaux.setResponses([
      fauxAssistantMessage('Sure, here is what you asked.', { stopReason: 'stop' }),
    ]);

    const userMessage = 'What is the latest revenue';
    const res = await chatPostHandler(
      makeRequest('http://localhost/api/chat?v=2', { user_message: userMessage }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as LegacyChatResponse;

    expect(body.error).toBeUndefined();
    expect(body.conversationID).toBeGreaterThan(0);

    // Legacy ChatResponse shape — the response carries completed_tool_calls
    // (translated from the assistant text), NOT orchestrator entries.
    expect(body.completed_tool_calls.length).toBeGreaterThan(0);
    const ttu = body.completed_tool_calls.find((c) => c.function.name === 'TalkToUser');
    expect(ttu).toBeDefined();
    // v=1-compatible format: result is a JSON-stringified `{ success,
    // content_blocks }` object so the frontend's ContentDisplay parses it
    // and routes thinking/text blocks correctly.
    const parsed = JSON.parse(String(ttu!.content));
    expect(parsed).toMatchObject({
      success: true,
      content_blocks: [{ type: 'text', text: 'Sure, here is what you asked.' }],
    });

    // No pending frontend tools (this turn was a stop).
    expect(body.pending_tool_calls).toEqual([]);

    // Debug entries derived from orchestrator usage. The faux LLM auto-computes
    // its own token counts from prompt + response, so we don't assert the
    // exact value — only that the debug pipeline carries SOME usage.
    expect(body.debug.length).toBeGreaterThan(0);
    expect(body.debug[0].llmDebug[0].total_tokens).toBeGreaterThan(0);

    // DB side: conversation file is type='conversation' with meta.version=2,
    // and the on-disk content.log is the orchestrator log shape (not legacy).
    const file = await FilesAPI.loadFile(body.conversationID, ADMIN);
    const meta = (file.data as { meta?: Record<string, unknown> }).meta;
    expect(meta?.version).toBe(2);
    expect(file.data.type).toBe('conversation');

    const content = file.data.content as unknown as { log: Array<{ type?: string; role?: string; parent_id?: string | null }> };
    // Orchestrator log shape: root invocation has `type: 'toolCall'`, assistant has `role: 'assistant'`.
    expect(content.log.length).toBeGreaterThanOrEqual(2);
    const root = content.log[0];
    expect(root.type).toBe('toolCall');
    expect(root.parent_id).toBeNull();
    const assistant = content.log[1];
    expect(assistant.role).toBe('assistant');

    // V=2 conversation file's display name (in `content.metadata.name`) is
    // set to the first user message preview, matching v=1 conventions —
    // NOT left as the default "New Conversation".
    const metadata = (file.data.content as unknown as { metadata?: { name?: string } }).metadata;
    expect(metadata?.name).toBe(userMessage);
  });

  it('forks ?v=2 against an existing v=1 conversation and continues in v=2 (original preserved)', async () => {
    // A v=1 conversation with a prior turn, so the seed carries history.
    const created = await FilesAPI.createFile(
      {
        name: 'legacy',
        path: '/org/logs/conversations/1/legacy.chat.json',
        type: 'conversation',
        content: {
          metadata: { userId: '1', name: 'legacy', createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z', logLength: 3 },
          log: [
            { _type: 'task', _run_id: 'run-r1', agent: 'AnalystAgent', args: { user_message: 'earlier q' }, unique_id: 'r1', created_at: '2025-01-01T00:00:00Z' },
            { _type: 'task', _run_id: 'run-ttu1', _parent_unique_id: 'r1', agent: 'TalkToUser', args: { content_blocks: [{ type: 'text', text: 'earlier a' }] }, unique_id: 'ttu1', created_at: '2025-01-01T00:00:00Z' },
            { _type: 'task_result', _task_unique_id: 'ttu1', result: '{"success":true,"content_blocks":[{"type":"text","text":"earlier a"}]}', created_at: '2025-01-01T00:00:00Z' },
          ],
        } as never,
        options: { createPath: true, returnExisting: false },
      },
      ADMIN,
    );

    webAnalystFaux.setResponses([fauxAssistantMessage('continuing the old chat.', { stopReason: 'stop' })]);

    const res = await chatPostHandler(
      makeRequest('http://localhost/api/chat?v=2', {
        conversationID: created.data.id,
        user_message: 'continue',
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // Forked: the response carries a NEW conversation id, not the v1 one.
    expect(body.conversationID).not.toBe(created.data.id);

    // The fork is a v=2 conversation seeded from the v1 log.
    const forked = await FilesAPI.loadFile(body.conversationID as number, ADMIN);
    const forkedMeta = forked.data.meta as { version?: number; forkedFrom?: number };
    expect(forkedMeta.version).toBe(2);
    expect(forkedMeta.forkedFrom).toBe(created.data.id);

    // Original v1 is untouched (still v1, still its 3-entry legacy log).
    const original = await FilesAPI.loadFile(created.data.id, ADMIN);
    expect((original.data.meta as { version?: number } | null)?.version).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((original.data.content as any).log).toHaveLength(3);
  });
});
