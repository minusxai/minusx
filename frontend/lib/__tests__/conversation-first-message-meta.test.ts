// Verifies that conversation creation stores the full first user message in
// the file-level `meta.firstMessage`, so the conversations listing can display
// it without ever loading content.

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

import { createNewConversation, displayNameFromFileName } from '@/lib/conversations';
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

describe('displayNameFromFileName — readable fallback for old conversations', () => {
  it('un-slugifies a raw chat filename (strips timestamp + extension, capitalizes)', () => {
    expect(displayNameFromFileName('1777263995128-show-me-an-important-chart.chat.json'))
      .toBe('Show me an important chart');
  });

  it('handles the default-named conversation', () => {
    expect(displayNameFromFileName('1779324975926-conversation.chat.json')).toBe('Conversation');
  });

  it('leaves Slack thread names unchanged', () => {
    expect(displayNameFromFileName('slack-C_TEST-2024-01-15')).toBe('slack-C_TEST-2024-01-15');
  });

  it('leaves MCP session names unchanged', () => {
    expect(displayNameFromFileName('mcp-abc12345')).toBe('mcp-abc12345');
  });

  it('leaves an already-clean display name unchanged', () => {
    expect(displayNameFromFileName('What is revenue?')).toBe('What is revenue?');
  });

  it('returns the original when the slug portion is empty', () => {
    expect(displayNameFromFileName('1779324975926-.chat.json')).toBe('1779324975926-.chat.json');
  });
});
