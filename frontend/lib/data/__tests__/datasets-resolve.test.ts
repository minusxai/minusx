/**
 * Dataset resolution — the two invariants of static-data-as-files:
 *
 *  1. VISIBILITY: a dataset is queryable from its own folder and every folder
 *     beneath it — never above, never sideways. Root datasets are org-wide;
 *     a team's uploads stay theirs. Joins with ANCESTOR datasets follow (they
 *     share the resolved table set).
 *  2. GLOBAL NAMING: `schema.table` is unique per mode across ALL datasets —
 *     enforced at create/edit (like `_views` names), which is what keeps the
 *     query-cache key collision-free with no folder salt.
 *
 * Permission nuance proven here too: a folder-scoped NON-ADMIN must be able to
 * resolve ANCESTOR datasets (that's what makes root data org-wide) — the same
 * ancestor exception contexts already have — while a parent user's resolution
 * never includes a child's dataset.
 */
import { DocumentDB } from '@/lib/database/documents-db';
import { getVisibleTables, assertTableNamesAvailable, DatasetNameConflictError } from '@/lib/data/datasets.server';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { getModules } from '@/lib/modules/registry';
import { tableKey } from '@/lib/types/datasets';
import type { DatasetContent, DatasetTable } from '@/lib/types/datasets';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const TEST_DB_PATH = getTestDbPath('datasets_resolve');

const ADMIN: EffectiveUser = { userId: 1, name: 'A', email: 'a@e.com', role: 'admin', mode: 'org', home_folder: '' };
/** Editor pinned to /org/sales — the "non-admin who just wants to add a CSV". */
const SALES_EDITOR: EffectiveUser = { userId: 2, name: 'E', email: 'e@e.com', role: 'editor', mode: 'org', home_folder: 'sales' };

const table = (schema: string, name: string, over: Partial<DatasetTable> = {}): DatasetTable => ({
  filename: `${name}.csv`, table_name: name, schema_name: schema,
  s3_key: `org1/${schema}/${name}.csv`, file_format: 'csv', row_count: 10,
  columns: [{ name: 'id', type: 'BIGINT' }], source: 'upload', ...over,
});

async function mkDataset(path: string, tables: DatasetTable[], hiddenTables?: string[]): Promise<number> {
  const content: DatasetContent = { description: null, files: tables, ...(hiddenTables ? { hiddenTables } : {}) };
  const name = path.split('/').pop()!;
  const id = await DocumentDB.create(name, path, 'dataset', content, []);
  await DocumentDB.update(id, name, path, content, [], `init-${id}`);
  return id;
}

const names = (tables: DatasetTable[]) => tables.map(tableKey).sort();

describe('dataset visibility (folder-and-below)', () => {
  setupTestDb(TEST_DB_PATH);

  beforeEach(async () => {
    await getModules().db.exec('DELETE FROM files', []);
    // Root dataset (org-wide), a sales dataset, and a sibling marketing dataset.
    await mkDataset('/org/reference', [table('public', 'zones')]);
    await mkDataset('/org/sales/pipeline', [table('sales', 'deals')]);
    await mkDataset('/org/marketing/campaigns', [table('marketing', 'ads')]);
  });

  it('a folder sees its own datasets plus every ancestor\'s — so they are joinable', async () => {
    const tables = await getVisibleTables('/org/sales', ADMIN);
    expect(names(tables)).toEqual(['public.zones', 'sales.deals']);
  });

  it('root sees only root datasets — a parent NEVER sees a child\'s upload', async () => {
    const tables = await getVisibleTables('/org', ADMIN);
    expect(names(tables)).toEqual(['public.zones']);
  });

  it('siblings are invisible to each other', async () => {
    const tables = await getVisibleTables('/org/marketing', ADMIN);
    expect(names(tables)).toEqual(['marketing.ads', 'public.zones']);
    expect(names(tables)).not.toContain('sales.deals');
  });

  it('a folder-scoped NON-ADMIN resolves ancestor datasets (root data is org-wide)', async () => {
    const tables = await getVisibleTables('/org/sales', SALES_EDITOR);
    expect(names(tables)).toEqual(['public.zones', 'sales.deals']);
  });

  it('a non-admin cannot resolve ANOTHER team\'s folder by passing its path', async () => {
    // filePath is client-supplied on /api/query — folder access must be enforced
    // here, or a sales user could read marketing's tables by borrowing their path.
    const tables = await getVisibleTables('/org/marketing', SALES_EDITOR);
    expect(names(tables)).toEqual(['public.zones']); // ancestors only — never the foreign folder's own data
  });

  it('hidden tables do not resolve — hiding is real, not cosmetic', async () => {
    await getModules().db.exec('DELETE FROM files', []);
    await mkDataset('/org/data', [table('public', 'a'), table('public', 'b')], ['public.b']);
    const tables = await getVisibleTables('/org', ADMIN);
    expect(names(tables)).toEqual(['public.a']);
  });

  it('deeper nesting: /org/sales/team1 sees root + sales + its own', async () => {
    await mkDataset('/org/sales/team1/forecast', [table('team1', 'forecast')]);
    const tables = await getVisibleTables('/org/sales/team1', ADMIN);
    expect(names(tables)).toEqual(['public.zones', 'sales.deals', 'team1.forecast']);
    // …and sales itself still does NOT see team1's forecast
    expect(names(await getVisibleTables('/org/sales', ADMIN))).toEqual(['public.zones', 'sales.deals']);
  });
});

describe('global schema.table uniqueness (per mode)', () => {
  setupTestDb(TEST_DB_PATH);

  beforeEach(async () => {
    await getModules().db.exec('DELETE FROM files', []);
    await mkDataset('/org/sales/pipeline', [table('public', 'data')]);
  });

  it('a SIBLING folder cannot reuse an existing schema.table — even one it cannot see', async () => {
    await expect(
      assertTableNamesAvailable([table('public', 'data')], ADMIN),
    ).rejects.toBeInstanceOf(DatasetNameConflictError);
  });

  it('the error names the taken table but not where it lives', async () => {
    const err = await assertTableNamesAvailable([table('public', 'data')], ADMIN).catch((e) => e);
    expect(String(err.message)).toMatch(/public\.data/);
    expect(String(err.message)).not.toMatch(/sales|pipeline/);
  });

  it('same table name under a DIFFERENT schema is fine — schemas are the namespace', async () => {
    await expect(
      assertTableNamesAvailable([table('marketing', 'data')], ADMIN),
    ).resolves.toBeUndefined();
  });

  it('editing a dataset does not collide with itself (excludeFileId)', async () => {
    const files = await DocumentDB.listAll('dataset', ['/org']);
    const selfId = files[0].id;
    await expect(
      assertTableNamesAvailable([table('public', 'data')], ADMIN, { excludeFileId: selfId }),
    ).resolves.toBeUndefined();
  });

  it('duplicates WITHIN the submitted batch are rejected too', async () => {
    await expect(
      assertTableNamesAvailable([table('x', 'same'), table('x', 'same')], ADMIN),
    ).rejects.toBeInstanceOf(DatasetNameConflictError);
  });

  it('hidden tables still hold their name — hiding is exposure, not deletion', async () => {
    await getModules().db.exec('DELETE FROM files', []);
    await mkDataset('/org/d', [table('public', 'kept')], ['public.kept']);
    await expect(
      assertTableNamesAvailable([table('public', 'kept')], ADMIN),
    ).rejects.toBeInstanceOf(DatasetNameConflictError);
  });
});
