/**
 * Scoped semantic-model derivation (server) — models are derived per request
 * for the tables in play, NEVER stored on the context content (a large
 * workspace derives multi-MB of vocabulary; see lib/semantic/derive.ts).
 * Whitelist scoping comes from the nearest context; columns come from the
 * connection's persisted schema (always full, regardless of context bounding).
 */
import { DocumentDB } from '@/lib/database/documents-db';
import { FilesAPI } from '@/lib/data/files.server';
import { detectSemanticSql, getScopedSemanticModels, searchSemanticFields } from '@/lib/semantic/models.server';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { getModules } from '@/lib/modules/registry';
import type { ConnectionContent, ContextContent, ContextVersion, DatabaseSchema } from '@/lib/types';
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

const TEST_DB_PATH = getTestDbPath('semantic_models_server');

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
      { table: 'users', columns: [{ name: 'id', type: 'INTEGER' }, { name: 'country', type: 'VARCHAR' }] },
      { table: 'secrets', columns: [{ name: 'token', type: 'VARCHAR' }] },
    ],
  }],
};

describe('getScopedSemanticModels', () => {
  setupTestDb(TEST_DB_PATH);

  beforeEach(async () => {
    mockGetSchema.mockClear();
    await getModules().db.exec('DELETE FROM files', []);

    const conn: ConnectionContent = { type: 'duckdb', config: { file_path: '../data/x.duckdb' }, schema: SCHEMA };
    await mkPublished('warehouse', '/org/database/warehouse', 'connection', conn);

    // Context whitelists orders + users (NOT secrets), declares orders→users.
    const version: ContextVersion = {
      version: 1,
      whitelist: [{ name: 'warehouse', type: 'connection', children: [
        { name: 'public', type: 'schema', children: [
          { name: 'orders', type: 'table' },
          { name: 'users', type: 'table' },
        ]},
      ]}],
      docs: [],
      relationships: [{
        connection: 'warehouse', schema: 'public', table: 'orders',
        column: 'user_id', targetSchema: 'public', targetTable: 'users', targetColumn: 'id',
        relationship: 'many_to_one',
      }],
      createdAt: new Date().toISOString(),
      createdBy: 1,
    };
    await mkPublished('context', '/org/context', 'context',
      { versions: [version], published: { all: 1 } } as ContextContent);
  });

  it('derives full models only for the requested tables, join dims included', async () => {
    const models = await getScopedSemanticModels(admin, {
      path: '/org', connection: 'warehouse', tables: ['orders'],
    });
    expect(models.map((m) => m.table)).toEqual(['orders']);
    const orders = models[0];
    expect(orders.name).toBe('Orders');
    expect(orders.timeDimension?.column).toBe('created_at');
    expect(orders.joins).toEqual([expect.objectContaining({ table: 'users', leftColumn: 'user_id', rightColumn: 'id' })]);
    // join dims come from the target table even though it wasn't requested
    expect(orders.dimensions).toEqual(expect.arrayContaining([
      expect.objectContaining({ column: 'country', join: 'users' }),
    ]));
  });

  it('refuses tables outside the context whitelist', async () => {
    const models = await getScopedSemanticModels(admin, {
      path: '/org', connection: 'warehouse', tables: ['secrets'],
    });
    expect(models).toEqual([]);
  });

  it('without a context, scopes to the connection schema directly', async () => {
    await getModules().db.exec("DELETE FROM files WHERE type = 'context'", []);
    const models = await getScopedSemanticModels(admin, {
      path: '/org', connection: 'warehouse', tables: ['secrets', 'users'],
    });
    expect(models.map((m) => m.table).sort()).toEqual(['secrets', 'users']);
  });

  it('searchSemanticFields finds measures and dimensions across every whitelisted table', async () => {
    const hits = await searchSemanticFields(admin, { path: '/org', connection: 'warehouse', q: 'amount' });
    expect(hits).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'measure', name: 'Total Amount', model: 'Orders', table: 'orders' }),
      expect.objectContaining({ kind: 'measure', name: 'Avg Amount', model: 'Orders' }),
    ]));
    // dimension search reaches other tables too
    const dims = await searchSemanticFields(admin, { path: '/org', connection: 'warehouse', q: 'country' });
    expect(dims).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'dimension', name: 'Country', model: 'Users', table: 'users' }),
    ]));
    // whitelist still applies — nothing from `secrets`
    const none = await searchSemanticFields(admin, { path: '/org', connection: 'warehouse', q: 'token' });
    expect(none).toEqual([]);
  });

  it('searchSemanticFields matches model names and caps results', async () => {
    const byModel = await searchSemanticFields(admin, { path: '/org', connection: 'warehouse', q: 'orders' });
    expect(byModel.length).toBeGreaterThan(0);
    expect(byModel.every((h) => h.model === 'Orders')).toBe(true);
    const all = await searchSemanticFields(admin, { path: '/org', connection: 'warehouse', q: '', limit: 3 });
    expect(all.length).toBe(3);
  });

  it('fullRelationships is INHERITED-ONLY — own relationships never echo as "inherited"', async () => {
    // The whitelist editor shows content.relationships (own) plus
    // content.fullRelationships tagged "inherited"; if the loader folded the
    // version's own relationships into fullRelationships, every relationship
    // would render twice (the prod duplicate). Root context → nothing inherited.
    const { data: files } = await FilesAPI.getFiles({ paths: ['/org'], type: 'context', depth: -1 }, admin);
    const { data } = await FilesAPI.loadFile(files[0].id, admin);
    const content = data.content as ContextContent;
    expect(content.fullRelationships).toEqual([]);
    expect(content.versions?.[0].relationships?.length).toBe(1); // own stays on the version
  });

  it('detectSemanticSql: full server-side detection (parse → scope → detect)', async () => {
    const detected = await detectSemanticSql(admin, {
      path: '/org', connection: 'warehouse',
      sql: 'SELECT status, COUNT(*) FROM public.orders GROUP BY status',
    });
    expect(detected).toMatchObject({ model: 'Orders', dimensions: ['Status'], measures: ['Count'] });

    const refused = await detectSemanticSql(admin, {
      path: '/org', connection: 'warehouse',
      sql: 'SELECT status, ROW_NUMBER() OVER (ORDER BY amount) FROM public.orders',
    });
    expect(refused).toBeNull();
  });

  it('unknown connection returns []', async () => {
    const models = await getScopedSemanticModels(admin, {
      path: '/org', connection: 'nope', tables: ['orders'],
    });
    expect(models).toEqual([]);
  });
});
