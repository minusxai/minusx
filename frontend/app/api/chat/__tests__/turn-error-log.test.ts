/**
 * Verifies that orchestration failures get mirrored to the conversation's error stream
 * (kind='error' rows in `messages`, v3) as structured records — so failures survive page
 * reload and render as distinct ErrorMessage rows in the UI.
 *
 * One `it()` per error source:
 *   1. LLM call failure  → source: 'llm'  (+ the failed call's llm_logs row carries the error)
 *   2. Server tool throw → source: 'server-tool'
 *   3. Frontend-bridged tool returns success:false → source: 'frontend-tool'
 *   4. POST /api/chat/log-error appends a client-supplied entry
 *   5. logTaggedRejection appends source:'unhandled' (and no-ops when untagged)
 */

vi.mock('@/lib/connections/run-query', () => ({ runQuery: vi.fn(async () => ({ columns: [], types: [], rows: [], finalQuery: '' })) }));
vi.mock('@/lib/connections/load-schema', () => ({ loadConnectionSchema: vi.fn(async () => []) }));

import { fauxAssistantMessage, fauxToolCall } from '@/orchestrator/llm/testing';
import { fauxRegistration as onboardingFaux } from '@/agents/onboarding/onboarding-agents';
import { POST as logErrorHandler } from '@/app/api/chat/log-error/route';
import { runConversationTurn } from '@/lib/chat/conversation-turn.server';
import { createConversation, loadErrors } from '@/lib/data/conversations.server';
import type { ChatRequest } from '@/lib/chat/chat-types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { NextRequest } from 'next/server';

const TEST_DB_PATH = getTestDbPath('chat_turn_error_log');
const USER = { userId: 1, email: 'test@example.com', name: 'Test', role: 'admin', home_folder: '/org', mode: 'org' } as EffectiveUser;

function turnBody(userMessage: string, extra: Partial<ChatRequest> = {}): ChatRequest {
  return {
    user_message: userMessage,
    agent: 'OnboardingContextAgent',
    agent_args: {
      connection_id: 'db',
      schema: [{ schema: 'main', tables: ['orders'] }],
      context: '',
      app_state: { type: 'file' },
    },
    ...extra,
  } as unknown as ChatRequest;
}

async function newConversation(title: string): Promise<number> {
  const conv = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'OnboardingContextAgent', title });
  return conv.id;
}

function makeRequest(url: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('v3 turn — errors mirrored to the conversation error stream', () => {
  setupTestDb(TEST_DB_PATH);
  beforeEach(() => onboardingFaux.setResponses([]));

  it('Cycle 1: LLM call failure is logged with source:"llm" and the error message', async () => {
    onboardingFaux.setResponses([
      () => { throw new Error('synthetic LLM failure'); },
    ]);

    const conversationID = await newConversation('llm failure');
    const result = await runConversationTurn(conversationID, USER, turnBody('Document the schema'));

    expect(result.runStatus).toBe('error');
    expect(String(result.error)).toContain('synthetic LLM failure');

    const errors = await loadErrors(conversationID);
    expect(errors).toHaveLength(1);
    expect(errors[0].source).toBe('llm');
    expect(String(errors[0].message)).toContain('synthetic LLM failure');
  });

  it('LLM call failure fills the error column on the failed call\'s llm_logs row', async () => {
    onboardingFaux.setResponses([
      () => { throw new Error('synthetic LLM failure'); },
    ]);

    const conversationID = await newConversation('llm failure logs');
    await runConversationTurn(conversationID, USER, turnBody('Document the schema'));

    // Writes are fire-and-forget, so poll briefly.
    const { getModules } = await import('@/lib/modules/registry');
    let row: Record<string, unknown> | undefined;
    for (let i = 0; i < 40 && !row; i++) {
      const r = await getModules().db.exec<Record<string, unknown>>(
        `SELECT request_json, error FROM llm_logs WHERE error IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
      );
      row = r.rows[0];
      if (!row) await new Promise((res) => setTimeout(res, 25));
    }
    expect(row, 'a failed call should leave an llm_logs row with the error column set').toBeTruthy();
    expect(String(row!['error'])).toContain('synthetic LLM failure');
    expect(row!['request_json'], 'the request is stored even on failure').toBeTruthy();
  });

  it('Cycle 2: server-tool error (unknown tool) is mirrored with source:"server-tool"', async () => {
    onboardingFaux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall('NonExistentTool', { foo: 1 }, { id: 'tc_unknown_007' })],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('done', { stopReason: 'stop' }),
    ]);

    const conversationID = await newConversation('server tool error');
    await runConversationTurn(conversationID, USER, turnBody('Use a missing tool'));

    const errors = await loadErrors(conversationID);
    expect(errors).toHaveLength(1);
    expect(errors[0].source).toBe('server-tool');
    expect(String(errors[0].message)).toMatch(/Unknown tool/i);
    expect(errors[0].details?.tool_name).toBe('NonExistentTool');
    expect(errors[0].details?.tool_call_id).toBe('tc_unknown_007');
  });

  it('Cycle 3: frontend-tool error (success:false in toolResult content) is logged with source:"frontend-tool"', async () => {
    onboardingFaux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall('EditFile', { fileId: 1, changes: [{ oldMatch: 'x', newMatch: 'y' }] }, { id: 'tc_edit_001' })],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('acknowledged', { stopReason: 'stop' }),
    ]);

    const conversationID = await newConversation('frontend tool error');

    // Turn 1: agent emits the EditFile, orchestrator pauses (UserInputException).
    const r1 = await runConversationTurn(conversationID, USER, turnBody('edit something', {
      agent_args: { connection_id: 'db', schema: [], context: '', app_state: { type: 'file' } } as never,
    }));
    expect(r1.runStatus).toBe('paused');
    expect(r1.pendingToolCalls.length).toBeGreaterThan(0);
    const pending = r1.pendingToolCalls[0];
    expect(pending.name).toBe('EditFile');

    // Turn 2: client returns the frontend-bridge's success:false result. Rebuild the legacy
    // [toolCall, result] tuple shape the resume path expects from the orchestrator PendingToolCall.
    const legacyToolCall = { id: pending.id, function: { name: pending.name, arguments: JSON.stringify(pending.parameters) } };
    const errorContent = JSON.stringify({ success: false, error: 'String "x" not found in file' });
    const completedResult = {
      role: 'tool',
      tool_call_id: pending.id,
      content: errorContent,
      function: legacyToolCall.function,
      created_at: new Date().toISOString(),
      run_id: '',
    };
    await runConversationTurn(conversationID, USER, {
      agent: 'OnboardingContextAgent',
      completed_tool_calls: [[legacyToolCall, completedResult]],
      agent_args: { connection_id: 'db', schema: [], context: '', app_state: { type: 'file' } },
    } as unknown as ChatRequest);

    const errors = await loadErrors(conversationID);
    const frontendError = errors.find((e) => e.source === 'frontend-tool');
    expect(frontendError).toBeDefined();
    expect(String(frontendError!.message)).toMatch(/not found/i);
    expect(frontendError!.details?.tool_name).toBe('EditFile');
    expect(frontendError!.details?.tool_call_id).toBe('tc_edit_001');
  });

  it('Cycle 4: POST /api/chat/log-error appends the client-supplied entry', async () => {
    const conversationID = await newConversation('log-error endpoint test');

    const payload = {
      conversationID,
      error: {
        _type: 'error',
        source: 'transport',
        message: 'fetch failed (ECONNREFUSED)',
        timestamp: 1700000000000,
        details: { http_status: 502, retry_count: 1 },
      },
    };
    const res = await logErrorHandler(makeRequest('http://localhost/api/chat/log-error', payload), {} as never);
    expect(res.status).toBe(200);

    const errors = await loadErrors(conversationID);
    expect(errors).toHaveLength(1);
    expect(errors[0].source).toBe('transport');
    expect(errors[0].message).toBe('fetch failed (ECONNREFUSED)');
    expect(errors[0].details).toMatchObject({ http_status: 502, retry_count: 1 });
  });

  it('Cycle 5: logTaggedRejection appends source:"unhandled" when the error carries a conversationId tag', async () => {
    const { logTaggedRejection } = await import('@/lib/messaging/unhandled-rejection-logger');
    const conversationID = await newConversation('cycle 5 unhandled rejection');

    const tagged = Object.assign(new Error('background task crashed: foo is undefined'), { conversationId: conversationID });
    await logTaggedRejection(tagged);

    const errors = await loadErrors(conversationID);
    expect(errors).toHaveLength(1);
    expect(errors[0].source).toBe('unhandled');
    expect(String(errors[0].message)).toContain('background task crashed');
  });

  it('Cycle 5: logTaggedRejection is a no-op when the error has no conversationId tag', async () => {
    const { logTaggedRejection } = await import('@/lib/messaging/unhandled-rejection-logger');
    const conversationID = await newConversation('cycle 5 untagged rejection');

    await logTaggedRejection(new Error('untagged'));
    expect(await loadErrors(conversationID)).toHaveLength(0);
  });
});
