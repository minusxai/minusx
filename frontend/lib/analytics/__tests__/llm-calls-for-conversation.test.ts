// getLlmCallsForConversation — batch read of a conversation's recorded LLM
// calls (llm_call_events LEFT JOIN llm_logs) for the /debug visualization.
import { describe, it, expect } from 'vitest';
import { recordLlmCallEvent, recordLlmRequest, getLlmCallsForConversation } from '@/lib/analytics/file-analytics.db';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';

const TEST_DB_PATH = getTestDbPath('llm_calls_for_conversation');

describe('getLlmCallsForConversation', () => {
  setupTestDb(TEST_DB_PATH);

  it('returns a conversation‘s calls in creation order with stats and request blobs', async () => {
    await recordLlmCallEvent({
      conversationId: 42, llmCallId: 'call-1', model: 'claude-test', provider: 'anthropic',
      totalTokens: 100, promptTokens: 80, completionTokens: 20, cachedTokens: 10, cacheCreationTokens: 60,
      cost: 0.001, durationS: 1.5,
    });
    await recordLlmCallEvent({
      conversationId: 42, llmCallId: 'call-2', model: 'claude-test', provider: 'anthropic',
      totalTokens: 200, promptTokens: 150, completionTokens: 50,
      cost: 0.002, durationS: 2,
    });
    await recordLlmCallEvent({
      conversationId: 99, llmCallId: 'other-convo', model: 'claude-test',
      totalTokens: 1, promptTokens: 1, completionTokens: 0, cost: 0, durationS: 0,
    });
    await recordLlmRequest('call-1', '{"systemPrompt":"sys","messages":[]}');

    const calls = await getLlmCallsForConversation(42);
    expect(calls.map((c) => c.callId)).toEqual(['call-1', 'call-2']);
    expect(calls[0].requestJson).toBe('{"systemPrompt":"sys","messages":[]}');
    expect(calls[1].requestJson).toBeNull();
    expect(calls[0].stats).toMatchObject({ model: 'claude-test', cached_tokens: 10, cache_creation_tokens: 60 });
  });

  it('returns empty for a conversation with no calls', async () => {
    expect(await getLlmCallsForConversation(123456)).toEqual([]);
  });
});
