// /api/chat/init route — verifies that `?v=2` writes `meta.version=2` on
// the new conversation file, while default URL writes none. Both use the
// same `type:'conversation'` file shape — only `meta.version` differs.

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

import { POST } from '@/app/api/chat/init/route';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { NextRequest } from 'next/server';

const TEST_DB_PATH = getTestDbPath('chat_init_v2');

function makeRequest(url: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

async function getFileMeta(id: number): Promise<{ version?: number } | null> {
  const { getModules } = await import('@/lib/modules/registry');
  const db = getModules().db;
  const { rows } = await db.exec<{ meta: unknown }>(
    'SELECT meta FROM files WHERE id = $1',
    [id],
  );
  if (rows.length === 0) return null;
  return rows[0].meta as { version?: number } | null;
}

describe('POST /api/chat/init', () => {
  setupTestDb(TEST_DB_PATH);

  it('default URL → meta.version is NOT set (v=1 conversation)', async () => {
    const res = await POST(makeRequest('http://localhost/api/chat/init', { firstMessage: 'hi' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.conversationID).toBeGreaterThan(0);
    const meta = await getFileMeta(body.conversationID);
    // v=1 may have no meta at all, or meta without `version`.
    expect(meta?.version).toBeUndefined();
  });

  it('?v=2 → meta.version === 2', async () => {
    const res = await POST(makeRequest('http://localhost/api/chat/init?v=2', { firstMessage: 'hi v=2' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.conversationID).toBeGreaterThan(0);
    const meta = await getFileMeta(body.conversationID);
    expect(meta?.version).toBe(2);
  });

  it('?v=2 file is type=conversation (NOT type=chat)', async () => {
    const res = await POST(makeRequest('http://localhost/api/chat/init?v=2', { firstMessage: 'hi' }));
    const body = await res.json();
    const { getModules } = await import('@/lib/modules/registry');
    const db = getModules().db;
    const { rows } = await db.exec<{ type: string }>(
      'SELECT type FROM files WHERE id = $1',
      [body.conversationID],
    );
    expect(rows[0].type).toBe('conversation');
  });
});
