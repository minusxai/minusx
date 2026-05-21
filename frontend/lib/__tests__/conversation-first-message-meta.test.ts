// Verifies that conversation creation stores the full first user message in
// the file-level `meta.firstMessage`, so the conversations listing can display
// it without ever loading content.

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

import { createNewConversation } from '@/lib/conversations';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const TEST_DB_PATH = getTestDbPath('conversation_first_message_meta');

const ADMIN: EffectiveUser = {
  userId: 1,
  email: 'test@example.com',
  name: 'Test User',
  role: 'admin',
  home_folder: '/org',
  mode: 'org',
};

const LONG_MESSAGE =
  'What is the full revenue breakdown by region for last quarter, including refunds and taxes?';

// A freshly created conversation is a draft (excluded from listings) until the
// first log append publishes it. We assert the meta write directly on the row.
async function readMeta(fileId: number): Promise<Record<string, unknown> | null | undefined> {
  const { DocumentDB } = await import('@/lib/database/documents-db');
  const file = await DocumentDB.getById(fileId);
  return file?.meta;
}

describe('createNewConversation — writes meta.firstMessage', () => {
  setupTestDb(TEST_DB_PATH);

  it('stores the full, untruncated first message in meta', async () => {
    const { fileId } = await createNewConversation(ADMIN, LONG_MESSAGE);
    const meta = await readMeta(fileId);
    expect(meta?.firstMessage).toBe(LONG_MESSAGE);
    // Not truncated to the 50-char display name.
    expect((meta?.firstMessage as string).length).toBeGreaterThan(50);
  });

  it('preserves meta.version alongside firstMessage for v=2 conversations', async () => {
    const { fileId } = await createNewConversation(ADMIN, LONG_MESSAGE, { version: 2 });
    const meta = await readMeta(fileId);
    expect(meta?.firstMessage).toBe(LONG_MESSAGE);
    expect(meta?.version).toBe(2);
  });

  it('does not set firstMessage when no first message is provided', async () => {
    const { fileId } = await createNewConversation(ADMIN);
    const meta = await readMeta(fileId);
    expect(meta?.firstMessage).toBeUndefined();
  });
});
