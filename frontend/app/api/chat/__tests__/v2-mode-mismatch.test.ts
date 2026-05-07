// Mode-mismatch guard tests for /api/chat and /api/chat/stream.
//
// Strict-mode rule: URL `?v=2` must match the conversation file's
// `meta.version`. Any mismatch must be rejected (400 for /api/chat;
// `event: error` SSE frame for /api/chat/stream). This is what allows the
// frontend Redux + ChatInterface to remain unaware of v=2 — they speak
// legacy shape to a backend that picks the right engine via metadata.

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

import { POST as chatPostHandler } from '@/app/api/chat/route';
import { POST as chatStreamPostHandler } from '@/app/api/chat/stream/route';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { NextRequest } from 'next/server';

const TEST_DB_PATH = getTestDbPath('chat_v2_mode_mismatch');

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

  await db.exec(
    `INSERT INTO files (id, name, path, type, content, file_references, version, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      v1FileId,
      'legacy',
      '/org/logs/conversations/1/legacy',
      'conversation',
      JSON.stringify({
        metadata: { userId: '1', name: 'legacy', createdAt: now, updatedAt: now, logLength: 0 },
        log: [],
      }),
      '[]',
      1,
      now,
      now,
    ],
  );
  await db.exec(
    `INSERT INTO files (id, name, path, type, content, meta, file_references, version, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      v2FileId,
      'v2',
      '/org/logs/conversations/1/v2',
      'conversation',
      JSON.stringify({
        metadata: { userId: '1', name: 'v2', createdAt: now, updatedAt: now, logLength: 0 },
        log: [],
      }),
      JSON.stringify({ version: 2 }),
      '[]',
      1,
      now,
      now,
    ],
  );
}

function makeChatRequest(url: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('/api/chat — strict mode-match rejection', () => {
  setupTestDb(TEST_DB_PATH, { customInit: seed });

  it('?v=2 against a v=1 conversation file → 400 with mode-mismatch error', async () => {
    const res = await chatPostHandler(
      makeChatRequest('http://localhost/api/chat?v=2', {
        conversationID: v1FileId,
        user_message: 'hi',
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('cannot continue v=1 conversation in v=2 mode');
  });

  it('default URL against a v=2 conversation file → 400 with mode-mismatch error', async () => {
    const res = await chatPostHandler(
      makeChatRequest('http://localhost/api/chat', {
        conversationID: v2FileId,
        user_message: 'hi',
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('cannot continue v=2 conversation in v=1 mode');
  });
});

describe('/api/chat/stream — strict mode-match rejection', () => {
  setupTestDb(TEST_DB_PATH, { customInit: seed });

  async function readSSEEvent(res: Response): Promise<{ event: string; data: unknown } | null> {
    const reader = res.body?.getReader();
    if (!reader) return null;
    const decoder = new TextDecoder();
    let buf = '';
    // Read up to ~5 chunks; mode-mismatch fires immediately as the first
    // non-ping event.
    for (let i = 0; i < 5; i++) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // SSE event boundary is double-newline. Skip the leading `: ping\n\n`.
      const idx = buf.indexOf('\n\nevent:');
      if (idx >= 0) {
        const eventBlock = buf.slice(idx + 2).split('\n\n')[0];
        const lines = eventBlock.split('\n');
        const event = lines.find((l) => l.startsWith('event: '))?.slice(7).trim() ?? '';
        const dataStr = lines.find((l) => l.startsWith('data: '))?.slice(6).trim() ?? '';
        try {
          return { event, data: dataStr ? JSON.parse(dataStr) : null };
        } catch {
          return { event, data: dataStr };
        }
      }
    }
    await reader.cancel();
    return null;
  }

  it('?v=2 against a v=1 conversation file → SSE error frame', async () => {
    const res = await chatStreamPostHandler(
      makeChatRequest('http://localhost/api/chat/stream?v=2', {
        conversationID: v1FileId,
        user_message: 'hi',
      }),
    );
    expect(res.status).toBe(200); // stream opens
    const frame = await readSSEEvent(res);
    expect(frame?.event).toBe('error');
    const data = frame?.data as { error?: string } | null;
    expect(data?.error).toContain('cannot continue v=1 conversation in v=2 mode');
  });

  it('default URL against a v=2 conversation file → SSE error frame', async () => {
    const res = await chatStreamPostHandler(
      makeChatRequest('http://localhost/api/chat/stream', {
        conversationID: v2FileId,
        user_message: 'hi',
      }),
    );
    expect(res.status).toBe(200);
    const frame = await readSSEEvent(res);
    expect(frame?.event).toBe('error');
    const data = frame?.data as { error?: string } | null;
    expect(data?.error).toContain('cannot continue v=2 conversation in v=1 mode');
  });
});
