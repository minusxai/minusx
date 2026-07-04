// Verifies the admin-only share-management layer on the server FilesAPI:
// addShare mints a decodable link + persists a record in file.meta.shares,
// getShares lists them, revokeShare soft-revokes, and the guards (admin-only,
// story-only) hold.

import { addShare, getShares, revokeShare, resolveShare, createFile } from '@/lib/data/files.server';
import { decodeShareLink, isLiveShareNonce } from '@/lib/auth/share-tokens';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const TEST_DB_PATH = getTestDbPath('file_shares');

const ADMIN: EffectiveUser = {
  userId: 1, email: 'admin@example.com', name: 'Admin',
  role: 'admin', home_folder: '/org', mode: 'org',
};
const VIEWER: EffectiveUser = {
  userId: 2, email: 'viewer@example.com', name: 'Viewer',
  role: 'viewer', home_folder: 'demos/acme', mode: 'org',
};

async function makeFolders(): Promise<void> {
  for (const path of ['/org/demos', '/org/demos/acme']) {
    await createFile(
      { type: 'folder', name: path.split('/').pop()!, path, content: {} },
      ADMIN,
    );
  }
}

async function makeStory(name = 'Acme Demo Story'): Promise<number> {
  await makeFolders();
  const res = await createFile(
    {
      type: 'story',
      name,
      path: '/org/demos/acme/story',
      content: { description: null, assets: [], story: '<h1>Hi</h1>' },
    },
    ADMIN,
  );
  return res.data.id;
}

async function makeQuestion(): Promise<number> {
  await makeFolders();
  const res = await createFile(
    {
      type: 'question',
      name: 'A Question',
      path: '/org/demos/acme/q',
      content: { query: 'SELECT 1', connection_name: 'default', vizSettings: { type: 'table' } },
    },
    ADMIN,
  );
  return res.data.id;
}

describe('FilesAPI share management', () => {
  setupTestDb(TEST_DB_PATH);

  it('addShare mints a decodable link and persists a record', async () => {
    const fileId = await makeStory();
    const { shareableId, record } = await addShare(fileId, ADMIN);

    expect(decodeShareLink(shareableId)).toEqual({ nonce: record.nonce });

    const shares = await getShares(fileId, ADMIN);
    expect(shares).toHaveLength(1);
    expect(shares[0].nonce).toBe(record.nonce);
    expect(isLiveShareNonce(record.nonce, shares)).toBe(true);
  });

  it('resolveShare looks the story up by nonce (no fileId in the link)', async () => {
    const fileId = await makeStory();
    const { shareableId } = await addShare(fileId, ADMIN);

    const resolved = await resolveShare(shareableId);
    expect(resolved?.file.id).toBe(fileId);
    expect(resolved?.file.type).toBe('story');

    // garbage, and a revoked link, both fail to resolve
    expect(await resolveShare('does-not-exist-abcdefghij')).toBeNull();
    await revokeShare(fileId, ADMIN, resolved!.nonce);
    expect(await resolveShare(shareableId)).toBeNull();
  });

  it('accumulates multiple links and revokeShare soft-revokes by nonce', async () => {
    const fileId = await makeStory();
    const a = await addShare(fileId, ADMIN);
    const b = await addShare(fileId, ADMIN);

    let shares = await getShares(fileId, ADMIN);
    expect(shares).toHaveLength(2);

    const didRevoke = await revokeShare(fileId, ADMIN, a.record.nonce);
    expect(didRevoke).toBe(true);

    shares = await getShares(fileId, ADMIN);
    expect(isLiveShareNonce(a.record.nonce, shares)).toBe(false);
    expect(isLiveShareNonce(b.record.nonce, shares)).toBe(true);

    // revoking again is a no-op
    expect(await revokeShare(fileId, ADMIN, a.record.nonce)).toBe(false);
  });

  it('rejects non-admins', async () => {
    const fileId = await makeStory();
    await expect(addShare(fileId, VIEWER)).rejects.toThrow();
    await expect(getShares(fileId, VIEWER)).rejects.toThrow();
  });

  it('rejects non-story file types', async () => {
    const questionId = await makeQuestion();
    await expect(addShare(questionId, ADMIN)).rejects.toThrow();
  });
});
