/**
 * Authored semantic models (server) — Semantic_Model_v2.md §2.7 M5: the
 * /api/semantic-models entry points serve models AUTHORED on context versions
 * (ContextVersion.semanticModels, inherited via fullSemanticModels), never
 * per-request derivation. Derivation (lib/semantic/derive.ts) survives only as
 * the draft-suggestion engine — these tests prove it no longer feeds live
 * querying, search, or detection.
 */
import { DocumentDB } from '@/lib/database/documents-db';
import { detectSemanticSql, getScopedSemanticModels, searchSemanticFields } from '@/lib/semantic/models.server';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { getModules } from '@/lib/modules/registry';
import { VIEWS_SCHEMA } from '@/lib/types';
import type { ConnectionContent, ContextContent, ContextVersion, DatabaseSchema, SemanticModelV2 } from '@/lib/types';
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

// The connection still exists (detection needs its dialect), and its schema
// still lists tables the authored models do NOT cover — proving nothing is
// derived from it anymore.
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

// --- authored fixtures (V2 shapes, exactly as stored on the version) --------

const ORDERS: SemanticModelV2 = {
  name: 'Orders',
  connection: 'warehouse',
  primary: { kind: 'table', schema: 'public', table: 'orders' },
  references: [{
    source: { kind: 'table', schema: 'public', table: 'users' },
    alias: 'users',
    relationship: 'many_to_one',
    joinType: 'LEFT',
    on: [{ primaryColumn: 'user_id', referencedColumn: 'id' }],
  }],
  dimensions: [
    { name: 'Created At', source: 'primary', column: 'created_at', temporal: true },
    { name: 'Status', source: 'primary', column: 'status' },
    { name: 'Country', source: 'users', column: 'country' },
  ],
  metrics: [
    { name: 'Count', type: 'aggregation', agg: 'COUNT' },
    { name: 'Total Amount', type: 'aggregation', agg: 'SUM', column: 'amount' },
    { name: 'Avg Amount', type: 'aggregation', agg: 'AVG', column: 'amount' },
    { name: 'Avg Basket', type: 'ratio', numerator: 'Total Amount', denominator: 'Count' },
    { name: 'Net Revenue', type: 'sql', sql: 'SUM(primary.amount) - SUM(primary.refund)' },
  ],
};

const USERS: SemanticModelV2 = {
  name: 'Users',
  connection: 'warehouse',
  primary: { kind: 'table', schema: 'public', table: 'users' },
  dimensions: [{ name: 'Country', source: 'primary', column: 'country' }],
  metrics: [{ name: 'User Count', type: 'aggregation', agg: 'COUNT' }],
};

// A model-primary (data model / view) — scoping matches on the VIEW name.
const REVENUE_MODEL: SemanticModelV2 = {
  name: 'Revenue Model',
  connection: 'warehouse',
  primary: { kind: 'model', view: 'revenue_model' },
  dimensions: [{ name: 'Month', source: 'primary', column: 'month', temporal: true }],
  metrics: [{ name: 'Revenue', type: 'aggregation', agg: 'SUM', column: 'revenue' }],
};

// Lives on ANOTHER connection — must never be served for `warehouse`.
const EVENTS_ELSEWHERE: SemanticModelV2 = {
  name: 'Events',
  connection: 'clickstream',
  primary: { kind: 'table', schema: 'public', table: 'events' },
  dimensions: [{ name: 'Kind', source: 'primary', column: 'kind' }],
  metrics: [{ name: 'Event Count', type: 'aggregation', agg: 'COUNT' }],
};

// Authored on the CHILD context only.
const SIGNUPS: SemanticModelV2 = {
  name: 'Signups',
  connection: 'warehouse',
  primary: { kind: 'table', schema: 'public', table: 'users' },
  dimensions: [{ name: 'Signup Country', source: 'primary', column: 'country' }],
  metrics: [{ name: 'Signup Count', type: 'aggregation', agg: 'COUNT' }],
};

const mkVersion = (semanticModels: SemanticModelV2[]): ContextVersion => ({
  version: 1,
  whitelist: [],
  docs: [],
  semanticModels,
  createdAt: new Date().toISOString(),
  createdBy: 1,
});

describe('models.server — authored semantic models', () => {
  setupTestDb(TEST_DB_PATH);

  beforeEach(async () => {
    mockGetSchema.mockClear();
    await getModules().db.exec('DELETE FROM files', []);

    const conn: ConnectionContent = { type: 'duckdb', config: { file_path: '../data/x.duckdb' }, schema: SCHEMA };
    await mkPublished('warehouse', '/org/database/warehouse', 'connection', conn);

    await mkPublished('context', '/org/context', 'context',
      { versions: [mkVersion([ORDERS, USERS, REVENUE_MODEL, EVENTS_ELSEWHERE])], published: { all: 1 } } as ContextContent);
    await mkPublished('context', '/org/team/context', 'context',
      { versions: [mkVersion([SIGNUPS])], published: { all: 1 } } as ContextContent);
  });

  it('serves the AUTHORED models scoped by primary table name — verbatim, references intact', async () => {
    const models = await getScopedSemanticModels(admin, {
      path: '/org', connection: 'warehouse', tables: ['orders'],
    });
    expect(models).toEqual([expect.objectContaining({
      name: 'Orders',
      primary: expect.objectContaining({ kind: 'table', table: 'orders' }),
      references: [expect.objectContaining({
        source: expect.objectContaining({ kind: 'table', table: 'users' }),
        alias: 'users',
        on: [{ primaryColumn: 'user_id', referencedColumn: 'id' }],
      })],
    })]);
    // authored join dims survive as-authored (nothing is re-derived), and the
    // authored temporal dimension (the time axis) is present
    expect(models[0].dimensions).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Country', source: 'users', column: 'country' }),
      expect.objectContaining({ column: 'created_at', temporal: true }),
    ]));
  });

  it('omitting `tables` returns EVERY authored model on the connection', async () => {
    const models = await getScopedSemanticModels(admin, { path: '/org', connection: 'warehouse' });
    expect(models.map((m) => m.name).sort()).toEqual(['Orders', 'Revenue Model', 'Users']);
  });

  it('an EMPTY `tables` array is no scoping either — the unscoped picker list', async () => {
    // The explorer asks for every authored model on the connection before any
    // model is picked; the API route always sends an array, so [] must mean
    // "unscoped" exactly like an omitted `tables`.
    const models = await getScopedSemanticModels(admin, { path: '/org', connection: 'warehouse', tables: [] });
    expect(models.map((m) => m.name).sort()).toEqual(['Orders', 'Revenue Model', 'Users']);
  });

  it('a model-primary is scoped by its VIEW name', async () => {
    const models = await getScopedSemanticModels(admin, {
      path: '/org', connection: 'warehouse', tables: ['revenue_model'],
    });
    expect(models.map((m) => m.name)).toEqual(['Revenue Model']);
  });

  it('a table with no authored model yields nothing — even though the schema has it', async () => {
    const models = await getScopedSemanticModels(admin, {
      path: '/org', connection: 'warehouse', tables: ['secrets'],
    });
    expect(models).toEqual([]);
  });

  it('child contexts INHERIT ancestor models (fullSemanticModels) plus their own', async () => {
    const models = await getScopedSemanticModels(admin, { path: '/org/team', connection: 'warehouse' });
    const names = models.map((m) => m.name).sort();
    expect(names).toEqual(['Orders', 'Revenue Model', 'Signups', 'Users']);
  });

  it('without any context there are NO models — derivation no longer feeds live querying', async () => {
    await getModules().db.exec("DELETE FROM files WHERE type = 'context'", []);
    const models = await getScopedSemanticModels(admin, {
      path: '/org', connection: 'warehouse', tables: ['orders', 'users'],
    });
    expect(models).toEqual([]);
  });

  it('unknown connection returns []', async () => {
    const models = await getScopedSemanticModels(admin, {
      path: '/org', connection: 'nope', tables: ['orders'],
    });
    expect(models).toEqual([]);
  });

  // --- search ----------------------------------------------------------------

  it('searchSemanticFields searches authored metrics and dimensions (SemanticFieldHit shape)', async () => {
    const hits = await searchSemanticFields(admin, { path: '/org', connection: 'warehouse', q: 'amount' });
    expect(hits).toEqual(expect.arrayContaining([
      { kind: 'metric', name: 'Total Amount', model: 'Orders', connection: 'warehouse', schema: 'public', table: 'orders' },
      expect.objectContaining({ kind: 'metric', name: 'Avg Amount', model: 'Orders' }),
    ]));

    // dimension search reaches other models too
    const dims = await searchSemanticFields(admin, { path: '/org', connection: 'warehouse', q: 'country' });
    expect(dims).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'dimension', name: 'Country', model: 'Users', table: 'users' }),
    ]));

    // nothing is derived from unmodelled schema tables
    const none = await searchSemanticFields(admin, { path: '/org', connection: 'warehouse', q: 'token' });
    expect(none).toEqual([]);
  });

  it('searchSemanticFields surfaces authored ratio and SQL metrics, not just aggregations', async () => {
    const ratio = await searchSemanticFields(admin, { path: '/org', connection: 'warehouse', q: 'basket' });
    expect(ratio).toEqual([
      { kind: 'metric', name: 'Avg Basket', model: 'Orders', connection: 'warehouse', schema: 'public', table: 'orders' },
    ]);

    const sql = await searchSemanticFields(admin, { path: '/org', connection: 'warehouse', q: 'net' });
    expect(sql).toEqual([
      { kind: 'metric', name: 'Net Revenue', model: 'Orders', connection: 'warehouse', schema: 'public', table: 'orders' },
    ]);
  });

  it('searchSemanticFields surfaces model-primary fields under the views schema', async () => {
    const hits = await searchSemanticFields(admin, { path: '/org', connection: 'warehouse', q: 'revenue' });
    expect(hits).toEqual(expect.arrayContaining([
      { kind: 'metric', name: 'Revenue', model: 'Revenue Model', connection: 'warehouse', schema: VIEWS_SCHEMA, table: 'revenue_model' },
    ]));
  });

  it('searchSemanticFields matches model names and caps results', async () => {
    const byModel = await searchSemanticFields(admin, { path: '/org', connection: 'warehouse', q: 'orders' });
    expect(byModel.length).toBeGreaterThan(0);
    expect(byModel.every((h) => h.model === 'Orders')).toBe(true);
    const all = await searchSemanticFields(admin, { path: '/org', connection: 'warehouse', q: '', limit: 3 });
    expect(all.length).toBe(3);
  });

  // --- detection --------------------------------------------------------------

  it('detectSemanticSql detects against AUTHORED models', async () => {
    const detected = await detectSemanticSql(admin, {
      path: '/org', connection: 'warehouse',
      sql: 'SELECT status, COUNT(*) FROM public.orders GROUP BY status',
    });
    expect(detected).toMatchObject({ model: 'Orders', dimensions: ['Status'], metrics: ['Count'] });

    const refused = await detectSemanticSql(admin, {
      path: '/org', connection: 'warehouse',
      sql: 'SELECT status, ROW_NUMBER() OVER (ORDER BY amount) FROM public.orders',
    });
    expect(refused).toBeNull();
  });

  it('detectSemanticSql with no authored models returns null (never falls back to derivation)', async () => {
    await getModules().db.exec("DELETE FROM files WHERE type = 'context'", []);
    const detected = await detectSemanticSql(admin, {
      path: '/org', connection: 'warehouse',
      sql: 'SELECT status, COUNT(*) FROM public.orders GROUP BY status',
    });
    expect(detected).toBeNull();
  });
});
