// POST /api/benchmark/import — verifies that an imported orchestrator
// conversation log is persisted as a v3 conversation (dedicated tables) in the
// documents DB so it can be opened at /explore/<id> and continued in the chat UI.

vi.mock('@/lib/auth/auth-helpers', () => ({
  getEffectiveUser: vi.fn(),
}));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/benchmark/import/route';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { getConversation, loadLog } from '@/lib/data/conversations.server';
import type { ConversationLog } from '@/orchestrator/types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const TEST_DB_PATH = getTestDbPath('benchmark_import');

const ADMIN: EffectiveUser = {
  userId: 1,
  email: 'test@example.com',
  name: 'Test',
  role: 'admin',
  home_folder: '/org',
  mode: 'org',
};

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/benchmark/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/benchmark/import', () => {
  setupTestDb(TEST_DB_PATH);

  beforeEach(() => {
    (getEffectiveUser as unknown as { mockResolvedValue: (v: EffectiveUser) => void }).mockResolvedValue(ADMIN);
  });

  it('creates a v3 conversation from an imported orchestrator log', async () => {
    const log: ConversationLog = [
      {
        type: 'toolCall',
        id: 'r1',
        name: 'BenchmarkAnalystAgent',
        arguments: { userMessage: 'list connections' },
        context: { connections: [{ name: 'default_duckdb', dialect: 'duckdb' }] },
        parent_id: null,
      },
    ] as unknown as ConversationLog;

    const res = await POST(makeRequest({ log }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { fileId: number; name: string };
    expect(typeof body.fileId).toBe('number');
    expect(body.fileId).toBeGreaterThan(0);

    // Verify the v3 conversation is persisted with the log intact (one message row per pi entry).
    const conv = await getConversation(body.fileId);
    expect(conv).not.toBeNull();
    expect(conv!.agent).toBe('BenchmarkAnalystAgent');
    const savedLog = await loadLog(body.fileId);
    expect(savedLog).toHaveLength(1);
    const root = savedLog[0] as { type?: string; name?: string };
    expect(root.type).toBe('toolCall');
    expect(root.name).toBe('BenchmarkAnalystAgent');
  });

  it('returns 400 when the body has no log array', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it('returns 401 when the user is not authenticated', async () => {
    (getEffectiveUser as unknown as { mockResolvedValue: (v: null) => void }).mockResolvedValue(null);
    const res = await POST(makeRequest({ log: [] }));
    expect(res.status).toBe(401);
  });

  it('persists the dataset connections on meta.benchmark_connections', async () => {
    // The conversation's meta carries the connection configs so that
    // v3 chat continuation can wire NodeConnector-backed executors per
    // conversation. Without this, ExecuteSQL can't talk to the benchmark's
    // databases ("connector 'X' not loaded").
    const log = [
      {
        type: 'toolCall',
        id: 'r1',
        name: 'BenchmarkAnalystAgent',
        arguments: { userMessage: 'q' },
        context: { connections: [{ name: 'default_duckdb', dialect: 'duckdb' }] },
        parent_id: null,
      },
    ];
    const connections = [
      { name: 'default_duckdb', dialect: 'duckdb', config: { file_path: 'data/foo.duckdb' } },
    ];

    const res = await POST(makeRequest({ log, connections }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { fileId: number };

    const conv = await getConversation(body.fileId);
    const meta = conv!.meta as { benchmark_connections?: unknown } | null | undefined;
    expect(meta?.benchmark_connections).toEqual(connections);
  });

  it('rejects connections that are not an array', async () => {
    const res = await POST(makeRequest({ log: [], connections: { not: 'array' } }));
    expect(res.status).toBe(400);
  });
});
