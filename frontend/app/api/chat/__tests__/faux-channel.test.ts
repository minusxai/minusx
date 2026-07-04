// The E2E faux LLM channel driving the REAL v3 turn runner in-process
// (Tests/QA/Evals Arch V2). Proves: DTO → matcher install, the matcher drives the
// real orchestrator's reply, requests are recorded, and reset clears them.
// (The HTTP routes are thin E2E-gated wrappers over these channel functions;
// they're exercised for real by Playwright.)

import { fauxRegistration as webAnalystFaux } from '@/agents/web-analyst/web-analyst';
import { runConversationTurn } from '@/lib/chat/conversation-turn.server';
import { createConversation, loadLog } from '@/lib/data/conversations.server';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import {
  configureFauxFromDTO,
  getReceived,
  resetFaux,
  setFauxTargets,
} from '@/lib/test/faux-llm-channel.server';
import type { ChatRequest } from '@/lib/chat-orchestration';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const TEST_DB_PATH = getTestDbPath('faux_channel');
const USER = { userId: 1, email: 'test@example.com', name: 'Test', role: 'admin', home_folder: '/org', mode: 'org' } as EffectiveUser;

const turnBody = (userMessage: string): ChatRequest =>
  ({ user_message: userMessage, agent: 'WebAnalystAgent', agent_args: {} } as unknown as ChatRequest);

async function runTurn(userMessage: string) {
  const conv = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
  const result = await runConversationTurn(conv.id, USER, turnBody(userMessage));
  const log = await loadLog(conv.id);
  return { result, log };
}

/** Extract all assistant text from a pi log. */
function assistantText(log: unknown[]): string {
  const parts: string[] = [];
  for (const raw of log) {
    const e = raw as { role?: string; content?: unknown };
    if (e.role !== 'assistant') continue;
    if (typeof e.content === 'string') parts.push(e.content);
    else if (Array.isArray(e.content)) {
      for (const b of e.content as Array<{ type?: string; text?: string }>) {
        if (b?.type === 'text' && typeof b.text === 'string') parts.push(b.text);
      }
    }
  }
  return parts.join('\n');
}

describe('E2E faux LLM channel → real v3 turn runner', () => {
  setupTestDb(TEST_DB_PATH);

  beforeEach(() => {
    setFauxTargets([webAnalystFaux]); // isolate to the chat agent
    resetFaux();
  });

  it('drives the real chat reply from a serializable DTO and records the request', async () => {
    const userMessage = 'What is the latest revenue';
    configureFauxFromDTO([{ userMessage, response: { kind: 'text', text: 'Faux says hi.' } }]);

    const { result, log } = await runTurn(userMessage);
    expect(result.error).toBeUndefined();

    // The matcher (not a sequential queue) produced the reply.
    expect(assistantText(log)).toContain('Faux says hi.');

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

    const { result, log } = await runTurn('this prompt was never registered');

    // No matching faux response → the run surfaces an error rather than a reply.
    expect(result.runStatus === 'error' || assistantText(log).length === 0).toBe(true);

    // The unexpected call was still recorded.
    expect(getReceived().some((r) => r.userMessage.includes('never registered'))).toBe(true);
  });
});
