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
});
