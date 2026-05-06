// /api/chat/v2/new — creates a draft chat file and returns its ID.

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

import { POST as newChatHandler } from '@/app/api/chat/v2/new/route';
import { FilesAPI } from '@/lib/data/files.server';
import {
  cleanupTestDatabase,
  getTestDbPath,
  initTestDatabase,
} from '@/store/__tests__/test-utils';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import { NextRequest } from 'next/server';

const ADMIN: EffectiveUser = {
  userId: 1,
  email: 'test@example.com',
  name: 'Test User',
  role: 'admin',
  home_folder: '/org',
  mode: 'org',
};

const dbPath = getTestDbPath('chat_v2_new');

beforeAll(async () => initTestDatabase(dbPath));
afterAll(async () => cleanupTestDatabase(dbPath));

function newChatRequest(body: unknown = {}): NextRequest {
  return new NextRequest('http://localhost:3000/api/chat/v2/new', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/chat/v2/new', () => {
  it('creates a draft chat file and returns its id', async () => {
    const response = await newChatHandler(newChatRequest());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { chatId: number; error?: string };
    expect(body.error).toBeUndefined();
    expect(body.chatId).toBeGreaterThan(0);

    // The file exists in the DB, has type 'chat', is in draft state, and lives
    // under the user's home folder /chats/.
    const file = await FilesAPI.loadFile(body.chatId, ADMIN);
    expect(file.data.type).toBe('chat');
    expect(file.data.draft).toBe(true);
    expect(file.data.path).toContain('/chats/');
    expect(file.data.path).toContain('draft-');
  });
});
