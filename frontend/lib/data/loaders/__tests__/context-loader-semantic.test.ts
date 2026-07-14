/**
 * Context loader — DERIVED semantic models. The loader derives one model per
 * whitelisted table (from schema columns + the version's declared
 * relationships) into `fullSemanticModels`; child contexts inherit the
 * parent's derived models scoped to their own whitelist.
 */
import { DocumentDB } from '@/lib/database/documents-db';
import { FilesAPI } from '@/lib/data/files.server';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { getModules } from '@/lib/modules/registry';
import type { ConnectionContent, ContextContent, ContextVersion, DatabaseSchema, SemanticModel } from '@/lib/types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const { mockGetSchema } = vi.hoisted(() => ({ mockGetSchema: vi.fn() }));

vi.mock('@/lib/connections', () => ({
  getNodeConnector: (name: string) => ({
    getSchema: async () => (await mockGetSchema(name))?.schemas ?? [],
    query: vi.fn().mockResolvedValue({ columns: [], types: [], rows: [] }),
  }),
}));

vi.mock('@/lib/connections/statistics-engine', () => ({
  profileDatabase: vi.fn(async (_t: string, schemas: unknown) => ({ schema: schemas, queryCount: 0 })),
}));

const TEST_DB_PATH = getTestDbPath('context_loader_semantic');

const admin: EffectiveUser = {
  userId: 1, name: 'Admin', email: 'admin@example.com', role: 'admin', mode: 'org', home_folder: '',
};

async function mkPublished(name: string, path: string, type: string, content: object): Promise<number> {
  const id = await DocumentDB.create(name, path, type, content, []);
  await DocumentDB.update(id, name, path, content, [], `init-${id}`);
  return id;
}

const SCHEMA: DatabaseSchema = {
  updated_at: new Date().toISOString(),
  schemas: [{
    schema: 'public',
    tables: [
      {
        table: 'orders',
        columns: [
          { name: 'id', type: 'INTEGER' },
          { name: 'user_id', type: 'INTEGER' },
          { name: 'status', type: 'VARCHAR' },
          { name: 'amount', type: 'DECIMAL' },
          { name: 'created_at', type: 'TIMESTAMP' },
        ],
      },
      {
        table: 'users',
        columns: [
          { name: 'id', type: 'INTEGER' },
          { name: 'country', type: 'VARCHAR' },
        ],
      },
    ],
  }],
};

describe('context loader derives semantic models', () => {
  setupTestDb(TEST_DB_PATH);
  let orgContextId: number;
  let salesContextId: number;

  beforeEach(async () => {
    mockGetSchema.mockClear();
    await getModules().db.exec('DELETE FROM files', []);
    mockGetSchema.mockImplementation((name: string) =>
      name === 'warehouse' ? Promise.resolve(SCHEMA) : Promise.resolve({ schemas: [] }),
    );

    const conn: ConnectionContent = { type: 'duckdb', config: { file_path: '../data/x.duckdb' } };
    await mkPublished('warehouse', '/org/database/warehouse', 'connection', conn);

    const orgVersion: ContextVersion = {
      version: 1,
      whitelist: [{ name: 'warehouse', type: 'connection' }], // whole connection
      docs: [],
      relationships: [{
        connection: 'warehouse', schema: 'public', table: 'orders',
        column: 'user_id', targetSchema: 'public', targetTable: 'users', targetColumn: 'id',
        relationship: 'many_to_one',
      }],
      createdAt: new Date().toISOString(),
      createdBy: 1,
    };
    const orgContent: ContextContent = { versions: [orgVersion], published: { all: 1 } } as ContextContent;
    orgContextId = await mkPublished('context', '/org/context', 'context', orgContent);

    const salesVersion: ContextVersion = {
      version: 1,
      whitelist: [{ name: 'warehouse', type: 'connection', children: [
        { name: 'public', type: 'schema', children: [{ name: 'users', type: 'table' }] },
      ]}],
      docs: [],
      createdAt: new Date().toISOString(),
      createdBy: 1,
    };
    salesContextId = await mkPublished(
      'context', '/org/sales/context', 'context',
      { versions: [salesVersion], published: { all: 1 } } as ContextContent,
    );
  });

  it('root: derives one model per whitelisted table, with the declared join', async () => {
    const { data } = await FilesAPI.loadFile(orgContextId, admin);
    const models = (data.content as ContextContent).fullSemanticModels as SemanticModel[];
    expect(models.map((m) => m.table).sort()).toEqual(['orders', 'users']);

    const orders = models.find((m) => m.table === 'orders')!;
    expect(orders.name).toBe('Orders');
    expect(orders.timeDimension?.column).toBe('created_at');
    expect(orders.measures).toEqual(expect.arrayContaining([
      expect.objectContaining({ agg: 'SUM', column: 'amount' }),
      expect.objectContaining({ agg: 'COUNT' }),
    ]));
    expect(orders.joins).toEqual([expect.objectContaining({
      table: 'users', alias: 'users', leftColumn: 'user_id', rightColumn: 'id', relationship: 'many_to_one',
    })]);
    // join exposes the lookup's dimensions
    expect(orders.dimensions).toEqual(expect.arrayContaining([
      expect.objectContaining({ column: 'country', join: 'users' }),
    ]));
  });

  it('child: inherits parent-derived models scoped to its own whitelist', async () => {
    const { data } = await FilesAPI.loadFile(salesContextId, admin);
    const models = (data.content as ContextContent).fullSemanticModels as SemanticModel[];
    expect(models.map((m) => m.table)).toEqual(['users']); // orders not whitelisted here
    expect(models[0].dimensions).toEqual(expect.arrayContaining([
      expect.objectContaining({ column: 'country' }),
    ]));
  });

  it('legacy authored semanticModels on a version are ignored without breaking the load', async () => {
    const legacyVersion = {
      version: 1,
      whitelist: [{ name: 'warehouse', type: 'connection' }],
      docs: [],
      semanticModels: [{ name: 'Legacy', connection: 'warehouse', table: 'orders', dimensions: [], measures: [] }],
      createdAt: new Date().toISOString(),
      createdBy: 1,
    };
    const id = await mkPublished('context', '/org/legacy/context', 'context', {
      versions: [legacyVersion], published: { all: 1 },
    });
    const { data } = await FilesAPI.loadFile(id, admin);
    const models = (data.content as ContextContent).fullSemanticModels as SemanticModel[];
    expect(models.map((m) => m.name)).not.toContain('Legacy');
    expect(models.map((m) => m.table).sort()).toEqual(['orders', 'users']);
  });
});
