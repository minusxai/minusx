// Phase 4 crash-resume: a turn claims a lease + heartbeats while running and releases it on
// completion; an orphaned turn (status 'running' but a stale/absent heartbeat = the owner died) is
// detected and failed cleanly, with the eagerly-committed user message preserved for a retry.
vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

import { runConversationTurn } from '@/lib/chat/conversation-turn.server';
import {
  createConversation, getConversation, loadMessages, isRunLeaseStale, acquireRunLease,
} from '@/lib/data/conversations.server';
import { getModules } from '@/lib/modules/registry';
import { fauxRegistration as webAnalystFaux } from '@/agents/web-analyst/web-analyst';
import { fauxAssistantMessage } from '@/orchestrator/llm/testing';
import type { ChatRequest } from '@/lib/chat-orchestration';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';

const TEST_DB_PATH = getTestDbPath('conversation_crash_resume');
const ADMIN = { userId: 1, email: 'test@example.com', name: 'Test', role: 'admin', home_folder: '/org', mode: 'org' } as EffectiveUser;
const turnBody = (m: string): ChatRequest => ({ user_message: m, agent: 'WebAnalystAgent', agent_args: {} } as unknown as ChatRequest);

describe('v3 crash-resume (lease + heartbeat)', () => {
  setupTestDb(TEST_DB_PATH);

  it('a completed turn releases the lease (idle, no owner/heartbeat)', async () => {
    webAnalystFaux.setResponses([fauxAssistantMessage('done', { stopReason: 'stop' })]);
    const conv = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
    await runConversationTurn(conv.id, ADMIN, turnBody('hi'));

    const after = await getConversation(conv.id);
    expect(after?.runStatus).toBe('idle');
    expect(after?.runLeaseOwner).toBeNull();
    expect(after?.runHeartbeatAt).toBeNull();
    expect(isRunLeaseStale(after!)).toBe(false);
  });

  it('detects an orphaned turn (running + no heartbeat) as stale', async () => {
    const conv = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
    // Simulate a crashed turn: running, but no heartbeat (owner died before the first beat).
    await getModules().db.exec(
      `UPDATE conversations SET run_status = 'running', run_lease_owner = 'dead', run_heartbeat_at = NULL WHERE id = $1`,
      [conv.id],
    );
    expect(isRunLeaseStale((await getConversation(conv.id))!)).toBe(true);

    // A fresh lease is NOT stale.
    await acquireRunLease(conv.id, 'pid-live', 0);
    expect(isRunLeaseStale((await getConversation(conv.id))!)).toBe(false);

    // An old heartbeat IS stale.
    await getModules().db.exec(
      `UPDATE conversations SET run_status = 'running', run_heartbeat_at = NOW() - INTERVAL '10 minutes' WHERE id = $1`,
      [conv.id],
    );
    expect(isRunLeaseStale((await getConversation(conv.id))!)).toBe(true);
  });

  it('eagerly commits the user message (root invocation) so it survives a crash', async () => {
    // Faux throws after the root invocation is committed → simulates a mid-turn crash. The runner
    // commits the root before the LLM call, so the user message is durable even on failure.
    webAnalystFaux.setResponses([]); // no response → orchestrator errors out
    const conv = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
    await runConversationTurn(conv.id, ADMIN, turnBody('which month has max mrr?'));

    const rows = await loadMessages(conv.id);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].kind).toBe('toolCall');
    expect((rows[0].content as unknown as { arguments: { userMessage: string } }).arguments.userMessage).toBe('which month has max mrr?');
    // Title set from the preserved user message.
    expect((await getConversation(conv.id))?.title).toBe('which month has max mrr?');
  });
});
