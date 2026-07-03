// Headless runs (micro-tasks, feed-summary, eval — small models, OpenAI, etc.)
// must record into llm_call_events too, so it is the complete usage ledger.

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

import { describe, it, expect, vi } from 'vitest';
import { recordHeadlessLlmCalls } from '@/lib/chat/headless-llm-tracking.server';
import { getModules } from '@/lib/modules/registry';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

setupTestDb(getTestDbPath('headless_llm_tracking'));

const user = { userId: 7, email: 'u@x.co', role: 'viewer', mode: 'org' } as unknown as EffectiveUser;

// Minimal assistant message with the engine-stamped fields buildLlmCallDetail reads.
function fauxAssistantMessage() {
  return {
    role: 'assistant',
    provider: 'openai',
    model: 'gpt-4o-mini',
    stopReason: 'stop',
    content: [{ type: 'text', text: 'hi' }],
    usage: { totalTokens: 150, input: 100, output: 50, cacheRead: 10, cacheWrite: 0, cost: { total: 0.02 } },
    _lllmCallId: 'call_headless_1',
    _duration: 1.2,
  };
}

describe('recordHeadlessLlmCalls', () => {
  it('writes a headless call into llm_call_events with NULL conversation and a task tag', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await recordHeadlessLlmCalls([fauxAssistantMessage() as any], user, 'micro:test-task');

    const { rows } = await getModules().db.exec<Record<string, unknown>>(
      `SELECT conversation_id, task, provider, model, prompt_tokens, cached_tokens,
              completion_tokens, cost, user_id, mode
       FROM llm_call_events WHERE llm_call_id = 'call_headless_1'`,
    );

    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r['conversation_id']).toBeNull();
    expect(r['task']).toBe('micro:test-task');
    expect(r['provider']).toBe('openai');
    expect(r['model']).toBe('gpt-4o-mini');
    expect(Number(r['prompt_tokens'])).toBe(100);
    expect(Number(r['cached_tokens'])).toBe(10);
    expect(Number(r['completion_tokens'])).toBe(50);
    expect(Number(r['cost'])).toBeCloseTo(0.02, 6);
    expect(Number(r['user_id'])).toBe(7);
    expect(r['mode']).toBe('org');
  });
});
