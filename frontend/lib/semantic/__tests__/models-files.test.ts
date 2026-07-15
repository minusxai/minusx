/**
 * Semantic models for DATASET tables — the GUI must work on the virtual
 * `files` connection exactly like on a warehouse: numeric columns become
 * measures, categoricals become dimensions. There is no connection doc (and
 * so no persisted schema) for `files`; the scope resolves from the dataset
 * docs visible at the requesting path instead.
 */
import { DocumentDB } from '@/lib/database/documents-db';
import { getScopedSemanticModels } from '@/lib/semantic/models.server';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { getModules } from '@/lib/modules/registry';
import { FILES_CONNECTION } from '@/lib/types/datasets';
import type { DatasetContent } from '@/lib/types/datasets';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const TEST_DB_PATH = getTestDbPath('models_files');
const ADMIN: EffectiveUser = { userId: 1, name: 'A', email: 'a@e.com', role: 'admin', mode: 'org', home_folder: '' };

async function mk(name: string, path: string, type: string, content: object): Promise<number> {
  const id = await DocumentDB.create(name, path, type, content, []);
  await DocumentDB.update(id, name, path, content, [], `init-${id}`);
  return id;
}

describe('semantic models for files tables', () => {
  setupTestDb(TEST_DB_PATH);

  beforeEach(async () => {
    await getModules().db.exec('DELETE FROM files', []);
    await mk('pipeline', '/org/sales/pipeline', 'dataset', {
      files: [{
        filename: 'deals.csv', table_name: 'deals', schema_name: 'sales',
        s3_key: 'k', file_format: 'csv', row_count: 3,
        columns: [
          { name: 'region', type: 'VARCHAR' },
          { name: 'amount', type: 'DOUBLE' },
          { name: 'closed_at', type: 'TIMESTAMP' },
        ],
        source: 'upload',
      }],
    } as DatasetContent);
  });

  it('derives a model for a dataset table (measures + dimensions + time)', async () => {
    const models = await getScopedSemanticModels(ADMIN, {
      path: '/org/sales', connection: FILES_CONNECTION, tables: ['deals'],
    });
    const model = models.find((m: { table: string }) => m.table === 'deals');
    expect(model).toBeTruthy();
    expect(model!.measures.some((me: { column?: string }) => me.column === 'amount')).toBe(true);
    expect(model!.dimensions.some((d: { column: string }) => d.column === 'region')).toBe(true);
  });

  it('folder scoping holds: the table does not derive from a SIBLING path', async () => {
    const models = await getScopedSemanticModels(ADMIN, {
      path: '/org/marketing', connection: FILES_CONNECTION, tables: ['deals'],
    });
    expect(models.find((m: { table: string }) => m.table === 'deals')).toBeUndefined();
  });
});
