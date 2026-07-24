/**
 * End-to-end proof of the LLM-BOUNDARY retry (orchestrator.callLLM re-issues a single transient
 * stream drop). Drives a real turn through runConversationTurn → orchestrator → faux LLM:
 *   1. a pre-content drop is re-issued and the turn succeeds — no error surfaced to the user;
 *   2. a drop AFTER content has streamed is NOT re-issued (would garble) — surfaces as today.
 *
 * The recovery works WITHOUT any turn replay: no truncation, no tool re-execution — the failure is
 * absorbed inside the one call, below the fresh/resume-turn distinction.
 */

vi.mock('@/lib/connections/run-query', () => ({ runQuery: vi.fn(async () => ({ columns: [], types: [], rows: [], finalQuery: '' })) }));
vi.mock('@/lib/connections/load-schema', () => ({ loadConnectionSchema: vi.fn(async () => []) }));

import { fauxAssistantMessage } from '@/orchestrator/llm/testing';
import { fauxRegistration as onboardingFaux } from '@/agents/onboarding/onboarding-agents';
import { runConversationTurn } from '@/lib/chat/conversation-turn.server';
import { createConversation, loadErrors } from '@/lib/data/conversations.server';
import type { ChatRequest } from '@/lib/chat/chat-types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';

const TEST_DB_PATH = getTestDbPath('llm_call_retry');
const USER = { userId: 1, email: 'test@example.com', name: 'Test', role: 'admin', home_folder: '/org', mode: 'org' } as EffectiveUser;

const STREAM_DROP = 'OpenAI Responses stream ended before a terminal response event';

function turnBody(userMessage: string): ChatRequest {
  return {
    user_message: userMessage,
    agent: 'OnboardingContextAgent',
    agent_args: { connection_id: 'db', schema: [{ schema: 'main', tables: ['orders'] }], context: '', app_state: { type: 'file' } },
  } as unknown as ChatRequest;
}

async function newConversation(title: string): Promise<number> {
  const conv = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'OnboardingContextAgent', title });
  return conv.id;
}

describe('LLM-boundary retry — transient single-call stream drops', () => {
  setupTestDb(TEST_DB_PATH);
  beforeEach(() => onboardingFaux.setResponses([]));

  it('re-issues a pre-content stream drop and the turn succeeds — no error surfaced', async () => {
    onboardingFaux.setResponses([
      // A throwing faux factory → an { type:'error', reason:'error' } event with NO content streamed
      // (emitted=false) — exactly a drop before the first token.
      () => { throw new Error(STREAM_DROP); },
      fauxAssistantMessage('Recovered.', { stopReason: 'stop' }),
    ]);

    const conversationID = await newConversation('boundary retry recover');
    const result = await runConversationTurn(conversationID, USER, turnBody('Document the schema'));

    expect(result.runStatus).toBe('idle');
    // The transient drop was absorbed inside callLLM — nothing reached the error stream.
    expect(await loadErrors(conversationID)).toHaveLength(0);
  });

  it('does NOT re-issue a drop that occurs after content has streamed — surfaces the error', async () => {
    onboardingFaux.setResponses([
      // Streams text (emitted=true) and THEN ends as an error — re-issuing would garble, so we don't.
      fauxAssistantMessage('here is some partial output', { stopReason: 'error', errorMessage: STREAM_DROP }),
    ]);

    const conversationID = await newConversation('boundary retry post-content');
    const result = await runConversationTurn(conversationID, USER, turnBody('Document the schema'));

    expect(result.runStatus).toBe('error');
    const errors = await loadErrors(conversationID);
    expect(errors.some((e) => String(e.message).includes(STREAM_DROP))).toBe(true);
  });
});
