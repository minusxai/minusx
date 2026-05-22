// Forking a v1 (legacy) conversation into a v2 conversation: the original v1
// file is left untouched (zero data loss), and the new v2 file is seeded from
// the v1 log via legacyLogToPi so it can be continued in v2 mode.

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

import { describe, it, expect } from 'vitest';
import { forkV1ConversationToV2 } from '@/lib/chat-orchestration-v2.server';
import { createNewConversation } from '@/lib/conversations';
import { FilesAPI } from '@/lib/data/files.server';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import { setupTestDb } from '@/test/harness/test-db';
import { getTestDbPath } from '@/store/__tests__/test-utils';

const TEST_DB = getTestDbPath('fork_v1_to_v2');
const USER = { userId: 1, email: 'x@y.z', name: 'X', role: 'admin', home_folder: '/org', mode: 'org' } as unknown as EffectiveUser;

const LEGACY_LOG = [
  { _type: 'task', _run_id: 'run-r1', agent: 'AnalystAgent', args: { user_message: 'hello' }, unique_id: 'r1', created_at: '2026-01-01T00:00:00.000Z' },
  { _type: 'task', _run_id: 'run-t1', _parent_unique_id: 'r1', agent: 'ExecuteQuery', args: { query: 'SELECT 1' }, unique_id: 't1', created_at: '2026-01-01T00:00:00.000Z' },
  { _type: 'task_result', _task_unique_id: 't1', result: '{"rows":[{"x":1}]}', details: { success: true }, created_at: '2026-01-01T00:00:00.000Z' },
  { _type: 'task', _run_id: 'run-ttu1', _parent_unique_id: 'r1', agent: 'TalkToUser', args: { content_blocks: [{ type: 'text', text: 'hi there' }] }, unique_id: 'ttu1', created_at: '2026-01-01T00:00:00.000Z' },
  { _type: 'task_result', _task_unique_id: 'ttu1', result: '{"success":true,"content_blocks":[{"type":"text","text":"hi there"}]}', created_at: '2026-01-01T00:00:00.000Z' },
];

describe('forkV1ConversationToV2', () => {
  setupTestDb(TEST_DB);

  it('seeds a v2 fork from the v1 log and leaves the original v1 untouched', async () => {
    // A v1 conversation (no meta.version) carrying a legacy log.
    const v1 = await createNewConversation(USER, 'hello', { initialLog: LEGACY_LOG });

    const forkedId = await forkV1ConversationToV2(v1.fileId, USER);
    expect(forkedId).not.toBe(v1.fileId);

    // Fork is a v2 conversation tagged with forkedFrom.
    const forked = await FilesAPI.loadFile(forkedId, USER);
    const meta = forked.data.meta as { version?: number; forkedFrom?: number };
    expect(meta.version).toBe(2);
    expect(meta.forkedFrom).toBe(v1.fileId);

    // Seeded log is the pi shape: root invocation + tool pairing + final answer.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const log = (forked.data.content as any).log as any[];
    expect(log[0]).toMatchObject({ type: 'toolCall', id: 'r1', parent_id: null });
    expect(log[0].arguments.userMessage).toBe('hello');
    expect(log.some((e) => e.role === 'toolResult' && e.toolCallId === 't1')).toBe(true);
    const finalAsst = log.find((e) => e.role === 'assistant' && e.stopReason === 'stop');
    expect(finalAsst.content.find((c: { type: string }) => c.type === 'text').text).toBe('hi there');

    // Original v1 is untouched: still v1, still its legacy log.
    const original = await FilesAPI.loadFile(v1.fileId, USER);
    expect((original.data.meta as { version?: number } | null)?.version).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((original.data.content as any).log).toHaveLength(LEGACY_LOG.length);
  });
});
