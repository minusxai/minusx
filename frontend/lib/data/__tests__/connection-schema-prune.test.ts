/**
 * Deleting a table from a STATIC connection must immediately drop it from the cached content.schema
 * (the Table View / agent schema source) on save — not leave it lingering until the slow background
 * re-introspection lands. Verifies the server save path prunes the kept schema to config.files.
 */
import { FilesAPI } from '@/lib/data/files.server';
import { DocumentDB } from '@/lib/database/documents-db';
import { initTestDatabase, cleanupTestDatabase, getTestDbPath } from '@/store/__tests__/test-utils';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { ConnectionContent, CsvFileInfo, DatabaseSchema } from '@/lib/types';

// The connection save returns a fire-and-forget background refresh; stub the connector so it never
// touches real S3/DuckDB.
vi.mock('@/lib/connections', () => ({
  getNodeConnector: () => ({ getSchema: async () => [], query: vi.fn().mockResolvedValue({ columns: [], types: [], rows: [] }), testConnection: async () => ({ success: true }) }),
}));
vi.mock('@/lib/connections/statistics-engine', () => ({
  profileDatabase: vi.fn(async (_t: string, schemas: unknown) => ({ schema: schemas, queryCount: 0 })),
}));
vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined, DB_PATH: undefined, DB_DIR: undefined, getDbType: () => 'pglite' as const,
}));

const TEST_DB_PATH = getTestDbPath('connection_schema_prune');
const user: EffectiveUser = { userId: 1, name: 'A', email: 'a@x.com', role: 'admin', mode: 'org', home_folder: '' };

function file(table_name: string): CsvFileInfo {
  return { filename: `${table_name}.csv`, table_name, schema_name: 'ds', s3_key: `s3-${table_name}`, file_format: 'csv', row_count: 0, columns: [], source_type: 'csv' };
}
const cachedSchema: DatabaseSchema = {
  updated_at: '2026-01-01T00:00:00.000Z',
  schemas: [{ schema: 'ds', tables: [
    { table: 'kept_table', columns: [{ name: 'id', type: 'INT' }] },
    { table: 'deleted_table', columns: [{ name: 'id', type: 'INT' }] },
  ] }],
};

describe('saveFile — static connection prunes cached schema to config.files on delete', () => {
  beforeAll(async () => { await initTestDatabase(TEST_DB_PATH); });
  afterAll(async () => { await cleanupTestDatabase(TEST_DB_PATH); });

  it('drops the deleted table from content.schema immediately on save', async () => {
    // Connection starts with two tables, both in config.files and the cached schema.
    const initial: ConnectionContent = {
      type: 'csv',
      config: { files: [file('kept_table'), file('deleted_table')] },
      schema: cachedSchema,
    } as unknown as ConnectionContent;
    const id = await DocumentDB.create('prune_test_conn', '/org/database/prune_test_conn', 'connection', initial, []);

    // User deletes 'deleted_table' → save with config.files now missing it (client schema is ignored).
    const afterDelete: ConnectionContent = {
      type: 'csv',
      config: { files: [file('kept_table')] },
      schema: cachedSchema, // stale client copy — server must ignore + reconcile
    } as unknown as ConnectionContent;
    await FilesAPI.saveFile(id, 'prune_test_conn', '/org/database/prune_test_conn', afterDelete as unknown as Record<string, unknown>, [], user);

    const persisted = await DocumentDB.getById(id);
    const schema = (persisted!.content as ConnectionContent).schema!;
    const tables = schema.schemas.flatMap((s) => s.tables.map((t) => t.table));
    expect(tables).toContain('kept_table');
    expect(tables).not.toContain('deleted_table'); // no longer lingering in the cache
    expect(schema.schemas[0].tables.find((t) => t.table === 'kept_table')!.columns).toHaveLength(1); // columns preserved
  });
});
