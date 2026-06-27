// edit-and-fork on v3: forkConversation copies messages [0, atSeq) into a new conversation (own id,
// meta.forkedFrom), leaving the source intact, so the caller can run an edited turn on the fork.
vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined, DB_PATH: undefined, DB_DIR: undefined, getDbType: () => 'pglite' as const,
}));

import { createConversation, appendMessages, forkConversation, loadLog, getConversation } from '@/lib/data/conversations.server';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import type { ConversationLog } from '@/orchestrator/types';

const TEST_DB_PATH = getTestDbPath('fork_conversation');

const LOG: ConversationLog = ([
  { type: 'toolCall', id: 'r1', name: 'WebAnalystAgent', parent_id: null, arguments: { userMessage: 'q1' }, context: {} },
  { role: 'assistant', parent_id: 'r1', content: [{ type: 'text', text: 'a1' }], stopReason: 'stop', model: 'm', timestamp: 1,
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } },
  { type: 'toolCall', id: 'r2', name: 'WebAnalystAgent', parent_id: null, arguments: { userMessage: 'q2' }, context: {} },
  { role: 'assistant', parent_id: 'r2', content: [{ type: 'text', text: 'a2' }], stopReason: 'stop', model: 'm', timestamp: 2,
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } },
] as unknown as ConversationLog);

describe('forkConversation', () => {
  setupTestDb(TEST_DB_PATH);

  it('copies [0, atSeq) into a new conversation (forkedFrom), source untouched', async () => {
    const src = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent', title: 'orig' });
    await appendMessages(src.id, LOG, 0); // seqs 0..3

    // Fork at seq 2 (keep the first turn q1/a1, drop the second).
    const fork = await forkConversation(src.id, 2);
    expect(fork.id).not.toBe(src.id);
    expect(fork.meta.forkedFrom).toBe(src.id);
    expect(fork.ownerUserId).toBe(1);
    expect(fork.mode).toBe('org');

    const forkLog = await loadLog(fork.id);
    expect(forkLog).toHaveLength(2);
    expect((forkLog[0] as unknown as { arguments: { userMessage: string } }).arguments.userMessage).toBe('q1');

    // Source unchanged (all 4 entries).
    expect((await loadLog(src.id))).toHaveLength(4);
    expect((await getConversation(src.id))?.meta.forkedFrom).toBeUndefined();
  });
});
