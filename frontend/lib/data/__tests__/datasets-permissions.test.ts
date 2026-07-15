/**
 * THE point of datasets: an EDITOR can add data to their own folder and use it
 * immediately — no admin, no connection ceremony. Through the REAL FilesAPI
 * write path (the same gate the upload route, the agent's EditFile and the
 * JSON editor hit):
 *
 *  - editor CREATES a dataset in their folder ✓ (viewer cannot; editor cannot
 *    outside their home)
 *  - the dataset SAVE-GATE enforces global schema.table uniqueness on create
 *    AND on edit (an agent rename cannot steal a taken name)
 *  - hiding a table is an ordinary edit by the dataset's owner
 */
import { FilesAPI } from '@/lib/data/files.server';
import { DocumentDB } from '@/lib/database/documents-db';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { getModules } from '@/lib/modules/registry';
import type { DatasetContent, DatasetTable } from '@/lib/types/datasets';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const TEST_DB_PATH = getTestDbPath('datasets_permissions');

const ADMIN: EffectiveUser = { userId: 1, name: 'A', email: 'a@e.com', role: 'admin', mode: 'org', home_folder: '' };
const EDITOR: EffectiveUser = { userId: 2, name: 'E', email: 'e@e.com', role: 'editor', mode: 'org', home_folder: 'sales' };
const VIEWER: EffectiveUser = { userId: 3, name: 'V', email: 'v@e.com', role: 'viewer', mode: 'org', home_folder: 'sales' };

const table = (schema: string, name: string): DatasetTable => ({
  filename: `${name}.csv`, table_name: name, schema_name: schema,
  s3_key: `org1/${schema}/${name}.csv`, file_format: 'csv', row_count: 1,
  columns: [{ name: 'id', type: 'BIGINT' }], source: 'upload',
});

const content = (tables: DatasetTable[], hidden?: string[]): DatasetContent =>
  ({ files: tables, ...(hidden ? { hiddenTables: hidden } : {}) });

// Folders are scaffolding here — seed them directly; the gates under test are
// the DATASET ones (create permissions + save-gate), exercised via FilesAPI.
async function mkFolder(path: string): Promise<void> {
  const id = await DocumentDB.create(path.split('/').pop()!, path, 'folder', { description: '' }, []);
  await DocumentDB.update(id, path.split('/').pop()!, path, { description: '' }, [], `init-${id}`);
}

describe('dataset creation permissions (real FilesAPI gate)', () => {
  setupTestDb(TEST_DB_PATH);

  beforeEach(async () => {
    await getModules().db.exec('DELETE FROM files', []);
    await mkFolder('/org');
    await mkFolder('/org/sales');
    await mkFolder('/org/marketing');
  });

  it('an EDITOR creates a dataset in their own folder — upload without an admin', async () => {
    const res = await FilesAPI.createFile({
      name: 'pipeline', path: '/org/sales/pipeline', type: 'dataset',
      content: content([table('sales', 'deals')]) as never, references: [],
    }, EDITOR);
    expect(res.data.id).toBeGreaterThan(0);
  });

  it('a VIEWER cannot create a dataset', async () => {
    await expect(FilesAPI.createFile({
      name: 'nope', path: '/org/sales/nope', type: 'dataset',
      content: content([table('v', 'x')]) as never, references: [],
    }, VIEWER)).rejects.toThrow();
  });

  it('an editor cannot create a dataset OUTSIDE their home folder', async () => {
    await expect(FilesAPI.createFile({
      name: 'sneaky', path: '/org/marketing/sneaky', type: 'dataset',
      content: content([table('m', 'x')]) as never, references: [],
    }, EDITOR)).rejects.toThrow();
  });
});

describe('dataset save-gate: global name uniqueness on create AND edit', () => {
  setupTestDb(TEST_DB_PATH);

  beforeEach(async () => {
    await getModules().db.exec('DELETE FROM files', []);
    await mkFolder('/org');
    await mkFolder('/org/sales');
    await mkFolder('/org/marketing');
    await FilesAPI.createFile({
      name: 'pipeline', path: '/org/sales/pipeline', type: 'dataset',
      content: content([table('public', 'data')]) as never, references: [],
    }, ADMIN);
  });

  it('creating a dataset with a TAKEN schema.table fails loudly — even from a sibling folder', async () => {
    await expect(FilesAPI.createFile({
      name: 'clash', path: '/org/marketing/clash', type: 'dataset',
      content: content([table('public', 'data')]) as never, references: [],
    }, ADMIN)).rejects.toThrow(/already exists/);
  });

  it('EDITING a dataset cannot rename a table onto a taken name (agent EditFile is bound too)', async () => {
    const other = await FilesAPI.createFile({
      name: 'other', path: '/org/marketing/other', type: 'dataset',
      content: content([table('marketing', 'ads')]) as never, references: [],
    }, ADMIN);
    await expect(FilesAPI.saveFile(
      other.data.id, 'other', '/org/marketing/other',
      content([table('public', 'data')]) as never, [], ADMIN,
    )).rejects.toThrow(/already exists/);
  });

  it('editing a dataset does NOT collide with itself (hide a table, keep names)', async () => {
    const docs = await DocumentDB.listAll('dataset', ['/org']);
    const id = docs[0].id;
    await expect(FilesAPI.saveFile(
      id, 'pipeline', '/org/sales/pipeline',
      content([table('public', 'data')], ['public.data']) as never, [], ADMIN,
    )).resolves.toBeTruthy();
  });
});
