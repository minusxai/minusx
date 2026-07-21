/**
 * Views surface as ORDINARY TABLES under the `_views` schema.
 *
 * One injection point (the context loader) buys four things at once: the
 * whitelist validator accepts `_views.x`, the agent sees it in its schema, the
 * GUI table picker lists it, and the semantic layer derives a model from its
 * columns — a view with a date + numeric column gets Count/Total/Avg and a time
 * axis with zero extra configuration.
 */
import { DocumentDB } from '@/lib/database/documents-db';
import { FilesAPI } from '@/lib/data/files.server';
import { getScopedSemanticModels } from '@/lib/semantic/models.server';
import { getViewsForPath } from '@/lib/views/views.server';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { getModules } from '@/lib/modules/registry';
import { VIEWS_SCHEMA } from '@/lib/types';
import type { ConnectionContent, ContextContent, ContextVersion, DatabaseSchema, ViewDef } from '@/lib/types';
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

const TEST_DB_PATH = getTestDbPath('views_schema');

const admin: EffectiveUser = {
  userId: 1, name: 'Admin', email: 'a@e.com', role: 'admin', mode: 'org', home_folder: '',
};

const SCHEMA: DatabaseSchema = {
  updated_at: new Date().toISOString(),
  schemas: [{
    schema: 'mxfood',
    tables: [
      { table: 'orders', columns: [{ name: 'id', type: 'BIGINT' }, { name: 'total', type: 'DOUBLE' }] },
      { table: 'zones', columns: [{ name: 'id', type: 'BIGINT' }, { name: 'zone_name', type: 'VARCHAR' }] },
    ],
  }],
};

/** The multi-table join the semantic layer can't express — exactly what views are for. */
const ZONE_REVENUE: ViewDef = {
  name: 'zone_revenue',
  connection: 'warehouse',
  sql: 'SELECT z.zone_name, o.total AS revenue, o.created_at FROM mxfood.orders o JOIN mxfood.zones z ON o.zone_id = z.id',
  columns: [
    { name: 'zone_name', type: 'VARCHAR' },
    { name: 'revenue', type: 'DOUBLE' },
    { name: 'created_at', type: 'TIMESTAMP' },
  ],
  description: 'Revenue per zone',
};

async function mkPublished(name: string, path: string, type: string, content: object): Promise<number> {
  const id = await DocumentDB.create(name, path, type, content, []);
  await DocumentDB.update(id, name, path, content, [], `init-${id}`);
  return id;
}

describe('views as tables', () => {
  setupTestDb(TEST_DB_PATH);
  let orgContextId: number;

  beforeEach(async () => {
    mockGetSchema.mockClear();
    await getModules().db.exec('DELETE FROM files', []);
    mockGetSchema.mockImplementation((n: string) =>
      n === 'warehouse' ? Promise.resolve(SCHEMA) : Promise.resolve({ schemas: [] }));

    const conn: ConnectionContent = { type: 'duckdb', config: { file_path: '../data/x.duckdb' }, schema: SCHEMA };
    await mkPublished('warehouse', '/org/database/warehouse', 'connection', conn);

    const version: ContextVersion = {
      version: 1,
      whitelist: [{ name: 'warehouse', type: 'connection' }],
      docs: [],
      views: [ZONE_REVENUE],
      createdAt: new Date().toISOString(),
      createdBy: 1,
    };
    orgContextId = await mkPublished('context', '/org/context', 'context',
      { versions: [version], published: { all: 1 } } as ContextContent);

    // A child context inherits the parent's views.
    await mkPublished('context', '/org/sales/context', 'context', {
      versions: [{ version: 1, whitelist: [{ name: 'warehouse', type: 'connection' }], docs: [], createdAt: '', createdBy: 1 }],
      published: { all: 1 },
    } as ContextContent);
  });

  it('the loader injects a _views schema with the view as a table + columns', async () => {
    const { data } = await FilesAPI.loadFile(orgContextId, admin);
    const content = data.content as ContextContent;
    const db = content.fullSchema?.find((d) => d.databaseName === 'warehouse');
    const viewsSchema = db?.schemas.find((s) => s.schema === VIEWS_SCHEMA);
    expect(viewsSchema).toBeTruthy();
    const table = viewsSchema!.tables.find((t) => t.table === 'zone_revenue');
    expect(table).toBeTruthy();
    expect(table!.columns.map((c) => c.name)).toEqual(['zone_name', 'revenue', 'created_at']);
    // real tables still there
    expect(db!.schemas.some((s) => s.schema === 'mxfood')).toBe(true);
  });

  it('SECURITY: a column whitelist hides the column from the SEMANTIC model too, not just queries', async () => {
    // Deselect `revenue` on the view — it must not surface as a measure in the GUI.
    const restricted = { ...ZONE_REVENUE, whitelistedColumns: ['zone_name', 'created_at'] };
    const version: ContextVersion = {
      version: 1, whitelist: [{ name: 'warehouse', type: 'connection' }], docs: [],
      views: [restricted], createdAt: new Date().toISOString(), createdBy: 1,
    };
    await getModules().db.exec("DELETE FROM files WHERE type = 'context'", []);
    await mkPublished('context', '/org/context', 'context',
      { versions: [version], published: { all: 1 } } as ContextContent);

    const models = await getScopedSemanticModels(admin, {
      path: '/org', connection: 'warehouse', tables: ['zone_revenue'],
    });
    const m = models[0];
    // revenue is gone → no "Total Revenue" measure, no revenue dimension.
    expect(m.measures.map((x) => x.name)).not.toContain('Total Revenue');
    expect(m.dimensions.map((d) => d.column)).not.toContain('revenue');
    // the exposed ones remain
    expect(m.dimensions.map((d) => d.column)).toContain('zone_name');
    expect(m.timeDimension?.column).toBe('created_at');
  });

  it('a view derives a full semantic model from its columns (no config)', async () => {
    const models = await getScopedSemanticModels(admin, {
      path: '/org', connection: 'warehouse', tables: ['zone_revenue'],
    });
    expect(models).toHaveLength(1);
    const m = models[0];
    expect(m).toMatchObject({ primary: { kind: 'table', table: 'zone_revenue', schema: VIEWS_SCHEMA } });
    expect(m.measures.map((x) => x.name)).toEqual(expect.arrayContaining(['Count', 'Total Revenue', 'Avg Revenue']));
    expect(m.dimensions.map((d) => d.column)).toContain('zone_name');
    expect(m.timeDimension?.column).toBe('created_at'); // time axis, for free
  });

  it('views inherit: a child context sees the parent\'s views', async () => {
    const views = await getViewsForPath('/org/sales/some-question', 'warehouse', admin);
    expect(views.map((v) => v.name)).toEqual(['zone_revenue']);
  });

  it('REGRESSION: resolves for a file path in the mode ROOT (filePath = "/org")', async () => {
    // The query route passes the question's filePath; for a file sitting directly
    // in the mode root the "directory" IS the root, which must still find the
    // context at /org/context.
    const views = await getViewsForPath('/org', 'warehouse', admin);
    expect(views.map((v) => v.name)).toEqual(['zone_revenue']);
  });

  it('REGRESSION: resolves for a question sitting next to the context', async () => {
    const views = await getViewsForPath('/org/some-question', 'warehouse', admin);
    expect(views.map((v) => v.name)).toEqual(['zone_revenue']);
  });

  it('views are scoped to their connection', async () => {
    expect(await getViewsForPath('/org/x', 'other-db', admin)).toEqual([]);
  });
});
