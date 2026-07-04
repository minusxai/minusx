// Integration test for the REAL agent create/publish path (server FilesAPI), not just DocumentDB.
// Mirrors what `createDraftFile` → CreateFile/Navigate does: FilesAPI.createFile WITHOUT
// returnExisting, at a deterministic slug path. Exercises validateFileLocation, parent-folder
// checks, permissions, and the partial unique index end-to-end. Real PGLite via initTestDatabase.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FilesAPI } from '@/lib/data/files.server';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { FolderContent, QuestionContent } from '@/lib/types';
import { cleanupTestDatabase, getTestDbPath, initTestDatabase } from '@/store/__tests__/test-utils';

const dbPath = getTestDbPath('createfile_draft_collision');

const ADMIN: EffectiveUser = {
  userId: 1, email: 'admin@example.com', name: 'Admin', role: 'admin', home_folder: '/org', mode: 'org',
};

const FOLDER = '/org/draft-collision-test';
const SHARED = `${FOLDER}/sales-report`;
const makeQuestion = (query = 'SELECT 1'): QuestionContent => ({
  description: '', query, vizSettings: { type: 'table', xCols: [], yCols: [] }, parameters: [], connection_name: 'test',
});
// createDraftFile passes NO options (no returnExisting) — replicate exactly.
const createNamedDraft = () =>
  FilesAPI.createFile(
    { name: 'Sales Report', path: SHARED, type: 'question', content: makeQuestion() },
    ADMIN,
  );

beforeAll(async () => {
  await initTestDatabase(dbPath);
  await FilesAPI.createFile(
    { name: 'draft-collision-test', path: FOLDER, type: 'folder', content: { description: '' } as FolderContent, references: [], options: { returnExisting: true } },
    ADMIN,
  );
});
afterAll(async () => { await cleanupTestDatabase(dbPath); });

describe('agent create-twice (real FilesAPI path): drafts at the same path coexist', () => {
  it('creating the same named file twice yields two distinct coexisting drafts (no UNIQUE error)', async () => {
    const a = await createNamedDraft();
    const b = await createNamedDraft(); // before the partial-index fix: threw a UNIQUE(path) violation
    expect(a.data.id).not.toBe(b.data.id);
    expect(a.data.draft).toBe(true);
    expect(b.data.draft).toBe(true);
    expect(a.data.path).toBe(SHARED);
    expect(b.data.path).toBe(SHARED);
  });

  it('publishing one draft then the other (real saveFile→update path) rejects the 2nd with a rename message', async () => {
    const first = await createNamedDraft();
    const second = await createNamedDraft();

    // Publish the first (draft → false) — succeeds, claims the path.
    const published = await FilesAPI.saveFile(first.data.id, 'Sales Report', SHARED, makeQuestion(), [], ADMIN);
    expect(published.data.draft).toBe(false);

    // Publish the second onto the now-occupied published path — rejected with the friendly message.
    // This goes saveFile → DocumentDB.update (NOT batchSave), proving the translation is on the real path.
    await expect(
      FilesAPI.saveFile(second.data.id, 'Sales Report', SHARED, makeQuestion(), [], ADMIN),
    ).rejects.toThrow(/already exists at this path|rename/i);

    // The rejected file stays a draft (write rolled back by the failed UPDATE).
    const stillDraft = await FilesAPI.loadFile(second.data.id, ADMIN);
    expect(stillDraft.data.draft).toBe(true);
  });
});
