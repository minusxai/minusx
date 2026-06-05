/**
 * Verifies that orchestration failures get appended to the conversation document's
 * `errors[]` array as structured `ErrorLogEntry` records — so failures survive page
 * reload and render as distinct ErrorMessage rows in the UI.
 *
 * One `it()` per error source (TDD: red → minimum implementation → green per cycle).
 * Cycles in order:
 *   1. LLM call failure  → source: 'llm'
 *   2. Server tool throw → source: 'server-tool'
 *   3. Frontend-bridged tool returns success:false → source: 'frontend-tool'
 */

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));
vi.mock('@/lib/connections/run-query', () => ({ runQuery: vi.fn(async () => ({ columns: [], types: [], rows: [], finalQuery: '' })) }));
vi.mock('@/lib/connections/load-schema', () => ({ loadConnectionSchema: vi.fn(async () => []) }));

import { fauxAssistantMessage, fauxToolCall } from '@/orchestrator/llm/testing';
import { fauxRegistration as onboardingFaux } from '@/agents/onboarding/onboarding-agents';
import { POST as chatPostHandler } from '@/app/api/chat/route';
import { POST as logErrorHandler } from '@/app/api/chat/log-error/route';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { NextRequest } from 'next/server';

const TEST_DB_PATH = getTestDbPath('chat_turn_error_log');

function makeRequest(url: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

async function readConversation(conversationID: number) {
  const { DocumentDB } = await import('@/lib/database/documents-db');
  const doc = await DocumentDB.getById(conversationID);
  return doc!.content as { log: unknown[]; errors?: Array<Record<string, unknown>> };
}

describe('POST /api/chat — errors persisted to conversation.errors[]', () => {
  setupTestDb(TEST_DB_PATH);
  beforeEach(() => onboardingFaux.setResponses([]));

  it('Cycle 1: LLM call failure is logged with source:"llm" and the error message', async () => {
    onboardingFaux.setResponses([
      () => { throw new Error('synthetic LLM failure'); },
    ]);

    const res = await chatPostHandler(
      makeRequest('http://localhost/api/chat?v=2', {
        agent: 'OnboardingContextAgent',
        user_message: 'Document the schema',
        agent_args: {
          connection_id: 'db',
          schema: [{ schema: 'main', tables: ['orders'] }],
          context: '',
          app_state: { type: 'file' },
        },
      }),
    );

    const body = await res.json();
    // Pre-existing: response carries the error (we don't change that).
    expect(body.error).toBeTruthy();
    expect(String(body.error)).toContain('synthetic LLM failure');

    // NEW: the conversation document persists a structured error entry.
    const conversationID = body.conversationID as number;
    expect(typeof conversationID).toBe('number');
    const content = await readConversation(conversationID);

    expect(Array.isArray(content.errors)).toBe(true);
    expect(content.errors).toHaveLength(1);
    const entry = content.errors![0];
    expect(entry).toMatchObject({ _type: 'error', source: 'llm' });
    expect(String(entry.message)).toContain('synthetic LLM failure');
    expect(typeof entry.timestamp).toBe('number');
  });

  it('LLM call failure fills the error column on the failed call\'s llm_logs row', async () => {
    onboardingFaux.setResponses([
      () => { throw new Error('synthetic LLM failure'); },
    ]);

    const res = await chatPostHandler(
      makeRequest('http://localhost/api/chat?v=2', {
        agent: 'OnboardingContextAgent',
        user_message: 'Document the schema',
        agent_args: {
          connection_id: 'db',
          schema: [{ schema: 'main', tables: ['orders'] }],
          context: '',
          app_state: { type: 'file' },
        },
      }),
    );
    expect((await res.json()).error).toBeTruthy();

    // The request was written when the call was made; the error column is filled
    // in from the boundary (the engine discards the failed message). The writes
    // are fire-and-forget, so poll briefly.
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
    // LLM calls a tool the agent doesn't have — orchestrator writes a
    // toolResult{isError:true, content:"Unknown tool ..."} to the pi-ai log,
    // and we mirror it as an errors[] entry for UI visibility.
    onboardingFaux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall('NonExistentTool', { foo: 1 }, { id: 'tc_unknown_007' })],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('done', { stopReason: 'stop' }),
    ]);

    const res = await chatPostHandler(
      makeRequest('http://localhost/api/chat?v=2', {
        agent: 'OnboardingContextAgent',
        user_message: 'Use a missing tool',
        agent_args: {
          connection_id: 'db',
          schema: [{ schema: 'main', tables: ['orders'] }],
          context: '',
          app_state: { type: 'file' },
        },
      }),
    );

    const body = await res.json();
    expect(body.conversationID).toBeDefined();
    const content = await readConversation(body.conversationID as number);

    expect(Array.isArray(content.errors)).toBe(true);
    expect(content.errors).toHaveLength(1);
    const entry = content.errors![0] as Record<string, any>;
    expect(entry).toMatchObject({ _type: 'error', source: 'server-tool' });
    expect(String(entry.message)).toMatch(/Unknown tool/i);
    expect(entry.details?.tool_name).toBe('NonExistentTool');
    expect(entry.details?.tool_call_id).toBe('tc_unknown_007');
    expect(typeof entry.timestamp).toBe('number');
  });

  it('Cycle 3: frontend-tool error (success:false in toolResult content) is logged with source:"frontend-tool"', async () => {
    // EditFile is a frontend-bridged tool. The orchestrator dispatches it,
    // it throws UserInputException → pauses. The frontend bridge sends back
    // `{success:false, error: "String ... not found"}` (the production EditFile
    // failure shape — content.success===false, NOT isError:true). We mirror
    // these as `source:'frontend-tool'` errors so the UI surfaces them.
    onboardingFaux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall('EditFile', { fileId: 1, changes: [{ oldMatch: 'x', newMatch: 'y' }] }, { id: 'tc_edit_001' })],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('acknowledged', { stopReason: 'stop' }),
    ]);

    // Turn 1: agent emits the EditFile, orchestrator pauses (UIE).
    const res1 = await chatPostHandler(
      makeRequest('http://localhost/api/chat?v=2', {
        agent: 'OnboardingContextAgent',
        user_message: 'edit something',
        agent_args: { connection_id: 'db', schema: [], context: '', app_state: { type: 'file' } },
      }),
    );
    const body1 = await res1.json();
    expect(body1.pending_tool_calls.length).toBeGreaterThan(0);
    const pending = body1.pending_tool_calls[0];
    expect(pending.function.name).toBe('EditFile');
    const conversationID = body1.conversationID as number;
    const logIndex = body1.log_index as number;

    // Turn 2: client returns the frontend-bridge's success:false result.
    const errorContent = JSON.stringify({ success: false, error: 'String "x" not found in file' });
    const completedResult = {
      role: 'tool',
      tool_call_id: pending.id,
      content: errorContent,
      function: pending.function,
      created_at: new Date().toISOString(),
      run_id: '',
    };
    await chatPostHandler(
      makeRequest('http://localhost/api/chat?v=2', {
        conversationID,
        log_index: logIndex,
        completed_tool_calls: [[pending, completedResult]],
        agent: 'OnboardingContextAgent',
        agent_args: { connection_id: 'db', schema: [], context: '', app_state: { type: 'file' } },
      }),
    );

    const content = await readConversation(conversationID);
    expect(Array.isArray(content.errors)).toBe(true);
    const frontendError = content.errors!.find((e: Record<string, any>) => e.source === 'frontend-tool') as Record<string, any> | undefined;
    expect(frontendError).toBeDefined();
    expect(String(frontendError!.message)).toMatch(/not found/i);
    expect(frontendError!.details?.tool_name).toBe('EditFile');
    expect(frontendError!.details?.tool_call_id).toBe('tc_edit_001');
    expect(typeof frontendError!.timestamp).toBe('number');
  });

  it('Cycle 4: POST /api/chat/log-error appends the client-supplied entry to errors[]', async () => {
    // Create a conversation directly (the endpoint just appends — doesn't run chat).
    const { createNewConversation } = await import('@/lib/conversations');
    const { fileId } = await createNewConversation(
      { userId: 1, email: 'test@example.com', name: 'Test', role: 'admin', home_folder: '/org', mode: 'org' } as any,
      'log-error endpoint test',
    );

    const payload = {
      conversationID: fileId,
      error: {
        _type: 'error',
        source: 'transport',
        message: 'fetch failed (ECONNREFUSED)',
        timestamp: 1700000000000,
        details: { http_status: 502, retry_count: 1 },
      },
    };
    const res = await logErrorHandler(makeRequest('http://localhost/api/chat/log-error', payload), {} as any);
    expect(res.status).toBe(200);

    const content = await readConversation(fileId);
    expect(Array.isArray(content.errors)).toBe(true);
    expect(content.errors).toHaveLength(1);
    const entry = content.errors![0] as Record<string, any>;
    expect(entry).toMatchObject({ _type: 'error', source: 'transport', message: 'fetch failed (ECONNREFUSED)', timestamp: 1700000000000 });
    expect(entry.details).toMatchObject({ http_status: 502, retry_count: 1 });
  });

  it('Cycle 8: logTaggedRejection appends source:"unhandled" when the error carries a conversationId tag', async () => {
    const { logTaggedRejection } = await import('@/lib/api/unhandled-rejection-logger');
    const { createNewConversation } = await import('@/lib/conversations');
    const user = { userId: 1, email: 'test@example.com', name: 'Test', role: 'admin', home_folder: '/org', mode: 'org' } as any;
    const { fileId } = await createNewConversation(user, 'cycle 8 unhandled rejection');

    const tagged = Object.assign(new Error('background task crashed: foo is undefined'), { conversationId: fileId });
    await logTaggedRejection(tagged, user);

    const content = await readConversation(fileId);
    expect(Array.isArray(content.errors)).toBe(true);
    expect(content.errors).toHaveLength(1);
    const entry = content.errors![0] as Record<string, any>;
    expect(entry).toMatchObject({ _type: 'error', source: 'unhandled' });
    expect(String(entry.message)).toContain('background task crashed');
    expect(typeof entry.timestamp).toBe('number');
  });

  it('Cycle 8: logTaggedRejection is a no-op when the error has no conversationId tag', async () => {
    const { logTaggedRejection } = await import('@/lib/api/unhandled-rejection-logger');
    const { createNewConversation } = await import('@/lib/conversations');
    const user = { userId: 1, email: 'test@example.com', name: 'Test', role: 'admin', home_folder: '/org', mode: 'org' } as any;
    const { fileId } = await createNewConversation(user, 'cycle 8 untagged rejection');

    await logTaggedRejection(new Error('untagged'), user);
    const content = await readConversation(fileId);
    expect(content.errors ?? []).toHaveLength(0);
  });
});
