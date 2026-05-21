// v=2 chat must use the CLIENT-RESOLVED context (the context file the user
// selected in the UI, sent verbatim in agent_args.context), matching the Python
// backend (self.context = agent_args.context). Previously the v2 server ignored
// agent_args.context and re-resolved from the user's home folder, so the
// selected context never took effect.

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

import { fauxAssistantMessage } from '@/orchestrator/llm/testing';
import { fauxRegistration as webAnalystFaux } from '@/agents/web-analyst/web-analyst';
import { POST as chatPostHandler } from '@/app/api/chat/route';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { NextRequest } from 'next/server';

const TEST_DB_PATH = getTestDbPath('chat_v2_context_selection');

function makeRequest(url: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/chat?v=2 — honors the selected context', () => {
  setupTestDb(TEST_DB_PATH);

  it("injects the client-resolved agent_args.context into the agent's system prompt", async () => {
    const MARKER = 'SELECTED_CONTEXT_MARKER_7f3a';
    let capturedSystemPrompt = '';

    // Faux response factory: capture the system prompt the agent built, then reply.
    webAnalystFaux.setResponses([
      (context) => {
        capturedSystemPrompt = context.systemPrompt ?? '';
        return fauxAssistantMessage('ok', { stopReason: 'stop' });
      },
    ]);

    const res = await chatPostHandler(
      makeRequest('http://localhost/api/chat?v=2', {
        user_message: 'What is in your context file?',
        agent_args: { context: `# Knowledge Base\n${MARKER}` },
      }),
    );

    expect(res.status).toBe(200);
    // The client-sent context (and its marker) must appear in the system prompt.
    expect(capturedSystemPrompt).toContain(MARKER);
  });
});
