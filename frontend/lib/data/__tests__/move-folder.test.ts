/**
 * Folder move tests — moving a folder must carry its auto-created context file
 * with it (the same cascade exemption the delete path applies), while bare
 * context files and other protected types stay immovable.
 *
 * Run: npm test -- move-folder.test.ts
 */

import { FilesAPI } from '@/lib/data/files.server';
import { DocumentDB } from '@/lib/database/documents-db';
import {
  initTestDatabase,
  cleanupTestDatabase,
  getTestDbPath
} from '@/store/__tests__/test-utils';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const TEST_DB_PATH = getTestDbPath('move-folder');

const testUser: EffectiveUser = {
  userId: 1,
  name: 'Test User',
  email: 'test@example.com',
  role: 'admin',
  mode: 'org',
  home_folder: ''
};

async function createFolder(path: string): Promise<number> {
  const name = path.split('/').pop()!;
  const result = await FilesAPI.createFile(
    { name, path, type: 'folder', content: { name } },
    testUser
  );
  return result.data.id;
}

describe('FilesAPI.moveFile — folders', () => {
  beforeAll(async () => {
    await initTestDatabase(TEST_DB_PATH);
  });

  afterAll(async () => {
    await cleanupTestDatabase(TEST_DB_PATH);
  });

  it('moves a folder along with its auto-created context file', async () => {
    const sourceId = await createFolder('/org/move-src');
    await createFolder('/org/move-dest');

    expect(await DocumentDB.getByPath('/org/move-src/context')).not.toBeNull();

    const result = await FilesAPI.moveFile(
      { id: sourceId, name: 'move-src', newPath: '/org/move-dest/move-src' },
      testUser
    );

    expect(result.path).toBe('/org/move-dest/move-src');
    expect(await DocumentDB.getByPath('/org/move-src/context')).toBeNull();
    const movedContext = await DocumentDB.getByPath('/org/move-dest/move-src/context');
    expect(movedContext).not.toBeNull();
    expect(movedContext!.type).toBe('context');
  });

  it('moves nested subfolders and their context files in one operation', async () => {
    const outerId = await createFolder('/org/nest-outer');
    await createFolder('/org/nest-outer/inner');
    await createFolder('/org/nest-dest');

    await FilesAPI.moveFile(
      { id: outerId, name: 'nest-outer', newPath: '/org/nest-dest/nest-outer' },
      testUser
    );

    expect(await DocumentDB.getByPath('/org/nest-dest/nest-outer/context')).not.toBeNull();
    expect(await DocumentDB.getByPath('/org/nest-dest/nest-outer/inner/context')).not.toBeNull();
    expect(await DocumentDB.getByPath('/org/nest-outer')).toBeNull();
  });

  it('still refuses to move a bare context file on its own', async () => {
    await createFolder('/org/ctx-holder');
    await createFolder('/org/ctx-dest');
    const context = await DocumentDB.getByPath('/org/ctx-holder/context');
    expect(context).not.toBeNull();

    await expect(
      FilesAPI.moveFile(
        { id: context!.id, name: 'context', newPath: '/org/ctx-dest/context' },
        testUser
      )
    ).rejects.toThrow(/Cannot move file of type/);
  });

  it('still refuses to move a folder containing a non-context protected file', async () => {
    const folderId = await createFolder('/org/cfg-holder');
    await createFolder('/org/cfg-dest');
    // draft=false: config files are live on create (LIVE_ON_CREATE_TYPES)
    await DocumentDB.create('config', '/org/cfg-holder/config', 'config', {}, [], undefined, false);

    await expect(
      FilesAPI.moveFile(
        { id: folderId, name: 'cfg-holder', newPath: '/org/cfg-dest/cfg-holder' },
        testUser
      )
    ).rejects.toThrow(/protected type/);
  });

  it('refuses to move a folder into itself or its own subtree', async () => {
    const folderId = await createFolder('/org/cycle-outer');
    await createFolder('/org/cycle-outer/sub');

    await expect(
      FilesAPI.moveFile(
        { id: folderId, name: 'cycle-outer', newPath: '/org/cycle-outer/sub/cycle-outer' },
        testUser
      )
    ).rejects.toThrow(/into itself/);

    // The tree is untouched
    expect(await DocumentDB.getByPath('/org/cycle-outer/sub')).not.toBeNull();
    expect(await DocumentDB.getByPath('/org/cycle-outer/sub/cycle-outer')).toBeNull();
  });

  it('delete still cascades the context file with its folder', async () => {
    const folderId = await createFolder('/org/del-me');
    expect(await DocumentDB.getByPath('/org/del-me/context')).not.toBeNull();

    await FilesAPI.deleteFile(folderId, testUser);

    expect(await DocumentDB.getByPath('/org/del-me')).toBeNull();
    expect(await DocumentDB.getByPath('/org/del-me/context')).toBeNull();
  });
});
