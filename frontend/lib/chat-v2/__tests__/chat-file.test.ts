// Chat-file shape cleanup — TDD spec.
//
// Verifies the post-cleanup shape:
//   content = { log }
//   meta    = { logLength, forkedFrom?, forkedAt? }
//
// Five behaviours under test:
//   1. createDraftChat writes the new content/meta shape.
//   2. appendChatLog (happy path) bumps content.log AND meta.logLength atomically.
//   3. appendChatLog forks on a length mismatch — fork carries forkedFrom + forkedAt.
//   4. Sidebar-cheap read: listAll(includeContent: false) returns meta with
//      logLength/forkedFrom but content === null. (The headline use case.)
//   5. Concurrent appends: exactly one wins; the loser forks.

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

import {
  createDraftChat,
  appendChatLog,
  type ChatContent,
  type ChatMeta,
} from '@/lib/chat-v2/chat-file';
import { FilesAPI } from '@/lib/data/files.server';
import { DocumentDB } from '@/lib/database/documents-db';
import {
  cleanupTestDatabase,
  getTestDbPath,
  initTestDatabase,
} from '@/store/__tests__/test-utils';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { ConversationLogEntry } from '@/orchestrator/types';

const ADMIN: EffectiveUser = {
  userId: 1,
  email: 'test@example.com',
  name: 'Test User',
  role: 'admin',
  home_folder: '/org',
  mode: 'org',
};

const dbPath = getTestDbPath('chat_file_shape');

beforeAll(async () => initTestDatabase(dbPath));
afterAll(async () => cleanupTestDatabase(dbPath));

// Synthetic root AgentInvocation entry for tests — the only required field
// for the cleanup is that it serialises through the DB without TS errors.
function makeUserEntry(userMessage: string, id: string): ConversationLogEntry {
  return {
    type: 'toolCall',
    id,
    name: 'WebAnalystAgent',
    arguments: { userMessage },
    context: { userId: '1', mode: 'org' },
    parent_id: null,
  } as ConversationLogEntry;
}

describe('createDraftChat — new shape', () => {
  it('writes content={ log: [] } and meta={ logLength: 0 } (no agent, no agent_args, no in-content metadata)', async () => {
    const { chatId } = await createDraftChat(ADMIN);
    const file = await FilesAPI.loadFile(chatId, ADMIN);

    const content = file.data.content as unknown as ChatContent;
    expect(content).toEqual({ log: [] });
    // No vestigial fields.
    expect((content as unknown as Record<string, unknown>).agent).toBeUndefined();
    expect((content as unknown as Record<string, unknown>).agent_args).toBeUndefined();
    expect((content as unknown as Record<string, unknown>).metadata).toBeUndefined();

    const meta = file.data.meta as unknown as ChatMeta | null;
    expect(meta).toEqual({ logLength: 0 });
  });
});

describe('appendChatLog — happy path bumps meta.logLength atomically', () => {
  it('first append (3 entries) sets meta.logLength=3 and content.log.length=3 in one statement', async () => {
    const { chatId } = await createDraftChat(ADMIN);

    const diff = [
      makeUserEntry('hi', 'u1'),
      makeUserEntry('again', 'u2'),
      makeUserEntry('one more', 'u3'),
    ];
    const result = await appendChatLog(chatId, diff, 0, ADMIN);
    expect(result).toEqual({ chatId, forked: false });

    const file = await FilesAPI.loadFile(chatId, ADMIN);
    expect((file.data.content as unknown as ChatContent).log).toHaveLength(3);
    expect((file.data.meta as unknown as ChatMeta).logLength).toBe(3);
  });

  it('subsequent append with correct expectedLogIndex extends log + bumps logLength', async () => {
    const { chatId } = await createDraftChat(ADMIN);
    await appendChatLog(chatId, [makeUserEntry('a', 'a1'), makeUserEntry('b', 'b1'), makeUserEntry('c', 'c1')], 0, ADMIN);

    const more = [makeUserEntry('d', 'd1'), makeUserEntry('e', 'e1')];
    const r2 = await appendChatLog(chatId, more, 3, ADMIN);
    expect(r2).toEqual({ chatId, forked: false });

    const file = await FilesAPI.loadFile(chatId, ADMIN);
    expect((file.data.content as unknown as ChatContent).log).toHaveLength(5);
    expect((file.data.meta as unknown as ChatMeta).logLength).toBe(5);
  });
});

describe('appendChatLog — forks on length mismatch with forkedFrom + forkedAt in meta', () => {
  it('stale expectedLogIndex creates a new chat with proper fork metadata', async () => {
    const { chatId } = await createDraftChat(ADMIN);
    await appendChatLog(
      chatId,
      [makeUserEntry('x', 'x1'), makeUserEntry('y', 'y1'), makeUserEntry('z', 'z1')],
      0,
      ADMIN,
    );

    const stale = [makeUserEntry('stale-1', 's1'), makeUserEntry('stale-2', 's2')];
    const beforeFork = Date.now();
    const r = await appendChatLog(chatId, stale, 0, ADMIN); // expected=0, actual=3 → fork
    const afterFork = Date.now();

    expect(r.forked).toBe(true);
    expect(r.chatId).not.toBe(chatId);

    // Original unchanged.
    const original = await FilesAPI.loadFile(chatId, ADMIN);
    expect((original.data.content as unknown as ChatContent).log).toHaveLength(3);
    expect((original.data.meta as unknown as ChatMeta).logLength).toBe(3);
    expect((original.data.meta as unknown as ChatMeta).forkedFrom).toBeUndefined();

    // Forked chat has slice(0, 0) + diff = just the diff. Meta carries forkedFrom + forkedAt.
    const forked = await FilesAPI.loadFile(r.chatId, ADMIN);
    expect((forked.data.content as unknown as ChatContent).log).toHaveLength(2);
    const forkedMeta = forked.data.meta as unknown as ChatMeta;
    expect(forkedMeta.logLength).toBe(2);
    expect(forkedMeta.forkedFrom).toBe(chatId);
    expect(forkedMeta.forkedAt).toBeDefined();
    const forkedAtMs = Date.parse(forkedMeta.forkedAt!);
    expect(forkedAtMs).toBeGreaterThanOrEqual(beforeFork);
    expect(forkedAtMs).toBeLessThanOrEqual(afterFork + 1000);

    // The fork is PUBLISHED — never a draft. A draft fork would be invisible
    // to sidebar listings (DocumentDB.listAll filters drafts out), so this
    // assertion is what guarantees the fork shows up in the user's chat list.
    expect(forked.data.draft).toBe(false);
  });
});

describe('sidebar-cheap read: listAll(includeContent: false)', () => {
  it('returns meta (logLength, forkedFrom) without paying a content read — the headline use case', async () => {
    // Two chats: one with 3 entries, one freshly forked off it.
    const { chatId: chatA } = await createDraftChat(ADMIN);
    await appendChatLog(
      chatA,
      [makeUserEntry('one', 'o1'), makeUserEntry('two', 't1'), makeUserEntry('three', 'th1')],
      0,
      ADMIN,
    );

    const { chatId: chatB } = await createDraftChat(ADMIN);
    await appendChatLog(chatB, [makeUserEntry('only', 'b1')], 0, ADMIN);
    // Now make chatB a fork by stale-appending against chatA.
    const fork = await appendChatLog(chatA, [makeUserEntry('stale', 'st1')], 0, ADMIN);
    expect(fork.forked).toBe(true);

    // Metadata-only listing.
    const metaRows = await DocumentDB.listAll('chat', undefined, undefined, /* includeContent */ false);

    expect(metaRows.length).toBeGreaterThanOrEqual(2);

    for (const row of metaRows) {
      // The whole point of sidebar-cheap reads: NO content payload.
      expect(row.content).toBeNull();
      // But meta IS populated.
      const m = row.meta as unknown as ChatMeta | null;
      expect(m).not.toBeNull();
      expect(typeof m!.logLength).toBe('number');
    }

    // The fork's meta carries forkedFrom + forkedAt.
    const forkedRow = metaRows.find((r) => r.id === fork.chatId)!;
    const forkedMeta = forkedRow.meta as unknown as ChatMeta;
    expect(forkedMeta.forkedFrom).toBe(chatA);
    expect(forkedMeta.forkedAt).toBeDefined();

    // Sanity: with includeContent: true, content IS present.
    const fullRows = await DocumentDB.listAll('chat', undefined, undefined, /* includeContent */ true);
    const fullChatA = fullRows.find((r) => r.id === chatA)!;
    expect(fullChatA.content).not.toBeNull();
    expect((fullChatA.content as unknown as ChatContent).log.length).toBeGreaterThan(0);
  });
});

describe('concurrent appendChatLog — race excluded by the conditional UPDATE', () => {
  it('two parallel appends with the same expectedLogIndex: one in-place, one forked', async () => {
    const { chatId } = await createDraftChat(ADMIN);

    const diffA = [makeUserEntry('A1', 'A1'), makeUserEntry('A2', 'A2')];
    const diffB = [makeUserEntry('B1', 'B1')];

    const [rA, rB] = await Promise.all([
      appendChatLog(chatId, diffA, 0, ADMIN),
      appendChatLog(chatId, diffB, 0, ADMIN),
    ]);

    const inPlace = [rA, rB].filter((r) => !r.forked);
    const forked = [rA, rB].filter((r) => r.forked);
    expect(inPlace).toHaveLength(1);
    expect(forked).toHaveLength(1);

    // Original took the winner's diff.
    const original = await FilesAPI.loadFile(chatId, ADMIN);
    const origLength = (original.data.meta as unknown as ChatMeta).logLength;
    expect([1, 2]).toContain(origLength);
    expect((original.data.content as unknown as ChatContent).log).toHaveLength(origLength);

    // Forked file is real and reachable; meta references the original; published.
    const forkedFile = await FilesAPI.loadFile(forked[0].chatId, ADMIN);
    const forkedMeta = forkedFile.data.meta as unknown as ChatMeta;
    expect(forkedMeta.forkedFrom).toBe(chatId);
    expect(forkedMeta.forkedAt).toBeDefined();
    expect(forkedMeta.logLength).toBe((forkedFile.data.content as unknown as ChatContent).log.length);
    expect(forkedFile.data.draft).toBe(false); // sidebar visibility
  });
});

describe('appendChatLog — defensive type guard', () => {
  it('refuses to append to a non-chat file (returns forked=true via the fallback path)', async () => {
    // Create a file of a different type. We use the lower-level DocumentDB
    // directly because FilesAPI's createFile would (correctly) reject e.g. a
    // 'folder' as a chat path. The point is: even if a caller MIS-uses
    // appendChatLog with a non-chat id, the type guard refuses to corrupt it.
    const folderId = await DocumentDB.create(
      'not-a-chat-folder', '/org/not-a-chat-folder', 'folder', { description: '' }, [],
    );
    // Publish so it's a real file.
    await DocumentDB.update(folderId, 'not-a-chat-folder', '/org/not-a-chat-folder',
      { description: '' }, [], 'pub-not-a-chat');

    const updated = await DocumentDB.appendChatLog(folderId, [makeUserEntry('hi', 'h1')], 0);
    expect(updated).toBe(false); // type guard rejected the UPDATE.

    // The folder was NOT mutated.
    const folder = await FilesAPI.loadFile(folderId, ADMIN);
    expect(folder.data.type).toBe('folder');
    expect((folder.data.content as { description?: string }).description).toBe('');
    // No log was inserted.
    expect((folder.data.content as Record<string, unknown>).log).toBeUndefined();
  });
});

describe('appendChatLog — happy path leaves the chat published (not draft)', () => {
  it('first successful append publishes the draft chat', async () => {
    const { chatId } = await createDraftChat(ADMIN);
    // Sanity: freshly drafted, not visible to sidebar listings yet.
    const beforeAppend = await FilesAPI.loadFile(chatId, ADMIN);
    expect(beforeAppend.data.draft).toBe(true);

    await appendChatLog(chatId, [makeUserEntry('publish me', 'p1')], 0, ADMIN);

    const afterAppend = await FilesAPI.loadFile(chatId, ADMIN);
    expect(afterAppend.data.draft).toBe(false); // sidebar visibility
    expect((afterAppend.data.meta as unknown as ChatMeta).logLength).toBe(1);
  });
});
