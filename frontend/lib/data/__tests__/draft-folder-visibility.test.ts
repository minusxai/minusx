// Draft files must NOT appear in folder view. The folder browser lists a folder's children via
// GET /api/files → FilesAPI.getFiles → DocumentDB.listAll, and listAll unconditionally ANDs
// `draft = false` into its WHERE (documents-db.ts) — that single line is the whole guarantee. An
// agent-created question starts as a draft, so it stays invisible in the folder until the user Saves
// (publish flips draft → false). This test guards the folder-view DATA PATH (getFiles), the layer
// that actually enforces the rule; the UI only renders what getFiles returns.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FilesAPI } from '@/lib/data/files.server';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { FolderContent, QuestionContent } from '@/lib/types';
import { cleanupTestDatabase, getTestDbPath, initTestDatabase } from '@/store/__tests__/test-utils';

const dbPath = getTestDbPath('draft_folder_visibility');

const ADMIN: EffectiveUser = {
  userId: 1, email: 'admin@example.com', name: 'Admin', role: 'admin', home_folder: '/org', mode: 'org',
};

const FOLDER = '/org/draft-visibility-test';
const makeQuestion = (query = 'SELECT 1'): QuestionContent => ({
  description: '', query, vizSettings: { type: 'table', xCols: [], yCols: [] }, parameters: [], connection_name: 'test',
});

const listFolder = () => FilesAPI.getFiles({ paths: [FOLDER], depth: 1 }, ADMIN);

beforeAll(async () => {
  await initTestDatabase(dbPath);
  await FilesAPI.createFile(
    { name: 'draft-visibility-test', path: FOLDER, type: 'folder', content: { description: '' } as FolderContent, references: [], options: { returnExisting: true } },
    ADMIN,
  );
});
afterAll(async () => { await cleanupTestDatabase(dbPath); });

describe('folder view hides draft files', () => {
  it('a freshly created (draft) question is absent from the folder listing, then appears once published', async () => {
    const created = await FilesAPI.createFile(
      { name: 'Revenue Draft', path: `${FOLDER}/revenue-draft`, type: 'question', content: makeQuestion() },
      ADMIN,
    );
    expect(created.data.draft).toBe(true); // agent-created questions start as drafts

    // While a draft: NOT listed in its folder (the whole point).
    const before = await listFolder();
    expect(before.data.some(f => f.id === created.data.id)).toBe(false);

    // Publish it (the real Save path flips draft → false).
    const published = await FilesAPI.saveFile(created.data.id, 'Revenue Draft', `${FOLDER}/revenue-draft`, makeQuestion(), [], ADMIN);
    expect(published.data.draft).toBe(false);

    // Now it shows up in the folder.
    const after = await listFolder();
    expect(after.data.some(f => f.id === created.data.id)).toBe(true);
  });

  it('a folder containing ONLY drafts lists as empty', async () => {
    const a = await FilesAPI.createFile({ name: 'Draft A', path: `${FOLDER}/draft-a`, type: 'question', content: makeQuestion() }, ADMIN);
    const b = await FilesAPI.createFile({ name: 'Draft B', path: `${FOLDER}/draft-b`, type: 'question', content: makeQuestion() }, ADMIN);
    expect(a.data.draft && b.data.draft).toBe(true);

    const listing = await listFolder();
    // Neither draft is present; the only visible child is the published one from the first test.
    expect(listing.data.some(f => f.id === a.data.id)).toBe(false);
    expect(listing.data.some(f => f.id === b.data.id)).toBe(false);
  });
});
