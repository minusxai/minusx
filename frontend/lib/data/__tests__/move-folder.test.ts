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

  it('rewrites childPaths references to the moved folder across context documents', async () => {
    const srcId = await createFolder('/org/cp-src');
    await createFolder('/org/cp-src/sub');
    await createFolder('/org/cp-dest');

    // Root context grants things to the folder being moved (exact and descendant
    // paths), via every childPaths carrier: whitelist nodes, docs, views, models.
    const rootCtx = await DocumentDB.getByPath('/org/context');
    expect(rootCtx).not.toBeNull();
    const rootContent = {
      ...(rootCtx!.content as Record<string, unknown>),
      versions: [{
        version: 1,
        whitelist: [
          { name: 'warehouse', type: 'connection', children: [
            { name: 'finance', type: 'schema', childPaths: ['/org/cp-src', '/org/elsewhere'] },
            { name: 'kpi', type: 'schema', childPaths: ['/org/cp-src/sub'] }
          ]}
        ],
        docs: [{ title: 'src-doc', content: 'doc', childPaths: ['/org/cp-src'] }],
        views: [{
          name: 'v1', connection: 'warehouse', sql: 'SELECT 1',
          reads: { tables: [], views: [] }, childPaths: ['/org/cp-src']
        }],
        semanticModels: [{
          name: 'm1', connection: 'warehouse',
          primary: { kind: 'table', schema: 'finance', table: 't' },
          dimensions: [], metrics: [], childPaths: ['/org/cp-src/sub']
        }],
        createdAt: new Date().toISOString(),
        createdBy: 1
      }],
      published: { all: 1 }
    };
    await DocumentDB.update(rootCtx!.id, 'context', '/org/context', rootContent, [], 'seed-root-cp');

    // The moved folder's own context grants to its descendant — that path moves too.
    const srcCtx = await DocumentDB.getByPath('/org/cp-src/context');
    const srcContent = {
      ...(srcCtx!.content as Record<string, unknown>),
      versions: [{
        version: 1,
        whitelist: '*',
        docs: [{ title: 'inner-doc', content: 'doc', childPaths: ['/org/cp-src/sub'] }],
        createdAt: new Date().toISOString(),
        createdBy: 1
      }],
      published: { all: 1 }
    };
    await DocumentDB.update(srcCtx!.id, 'context', '/org/cp-src/context', srcContent, [], 'seed-src-cp');

    await FilesAPI.moveFile({ id: srcId, name: 'cp-src', newPath: '/org/cp-dest/cp-src' }, testUser);

    const root = (await DocumentDB.getByPath('/org/context'))!.content as any;
    const [conn] = root.versions[0].whitelist;
    expect(conn.children[0].childPaths).toEqual(['/org/cp-dest/cp-src', '/org/elsewhere']);
    expect(conn.children[1].childPaths).toEqual(['/org/cp-dest/cp-src/sub']);
    expect(root.versions[0].docs[0].childPaths).toEqual(['/org/cp-dest/cp-src']);
    expect(root.versions[0].views[0].childPaths).toEqual(['/org/cp-dest/cp-src']);
    expect(root.versions[0].semanticModels[0].childPaths).toEqual(['/org/cp-dest/cp-src/sub']);

    const moved = (await DocumentDB.getByPath('/org/cp-dest/cp-src/context'))!.content as any;
    expect(moved.versions[0].docs[0].childPaths).toEqual(['/org/cp-dest/cp-src/sub']);
  });

  it('leaves childPaths of prefix-similar but distinct folders untouched', async () => {
    const srcId = await createFolder('/org/pfx');
    await createFolder('/org/pfx-other');
    await createFolder('/org/pfx-dest');

    const otherCtx = await DocumentDB.getByPath('/org/pfx-other/context');
    const otherContent = {
      ...(otherCtx!.content as Record<string, unknown>),
      versions: [{
        version: 1,
        whitelist: '*',
        // '/org/pfx-other' shares the '/org/pfx' prefix but is NOT inside it.
        docs: [{ title: 'other-doc', content: 'doc', childPaths: ['/org/pfx-other/deep'] }],
        createdAt: new Date().toISOString(),
        createdBy: 1
      }],
      published: { all: 1 }
    };
    await DocumentDB.update(otherCtx!.id, 'context', '/org/pfx-other/context', otherContent, [], 'seed-pfx-other');

    await FilesAPI.moveFile({ id: srcId, name: 'pfx', newPath: '/org/pfx-dest/pfx' }, testUser);

    const other = (await DocumentDB.getByPath('/org/pfx-other/context'))!.content as any;
    expect(other.versions[0].docs[0].childPaths).toEqual(['/org/pfx-other/deep']);
  });

  it('a move that fails mid-statement changes nothing — paths or childPaths (atomicity)', async () => {
    const srcId = await createFolder('/org/at-src');
    await createFolder('/org/at-src/sub');
    await createFolder('/org/at-dest');

    const rootCtx = await DocumentDB.getByPath('/org/context');
    const rootContent = {
      ...(rootCtx!.content as Record<string, unknown>),
      versions: [{
        version: 1,
        whitelist: '*',
        docs: [{ title: 'at-doc', content: 'doc', childPaths: ['/org/at-src'] }],
        createdAt: new Date().toISOString(),
        createdBy: 1
      }],
      published: { all: 1 }
    };
    await DocumentDB.update(rootCtx!.id, 'context', '/org/context', rootContent, [], 'seed-at');

    // Real fault injection: a PUBLISHED file already occupies a path the move
    // needs, so the single UPDATE trips the published-path unique index part-way
    // through its rows. The statement must roll back AS A WHOLE.
    await DocumentDB.create('squatter', '/org/at-dest/at-src/sub', 'question', { sql: '' }, [], undefined, false);

    await expect(
      FilesAPI.moveFile({ id: srcId, name: 'at-src', newPath: '/org/at-dest/at-src' }, testUser)
    ).rejects.toThrow();

    // Nothing moved and nothing was rewritten: all-or-nothing.
    expect(await DocumentDB.getByPath('/org/at-src')).not.toBeNull();
    expect(await DocumentDB.getByPath('/org/at-src/sub')).not.toBeNull();
    expect(await DocumentDB.getByPath('/org/at-dest/at-src')).toBeNull();
    const root = (await DocumentDB.getByPath('/org/context'))!.content as any;
    expect(root.versions[0].docs[0].childPaths).toEqual(['/org/at-src']);
  });

  it('delete still cascades the context file with its folder', async () => {
    const folderId = await createFolder('/org/del-me');
    expect(await DocumentDB.getByPath('/org/del-me/context')).not.toBeNull();

    await FilesAPI.deleteFile(folderId, testUser);

    expect(await DocumentDB.getByPath('/org/del-me')).toBeNull();
    expect(await DocumentDB.getByPath('/org/del-me/context')).toBeNull();
  });
});
