vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

import { AsyncLocalStorage } from 'node:async_hooks';
import { fauxAssistantMessage } from '@/orchestrator/llm/testing';
import { fauxRegistration as webAnalystFaux } from '@/agents/web-analyst/web-analyst';
import { POST as chatStreamPostHandler } from '@/app/api/chat/stream/route';
import { __clearAllRuns } from '@/lib/chat/run-registry.server';
import { FilesAPI } from '@/lib/data/files.server';
import { getModules } from '@/lib/modules/registry';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { NextRequest } from 'next/server';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const TEST_DB_PATH = getTestDbPath('v2_stream_context_propagation');
const BOUND = 'bound-in-handler';
const REPLY = 'Context propagation reply 4242.';

const ADMIN: EffectiveUser = {
  userId: 1, email: 'test@example.com', name: 'Test User', role: 'admin', home_folder: '/org', mode: 'org',
};

vi.mock('@/lib/auth/auth-helpers', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/auth-helpers')>('@/lib/auth/auth-helpers');
  return { ...actual, getEffectiveUser: vi.fn(async () => ADMIN) };
});

const ctx = new AsyncLocalStorage<string>();

async function seedConversation(name: string): Promise<number> {
  const created = await FilesAPI.createFile(
    {
      name,
      path: `/org/logs/conversations/1/${name}.chat.json`,
      type: 'conversation',
      content: {
        metadata: { userId: '1', name, createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z', logLength: 0 },
        log: [],
      } as never,
      meta: { version: 2 },
      options: { createPath: true, returnExisting: false },
    },
    ADMIN,
  );
  return created.data.id;
}

function streamRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/chat/stream', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

async function drain(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  for (;;) { const { done } = await reader.read(); if (done) break; }
}

describe('/api/chat/stream: the detached turn task runs inside the auth context runner', () => {
  setupTestDb(TEST_DB_PATH);

  let persistContext: string | undefined | symbol;
  const UNSEEN = Symbol('unseen');
  let restore: (() => void) | undefined;

  beforeEach(() => {
    __clearAllRuns();
    persistContext = UNSEEN;

    const m = getModules();
    // The route captures auth.getContextRunner() and wraps the detached turn task
    // with it. Stand in a runner that scopes an opaque value via AsyncLocalStorage.run,
    // then assert the task's persistence write runs inside it.
    const origGetContextRunner = m.auth.getContextRunner;
    m.auth.getContextRunner = (async () => (fn: () => Promise<unknown>) => ctx.run(BOUND, fn)) as typeof m.auth.getContextRunner;
    const origExec = m.db.exec;
    m.db.exec = (async (sql: string, params?: unknown[]) => {
      const carriesReply = JSON.stringify(params ?? '').includes(REPLY) || String(sql).includes(REPLY);
      if (carriesReply && persistContext === UNSEEN) persistContext = ctx.getStore();
      return origExec(sql, params);
    }) as typeof m.db.exec;
    restore = () => { m.auth.getContextRunner = origGetContextRunner; m.db.exec = origExec; };
  });

  afterEach(() => { restore?.(); });

  it('the post-response persistence write runs inside the context runner the route captured', async () => {
    const conversationId = await seedConversation('ctx-propagation');
    webAnalystFaux.setResponses([
      async () => fauxAssistantMessage(REPLY, { stopReason: 'stop' }),
    ]);

    const res = await chatStreamPostHandler(
      streamRequest({ conversationID: conversationId, user_message: 'check context' }),
    );
    expect(res.status).toBe(200);

    await drain(res.body!.getReader());

    expect(persistContext).toBe(BOUND);
  }, 15000);
});
