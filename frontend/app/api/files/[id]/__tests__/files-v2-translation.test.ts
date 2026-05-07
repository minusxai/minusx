// /api/files/[id] — verifies that v=2 conversation files have their pi-ai
// `content.log` translated to legacy task-log shape on read, so the
// frontend's `useConversation` + `parseLogToMessages` work unchanged. v=1
// and non-conversation files pass through untranslated.

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

import { GET } from '@/app/api/files/[id]/route';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { NextRequest } from 'next/server';

const TEST_DB_PATH = getTestDbPath('files_v2_translation');

function makeGetRequest(id: number): NextRequest {
  return new NextRequest(`http://localhost/api/files/${id}`);
}

interface FileGetResponse {
  data: {
    id: number;
    type: string;
    meta?: { version?: number };
    content: { log: Array<{ _type?: string; type?: string; agent?: string; args?: { user_message?: string } }> };
  };
}

describe('GET /api/files/[id] — v=2 conversation translation', () => {
  let v1FileId: number;
  let v2FileId: number;

  async function seed(_dbPath: string): Promise<void> {
    const { getModules } = await import('@/lib/modules/registry');
    const db = getModules().db;
    const now = new Date().toISOString();

    const { rows: [{ next_id }] } = await db.exec<{ next_id: number }>(
      'SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM files',
      [],
    );

    v1FileId = next_id;
    v2FileId = next_id + 1;

    // V=1 conversation — task-log shape on disk, no meta.version.
    const v1Content = {
      metadata: { userId: '1', name: 'legacy', createdAt: now, updatedAt: now, logLength: 1 },
      log: [
        {
          _type: 'task',
          _run_id: 'run-1',
          agent: 'AnalystAgent',
          args: { user_message: 'legacy hello' },
          unique_id: 'task-1',
          created_at: now,
        },
      ],
    };
    await db.exec(
      `INSERT INTO files (id, name, path, type, content, file_references, version, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [v1FileId, 'legacy', '/org/logs/conversations/1/legacy', 'conversation', JSON.stringify(v1Content), '[]', 1, now, now],
    );

    // V=2 conversation — pi-ai shape on disk, meta.version=2.
    const v2Content = {
      metadata: { userId: '1', name: 'pi-ai', createdAt: now, updatedAt: now, logLength: 1 },
      log: [
        {
          type: 'toolCall',
          id: 'root1',
          name: 'WebAnalystAgent',
          arguments: { userMessage: 'v2 hello' },
          context: {},
          parent_id: null,
        },
      ],
    };
    await db.exec(
      `INSERT INTO files (id, name, path, type, content, meta, file_references, version, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [v2FileId, 'v2', '/org/logs/conversations/1/v2', 'conversation', JSON.stringify(v2Content), JSON.stringify({ version: 2 }), '[]', 1, now, now],
    );
  }

  setupTestDb(TEST_DB_PATH, { customInit: seed });

  it('v=1 file passes through unchanged (legacy task entries preserved)', async () => {
    const res = await GET(makeGetRequest(v1FileId), {
      params: Promise.resolve({ id: String(v1FileId) }),
    } as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as FileGetResponse;
    expect(body.data.content.log[0]._type).toBe('task');
    expect(body.data.content.log[0].agent).toBe('AnalystAgent');
    expect(body.data.content.log[0].args?.user_message).toBe('legacy hello');
  });

  it('v=2 file is translated: pi-ai entries → legacy task entries', async () => {
    const res = await GET(makeGetRequest(v2FileId), {
      params: Promise.resolve({ id: String(v2FileId) }),
    } as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as FileGetResponse;
    // The first entry, after translation, is a legacy task with
    // agent=AnalystAgent and args.user_message=<userMessage from pi-ai
    // arguments>.
    const log = body.data.content.log;
    expect(log[0]._type).toBe('task');
    expect(log[0].agent).toBe('AnalystAgent');
    expect(log[0].args?.user_message).toBe('v2 hello');
    // No raw pi-ai shape leaks to the frontend.
    expect(log[0].type).toBeUndefined();
  });
});
