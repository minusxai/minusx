/**
 * prepareView — the save-time gate for a view.
 *
 * Runs the view's SQL with a zero-row bound to snapshot its output columns AND
 * TYPES (types are what let the semantic layer classify measures/dimensions/time
 * with no config), and enforces the naming rules that keep `_views.<name>` an
 * unambiguous identifier across the whole context tree.
 */
import { DocumentDB } from '@/lib/database/documents-db';
import { prepareView, promoteQuestionToView } from '@/lib/views/prepare.server';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { getModules } from '@/lib/modules/registry';
import { FilesAPI } from '@/lib/data/files.server';
import type { ConnectionContent, ContextContent, ContextVersion, QuestionContent, ViewDef } from '@/lib/types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
const SCHEMA = {
  updated_at: new Date().toISOString(),
  schemas: [{ schema: 'mxfood', tables: [
    { table: 'orders', columns: [{ name: 'zone_name', type: 'VARCHAR' }, { name: 'total', type: 'DOUBLE' }] },
  ]}],
};
vi.mock('@/lib/connections', () => ({
  getNodeConnector: () => ({ query: mockQuery, getSchema: async () => SCHEMA.schemas }),
}));
vi.mock('@/lib/connections/statistics-engine', () => ({
  profileDatabase: vi.fn(async (_t: string, s: unknown) => ({ schema: s, queryCount: 0 })),
}));

const TEST_DB_PATH = getTestDbPath('views_prepare');
const admin: EffectiveUser = { userId: 1, name: 'A', email: 'a@e.com', role: 'admin', mode: 'org', home_folder: '' };

const ZONE_REVENUE: ViewDef = {
  name: 'zone_revenue', connection: 'warehouse',
  sql: 'SELECT zone_name, SUM(total) AS revenue FROM mxfood.orders GROUP BY zone_name',
};

async function mkPublished(name: string, path: string, type: string, content: object): Promise<number> {
  const id = await DocumentDB.create(name, path, type, content, []);
  await DocumentDB.update(id, name, path, content, [], `init-${id}`);
  return id;
}

const version = (views: ViewDef[]): ContextVersion => ({
  version: 1, whitelist: [{ name: 'warehouse', type: 'connection' }], docs: [], views,
  createdAt: new Date().toISOString(), createdBy: 1,
});

describe('prepareView', () => {
  setupTestDb(TEST_DB_PATH);

  beforeEach(async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({
      columns: ['zone_name', 'revenue'],
      types: ['VARCHAR', 'DOUBLE'],
      rows: [],
    });
    await getModules().db.exec('DELETE FROM files', []);
    const conn: ConnectionContent = { type: 'duckdb', config: { file_path: '../x.duckdb' }, schema: SCHEMA };
    await mkPublished('warehouse', '/org/database/warehouse', 'connection', conn);
    // Root context owns zone_revenue; a child context exists too.
    await mkPublished('context', '/org/context', 'context',
      { versions: [version([ZONE_REVENUE])], published: { all: 1 } } as ContextContent);
    await mkPublished('context', '/org/sales/context', 'context',
      { versions: [version([{ name: 'sales_only', connection: 'warehouse', sql: 'SELECT 1 AS x' }])], published: { all: 1 } } as ContextContent);
  });

  it('snapshots output columns AND types with a zero-row query (never a full scan)', async () => {
    const result = await prepareView(admin, {
      path: '/org/context', connection: 'warehouse', name: 'new_view',
      sql: 'SELECT zone_name, SUM(total) AS revenue FROM mxfood.orders GROUP BY zone_name',
    });
    expect(result.columns).toEqual([
      { name: 'zone_name', type: 'VARCHAR' },
      { name: 'revenue', type: 'DOUBLE' },
    ]);
    // the probe must be bounded — a view over a billion rows can't scan on save
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toMatch(/LIMIT 0/i);
  });

  it('a view may read another view (resolved before probing)', async () => {
    await prepareView(admin, {
      path: '/org/context', connection: 'warehouse', name: 'top_zones',
      sql: 'SELECT zone_name FROM _views.zone_revenue WHERE revenue > 100',
    });
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toMatch(/WITH _views_zone_revenue AS/i);
    expect(sql).not.toMatch(/_views\./); // fully inlined — the engine never sees the schema
  });

  it('rejects a name already used ANYWHERE in the tree — including a DESCENDANT', async () => {
    // The retroactive-collision case: an ancestor adding a name a child already uses.
    await expect(prepareView(admin, {
      path: '/org/context', connection: 'warehouse', name: 'sales_only', sql: 'SELECT 1 AS x',
    })).rejects.toThrow(/already used|unique/i);
  });

  it('rejects shadowing an inherited view from a child context', async () => {
    await expect(prepareView(admin, {
      path: '/org/sales/context', connection: 'warehouse', name: 'zone_revenue', sql: 'SELECT 1 AS x',
    })).rejects.toThrow(/already used|unique/i);
  });

  it('editing a view in place keeps its own name (does not collide with itself)', async () => {
    const result = await prepareView(admin, {
      path: '/org/context', connection: 'warehouse', name: 'zone_revenue',
      sql: 'SELECT zone_name, SUM(total) AS revenue FROM mxfood.orders GROUP BY zone_name',
      editing: 'zone_revenue',
    });
    expect(result.columns.length).toBe(2);
  });

  it('rejects an invalid identifier and empty SQL', async () => {
    await expect(prepareView(admin, { path: '/org/context', connection: 'warehouse', name: 'bad name', sql: 'SELECT 1' }))
      .rejects.toThrow(/name/i);
    await expect(prepareView(admin, { path: '/org/context', connection: 'warehouse', name: 'ok', sql: '  ' }))
      .rejects.toThrow(/empty/i);
  });

  it('surfaces a broken query as a clear error (the engine\'s own message)', async () => {
    mockQuery.mockRejectedValueOnce(new Error('Binder Error: column "nope" does not exist'));
    await expect(prepareView(admin, {
      path: '/org/context', connection: 'warehouse', name: 'broken', sql: 'SELECT nope FROM mxfood.orders',
    })).rejects.toThrow(/Binder Error/);
  });
});

describe('promoteQuestionToView', () => {
  setupTestDb(getTestDbPath('views_promote'));

  beforeEach(async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ columns: ['zone_name', 'revenue'], types: ['VARCHAR', 'DOUBLE'], rows: [] });
    await getModules().db.exec('DELETE FROM files', []);
    const conn: ConnectionContent = { type: 'duckdb', config: { file_path: '../x.duckdb' }, schema: SCHEMA };
    await mkPublished('warehouse', '/org/database/warehouse', 'connection', conn);
    await mkPublished('context', '/org/context', 'context',
      { versions: [version([])], published: { all: 1 } } as ContextContent);
  });

  it('promotes a question\'s SQL onto its nearest context, with columns snapshotted', async () => {
    const q: QuestionContent = {
      query: 'SELECT zone_name, SUM(total) AS revenue FROM mxfood.orders GROUP BY 1',
      connection_name: 'warehouse',
      vizSettings: { type: 'table' },
    } as QuestionContent;
    const qid = await mkPublished('Zone Revenue', '/org/zone-revenue', 'question', q);

    const view = await promoteQuestionToView(admin, { questionId: qid, name: 'zone_revenue', description: 'from question' });
    expect(view).toMatchObject({
      name: 'zone_revenue',
      connection: 'warehouse',
      sql: q.query,
      description: 'from question',
      columns: [{ name: 'zone_name', type: 'VARCHAR' }, { name: 'revenue', type: 'DOUBLE' }],
    });

    // it actually landed on the context's live version
    const { data } = await FilesAPI.loadFileByPath('/org/context', admin);
    const ctx = data.content as ContextContent;
    expect(ctx.versions?.[0].views?.map((v) => v.name)).toEqual(['zone_revenue']);
  });

  it('a question with no SQL cannot be promoted', async () => {
    const qid = await mkPublished('Empty', '/org/empty', 'question',
      { query: '', connection_name: 'warehouse', vizSettings: { type: 'table' } } as QuestionContent);
    await expect(promoteQuestionToView(admin, { questionId: qid, name: 'nope' })).rejects.toThrow(/no SQL/i);
  });
});
