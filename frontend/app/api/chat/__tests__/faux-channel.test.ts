// Phase 3 — the E2E faux LLM channel driving the REAL /api/chat route in-process
// (Tests/QA/Evals Arch V2). Proves: DTO → matcher install, the matcher drives the
// real orchestrator's reply, requests are recorded, and reset clears them.
// (The HTTP routes are thin E2E-gated wrappers over these channel functions;
// they're exercised for real by Playwright in Phase 4.)

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

import { fauxRegistration as webAnalystFaux } from '@/agents/web-analyst/web-analyst';
import { POST as chatPostHandler } from '@/app/api/chat/route';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import {
  configureFauxFromDTO,
  getReceived,
  resetFaux,
  setFauxTargets,
} from '@/lib/test/faux-llm-channel.server';
import { NextRequest } from 'next/server';

const TEST_DB_PATH = getTestDbPath('faux_channel');

interface ChatResponse {
  completed_tool_calls: Array<{ content: string; function: { name: string } }>;
  error?: string;
}

function chatRequest(userMessage: string): NextRequest {
  return new NextRequest('http://localhost/api/chat?v=2', {
    method: 'POST',
    body: JSON.stringify({ user_message: userMessage }),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('E2E faux LLM channel → real /api/chat route', () => {
  setupTestDb(TEST_DB_PATH);

  beforeEach(() => {
    setFauxTargets([webAnalystFaux]); // isolate to the chat route's agent
    resetFaux();
  });

  it('drives the real chat reply from a serializable DTO and records the request', async () => {
    const userMessage = 'What is the latest revenue';
    configureFauxFromDTO([{ userMessage, response: { kind: 'text', text: 'Faux says hi.' } }]);

    const res = await chatPostHandler(chatRequest(userMessage));
    expect(res.status).toBe(200);
    const body = (await res.json()) as ChatResponse;
    expect(body.error).toBeUndefined();

    // The matcher (not a sequential queue) produced the reply.
    const ttu = body.completed_tool_calls.find((c) => c.function.name === 'TalkToUser');
    expect(ttu).toBeDefined();
    expect(JSON.parse(String(ttu!.content))).toMatchObject({
      content_blocks: [{ type: 'text', text: 'Faux says hi.' }],
    });

    // The request the model was sent was recorded (assert-what-it-received).
    const received = getReceived();
    expect(received.length).toBeGreaterThan(0);
    expect(received[0].userMessage).toContain(userMessage);

    // Reset clears recordings.
    resetFaux();
    expect(getReceived()).toHaveLength(0);
  });

  it('fails loud when the chat sends an unregistered message (matcher throws → orchestrator errors)', async () => {
    configureFauxFromDTO([{ userMessage: 'a totally different prompt', response: { kind: 'text', text: 'x' } }]);

    const res = await chatPostHandler(chatRequest('this prompt was never registered'));
    const body = (await res.json()) as ChatResponse;

    // No matching faux response → the run surfaces an error rather than a reply.
    const repliedNormally = body.completed_tool_calls?.some((c) => c.function.name === 'TalkToUser');
    expect(body.error !== undefined || !repliedNormally).toBe(true);

    // The unexpected call was still recorded.
    expect(getReceived().some((r) => r.userMessage.includes('never registered'))).toBe(true);
  });
});
