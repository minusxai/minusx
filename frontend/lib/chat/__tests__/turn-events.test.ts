// The turn runner is DETACHED from the HTTP request, so `withAuth` never sees a
// turn's outcome — the runner itself must publish: USER_MESSAGE for browser
// turns (Slack/MCP publish their own), one chat:turn per segment with the
// outcome + duration, and an ERROR event when the turn fails (previously a
// failed turn left only an appendError row, invisible to Sentry/app_events).

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { appEventRegistry, AppEvents } from '@/lib/app-event-registry';
import { runConversationTurn } from '@/lib/chat/conversation-turn.server';
import { createConversation } from '@/lib/data/conversations.server';
import { fauxRegistration as webAnalystFaux } from '@/agents/web-analyst/web-analyst';
import { fauxAssistantMessage } from '@/orchestrator/llm/testing';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { ChatRequest } from '@/lib/chat/chat-types';

setupTestDb(getTestDbPath('turn_events'));

const USER = { userId: 1, email: 't@x.co', name: 'T', role: 'viewer', home_folder: '/org', mode: 'org' } as EffectiveUser;
const turnBody = (m: string): ChatRequest =>
  ({ user_message: m, agent: 'WebAnalystAgent', agent_args: {} } as unknown as ChatRequest);

const publishSpy = vi.spyOn(appEventRegistry, 'publish');

function published(event: string): Record<string, unknown>[] {
  return publishSpy.mock.calls.filter(([e]) => e === event).map(([, p]) => p as unknown as Record<string, unknown>);
}

beforeEach(() => {
  publishSpy.mockClear();
  webAnalystFaux.setResponses([]);
});

describe('turn runner events', () => {
  it('a successful browser turn publishes USER_MESSAGE and chat:turn ok', async () => {
    webAnalystFaux.setResponses([fauxAssistantMessage('hello', { stopReason: 'stop' })]);
    const conv = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });

    const result = await runConversationTurn(conv.id, USER, turnBody('hi'));
    expect(result.runStatus).toBe('idle');

    const userMsgs = published(AppEvents.USER_MESSAGE);
    expect(userMsgs).toHaveLength(1);
    expect(['explore', 'side_chat']).toContain(userMsgs[0].source);
    expect(userMsgs[0].conversationId).toBe(conv.id);
    expect(String(userMsgs[0].messagePreview)).toContain('hi');

    const turns = published(AppEvents.CHAT_TURN);
    expect(turns).toHaveLength(1);
    expect(turns[0].status).toBe('ok');
    expect(turns[0].conversationId).toBe(conv.id);
    expect(typeof turns[0].durationMs).toBe('number');

    expect(published(AppEvents.ERROR)).toHaveLength(0);
  });

  it('a failed turn publishes chat:turn error AND an ERROR event', async () => {
    webAnalystFaux.setResponses([
      () => { throw new Error('synthetic turn failure'); },
    ]);
    const conv = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });

    const result = await runConversationTurn(conv.id, USER, turnBody('boom'));
    expect(result.runStatus).toBe('error');

    const turns = published(AppEvents.CHAT_TURN);
    expect(turns).toHaveLength(1);
    expect(turns[0].status).toBe('error');
    expect(String(turns[0].error)).toContain('synthetic turn failure');

    const errors = published(AppEvents.ERROR);
    expect(errors.length).toBeGreaterThan(0);
    expect(String(errors[0].message)).toContain('synthetic turn failure');
  });

  it('a Slack turn does NOT publish USER_MESSAGE from the runner (Slack publishes its own)', async () => {
    webAnalystFaux.setResponses([fauxAssistantMessage('ok', { stopReason: 'stop' })]);
    const conv = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'SlackAgent' });

    await runConversationTurn(conv.id, USER, {
      user_message: 'from slack', agent: 'SlackAgent', agent_args: {},
    } as unknown as ChatRequest);

    expect(published(AppEvents.USER_MESSAGE)).toHaveLength(0);
  });
});
