/**
 * Silent auto-retry of a TRANSIENT LLM stream/transport drop in the v3 turn runner.
 *
 * Production symptom (Starlight): "OpenAI Responses stream ended before a terminal response event"
 * — a premature upstream SSE close — surfaced straight to the user and flooded the error channel,
 * because nothing retried the dead turn. This suite pins the fix:
 *   1. a transient stream drop is silently replayed (no error surfaced) and the retry can succeed;
 *   2. after MAX_AUTO_RETRIES consecutive transient failures we give up and DO mirror the real error;
 *   3. a TERMINAL error (context-length) is never retried — surfaces on the first attempt;
 *   4. a RESUME turn (frontend-tool completion) is never silently replayed — mirrors the real error
 *      (rolling back a half-applied frontend-tool resume is unsafe; same rule as prepareAutoRetry).
 *
 * Mirrors the harness in turn-error-log.test.ts: drive runConversationTurn directly with a faux LLM,
 * assert runStatus + the mirrored error stream (loadErrors).
 */

vi.mock('@/lib/connections/run-query', () => ({ runQuery: vi.fn(async () => ({ columns: [], types: [], rows: [], finalQuery: '' })) }));
vi.mock('@/lib/connections/load-schema', () => ({ loadConnectionSchema: vi.fn(async () => []) }));

import { fauxAssistantMessage, fauxToolCall } from '@/orchestrator/llm/testing';
import { fauxRegistration as onboardingFaux } from '@/agents/onboarding/onboarding-agents';
import { runConversationTurn } from '@/lib/chat/conversation-turn.server';
import { createConversation, getConversation, loadErrors, MAX_AUTO_RETRIES } from '@/lib/data/conversations.server';
import type { ChatRequest } from '@/lib/chat/chat-types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';

const TEST_DB_PATH = getTestDbPath('chat_turn_autoretry');
const USER = { userId: 1, email: 'test@example.com', name: 'Test', role: 'admin', home_folder: '/org', mode: 'org' } as EffectiveUser;

// The exact production error string (from pi-ai's openai-responses-shared) that fired the flood.
const STREAM_DROP = 'OpenAI Responses stream ended before a terminal response event';
const throwStreamDrop = () => { throw new Error(STREAM_DROP); };

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

async function autoRetries(conversationID: number): Promise<number> {
  const conv = await getConversation(conversationID);
  return Number((conv?.meta as { autoRetries?: number } | undefined)?.autoRetries ?? 0);
}

describe('v3 turn — silent auto-retry of transient stream drops', () => {
  setupTestDb(TEST_DB_PATH);
  beforeEach(() => onboardingFaux.setResponses([]));

  it('replays a transient stream drop silently and succeeds on the retry — no error surfaced', async () => {
    onboardingFaux.setResponses([
      throwStreamDrop,                                     // attempt 0 — upstream SSE drop
      fauxAssistantMessage('Recovered.', { stopReason: 'stop' }), // retry — succeeds
    ]);

    const conversationID = await newConversation('transient recover');
    const result = await runConversationTurn(conversationID, USER, turnBody('Document the schema'));

    expect(result.runStatus).toBe('idle');
    // The transient error must NOT reach the error stream (would re-alert Slack + strand a phantom row).
    expect(await loadErrors(conversationID)).toHaveLength(0);
    // A turn that ultimately progressed clears the auto-retry budget.
    expect(await autoRetries(conversationID)).toBe(0);
  });

  it('gives up after MAX_AUTO_RETRIES consecutive transient failures and mirrors the real error', async () => {
    // 1 original + MAX_AUTO_RETRIES replays, all dropping — enough faux responses for every attempt.
    onboardingFaux.setResponses(Array.from({ length: MAX_AUTO_RETRIES + 1 }, () => throwStreamDrop));

    const conversationID = await newConversation('transient exhaust');
    const result = await runConversationTurn(conversationID, USER, turnBody('Document the schema'));

    expect(result.runStatus).toBe('error');
    // The budget was fully consumed by the silent replays.
    expect(await autoRetries(conversationID)).toBe(MAX_AUTO_RETRIES);
    // Only after exhausting retries do we surface — with the REAL stream-drop message, not a placeholder.
    const errors = await loadErrors(conversationID);
    expect(errors.some((e) => String(e.message).includes(STREAM_DROP))).toBe(true);
  });

  it('never retries a TERMINAL error — surfaces on the first attempt', async () => {
    onboardingFaux.setResponses([
      () => { throw new Error('400 invalid_request_error: prompt is too long: 250000 tokens > 200000 maximum'); },
      // A second response would only be consumed if we (wrongly) retried.
      fauxAssistantMessage('should never run', { stopReason: 'stop' }),
    ]);

    const conversationID = await newConversation('terminal no retry');
    const result = await runConversationTurn(conversationID, USER, turnBody('Document the schema'));

    expect(result.runStatus).toBe('error');
    expect(await autoRetries(conversationID)).toBe(0); // no replay attempted
    expect(await loadErrors(conversationID)).toHaveLength(1);
  });

  it('never silently replays a RESUME turn (frontend-tool completion) — mirrors the real error', async () => {
    // Turn 1: the agent calls a frontend-bridged tool (EditFile) → the run pauses awaiting the browser.
    onboardingFaux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall('EditFile', { fileId: 1, changes: [{ oldMatch: 'x', newMatch: 'y' }] }, { id: 'tc_edit_1' })],
        { stopReason: 'toolUse' },
      ),
    ]);
    const conversationID = await newConversation('resume no retry');
    const paused = await runConversationTurn(conversationID, USER, turnBody('Edit the file'));
    expect(paused.runStatus).toBe('paused');
    const pending = paused.pendingToolCalls[0];
    expect(pending).toBeTruthy();

    // Resume: the browser posts the tool result; the resume's LLM call drops transiently.
    onboardingFaux.setResponses([throwStreamDrop]);
    const completed = [
      { id: pending.id, type: 'function', function: { name: pending.name, arguments: pending.parameters } },
      { tool_call_id: pending.id, content: 'done' },
    ];
    const resumeBody = {
      agent: 'OnboardingContextAgent',
      agent_args: { connection_id: 'db', schema: [{ schema: 'main', tables: ['orders'] }], context: '', app_state: { type: 'file' } },
      completed_tool_calls: [completed],
    } as unknown as ChatRequest;

    const result = await runConversationTurn(conversationID, USER, resumeBody);

    expect(result.runStatus).toBe('error');
    // Resume drops are NOT retried: the budget is untouched and the REAL error surfaces immediately.
    expect(await autoRetries(conversationID)).toBe(0);
    const errors = await loadErrors(conversationID);
    expect(errors.some((e) => String(e.message).includes(STREAM_DROP))).toBe(true);
  });
});
