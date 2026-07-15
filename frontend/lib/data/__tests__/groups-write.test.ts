/**
 * Group WRITE access (Access V2): a group whose `createTypes` include a type
 * lets members create/edit/delete files of that type under the group's folder
 * scopes — the other half of "many view, few edit". Base (role + home) write
 * behavior is unchanged; groups are an additive OR. Universal guards
 * (creation/deletion blocklists, protected paths, location restrictions) are
 * NOT bypassed by groups.
 *
 * Written red-first against FilesAPI (the real enforcement surface).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestDbPath, initTestDatabase, cleanupTestDatabase } from '@/store/__tests__/test-utils';
import { DocumentDB } from '@/lib/database/documents-db';
import { FilesAPI } from '@/lib/data/files.server';
import { createGroup, updateGroup, deleteGroup } from '@/lib/data/groups.server';
import { UserDB } from '@/lib/database/user-db';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { BaseFileContent, QuestionContent } from '@/lib/types';

const DB = getTestDbPath('groups_write');
const editor: EffectiveUser = { userId: 21, email: 'e@x.co', name: 'E', role: 'editor', home_folder: 'sales', mode: 'org' };
const viewer: EffectiveUser = { userId: 22, email: 'v@x.co', name: 'V', role: 'viewer', home_folder: 'sales', mode: 'org' };

const q = (sql = 'select 1'): QuestionContent => ({ query: sql, connection_name: '', parameters: [], vizSettings: { type: 'table', xCols: [], yCols: [] } } as unknown as QuestionContent);

const adminUser: EffectiveUser = { userId: 1, email: 'a@x.co', name: 'A', role: 'admin', home_folder: '', mode: 'org' };

beforeAll(async () => {
  await initTestDatabase(DB);
  await DocumentDB.create('finance', '/org/finance', 'folder', { name: 'finance' } as BaseFileContent, [], undefined, false);
  await DocumentDB.create('shared_q', '/org/finance/shared_q', 'question', q() as unknown as BaseFileContent, [], undefined, false);
  await DocumentDB.create('view_q', '/org/finance/view_q', 'question', q() as unknown as BaseFileContent, [], undefined, false);
  // The write/view users need real rows (membership lives on the users table).
  await UserDB.create('e21@x.co', 'E', 'sales', { role: 'editor', password_hash: 'h' });
  await UserDB.create('v22@x.co', 'V', 'sales', { role: 'viewer', password_hash: 'h' });
  const rows = await UserDB.listAll();
  editor.userId = rows.find(u => u.email === 'e21@x.co')!.id;
  viewer.userId = rows.find(u => u.email === 'v22@x.co')!.id;
  await createGroup({
    name: 'Finance-Builders',
    allowedTypes: ['question', 'dashboard', 'folder'], viewTypes: ['question', 'dashboard', 'folder'],
    createTypes: ['question', 'dashboard', 'folder'],
    folders: ['finance'], memberIds: [editor.userId!],
  }, adminUser);
  await createGroup({
    name: 'Finance-Viewers',
    allowedTypes: ['question', 'dashboard', 'folder'], viewTypes: ['question', 'dashboard', 'folder'],
    createTypes: [],
    folders: ['finance'], memberIds: [viewer.userId!],
  }, adminUser);
}, 30_000);
afterAll(async () => { await cleanupTestDatabase(DB); });

describe('group write access', () => {
  it('Build-group member can CREATE in the group folder (outside their home)', async () => {
    const { data } = await FilesAPI.createFile({ name: 'new_q', path: '/org/finance/new_q', type: 'question', content: q() as unknown as BaseFileContent }, editor);
    expect(data.path).toBe('/org/finance/new_q');
  });

  it('Build-group member can EDIT a file in the group folder', async () => {
    const existing = await DocumentDB.getByPath('/org/finance/shared_q');
    const { data } = await FilesAPI.saveFile(existing!.id, 'shared_q', existing!.path, q('select 2') as unknown as BaseFileContent, [], editor);
    expect((data.content as { query: string }).query).toBe('select 2');
  });

  it('Build-group member can DELETE a file in the group folder', async () => {
    const id = await DocumentDB.create('to_delete', '/org/finance/to_delete', 'question', q() as unknown as BaseFileContent, [], undefined, false);
    await FilesAPI.deleteFile(id, editor);
    expect(await DocumentDB.getById(id)).toBeNull();
  });

  it('View-group member can READ but NOT create/edit/delete in the group folder', async () => {
    const existing = await DocumentDB.getByPath('/org/finance/view_q');
    const read = await FilesAPI.loadFile(existing!.id, viewer);
    expect(read.data.path).toBe('/org/finance/view_q');
    await expect(FilesAPI.createFile({ name: 'nope', path: '/org/finance/nope', type: 'question', content: q() as unknown as BaseFileContent }, viewer))
      .rejects.toThrow(/permission|home folder/i);
    await expect(FilesAPI.saveFile(existing!.id, 'view_q', existing!.path, q('select 3') as unknown as BaseFileContent, [], viewer))
      .rejects.toThrow(/permission/i);
    await expect(FilesAPI.deleteFile(existing!.id, viewer)).rejects.toThrow(/permission|home folder/i);
  });

  it('non-member editor cannot write in the folder (base behavior unchanged)', async () => {
    const outsider: EffectiveUser = { userId: 23, email: 'o@x.co', name: 'O', role: 'editor', home_folder: 'sales', mode: 'org' };
    await expect(FilesAPI.createFile({ name: 'outsider_q', path: '/org/finance/outsider_q', type: 'question', content: q() as unknown as BaseFileContent }, outsider))
      .rejects.toThrow(/home folder/i);
  });

  it('group write cannot bypass universal guards (config creation stays blocked)', async () => {
    await createGroup({
      name: 'Everything', allowedTypes: '*', viewTypes: '*', createTypes: '*',
      folders: [''], memberIds: [editor.userId!],
    }, adminUser);
    try {
      await expect(FilesAPI.createFile({ name: 'evil_config', path: '/org/finance/evil_config', type: 'config', content: {} as BaseFileContent }, editor))
        .rejects.toThrow(/cannot be manually created|system-managed/i);
    } finally {
      await updateGroup('Everything', { name: 'Everything', allowedTypes: '*', viewTypes: '*', createTypes: '*', folders: [''], memberIds: [] }, adminUser);
      await deleteGroup('Everything', adminUser);
    }
  });

  it('group write is scope-bounded — no write outside the group folder', async () => {
    await expect(FilesAPI.createFile({ name: 'mq', path: '/org/marketing/mq', type: 'question', content: q() as unknown as BaseFileContent }, editor))
      .rejects.toThrow(/home folder|permission/i);
  });
});
