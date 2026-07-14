/**
 * The parent → child flow, end to end, through the REAL save and load paths
 * (FilesAPI.saveFile → the view gate; FilesAPI.loadFile → the context loader).
 * Nothing here calls the view helpers directly: this is the behaviour a user or
 * the agent actually gets.
 *
 * The contract under test:
 *
 *  1. A child's view MAY read a table the parent OFFERS but the child did not
 *     whitelist — that is curation (aggregate a table users can't query).
 *  2. A child's view MAY NOT read a table the parent does not offer at all —
 *     the whitelist chain is a real boundary, not a suggestion.
 *  3. The gate is on the SAVE path, so the raw JSON editor and the agent's
 *     EditFile are bound by it too, not just the view dialog.
 *  4. `reads` is recomputed server-side and never trusted from the client — a
 *     forged `reads` cannot smuggle a table past the boundary.
 *  5. When a parent LATER narrows its whitelist, the child's view is DISABLED
 *     (with a reason, and removed from the exposed schema) rather than silently
 *     continuing to read a table the org just pulled.
 *  6. Deleting a view that another view still reads fails the save, naming the
 *     dependent — breakage is prevented, not discovered later by a failed query.
 */
import { DocumentDB } from '@/lib/database/documents-db';
import { FilesAPI } from '@/lib/data/files.server';
import { getViewsForPath } from '@/lib/views/views.server';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { getModules } from '@/lib/modules/registry';
import { VIEWS_SCHEMA } from '@/lib/types';
import type { ConnectionContent, ContextContent, ContextVersion, DatabaseSchema, ViewDef, Whitelist } from '@/lib/types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const { mockGetSchema } = vi.hoisted(() => ({ mockGetSchema: vi.fn() }));
vi.mock('@/lib/connections', () => ({
  getNodeConnector: (name: string) => ({
    getSchema: async () => (await mockGetSchema(name))?.schemas ?? [],
    query: vi.fn().mockResolvedValue({ columns: [], types: [], rows: [] }),
  }),
}));
vi.mock('@/lib/connections/statistics-engine', () => ({
  profileDatabase: vi.fn(async (_t: string, s: unknown) => ({ schema: s, queryCount: 0 })),
}));

const TEST_DB_PATH = getTestDbPath('views_parent_child');
const admin: EffectiveUser = { userId: 1, name: 'A', email: 'a@e.com', role: 'admin', mode: 'org', home_folder: '' };

/** The warehouse has three tables. Payroll is the one nobody should reach. */
const SCHEMA: DatabaseSchema = {
  updated_at: new Date().toISOString(),
  schemas: [{
    schema: 'mxfood',
    tables: [
      { table: 'orders', columns: [{ name: 'id', type: 'BIGINT' }, { name: 'zone_id', type: 'BIGINT' }, { name: 'total', type: 'DOUBLE' }] },
      { table: 'zones', columns: [{ name: 'id', type: 'BIGINT' }, { name: 'zone_name', type: 'VARCHAR' }] },
      { table: 'payroll', columns: [{ name: 'id', type: 'BIGINT' }, { name: 'salary', type: 'DOUBLE' }] },
    ],
  }],
};

const ZONE_REVENUE_SQL =
  'SELECT z.zone_name, o.total FROM mxfood.orders o JOIN mxfood.zones z ON o.zone_id = z.id';

let orgId: number;
let salesId: number;

/** The parent exposes these tables to children. */
const parentWhitelist = (tables: string[]): Whitelist => ([{
  name: 'warehouse', type: 'connection', children: [
    { name: 'mxfood', type: 'schema', children: tables.map((t) => ({ name: t, type: 'table' as const })) },
  ],
}]);

const version = (whitelist: Whitelist, views: ViewDef[] = []): ContextVersion => ({
  version: 1, whitelist, docs: [], views,
  createdAt: new Date().toISOString(), createdBy: 1,
});

async function mk(name: string, path: string, type: string, content: object): Promise<number> {
  const id = await DocumentDB.create(name, path, type, content, []);
  await DocumentDB.update(id, name, path, content, [], `init-${id}`);
  return id;
}

/** Save a context through the REAL write path (the gate the agent/JSON editor hit). */
async function saveContext(id: number, path: string, content: ContextContent): Promise<void> {
  await FilesAPI.saveFile(id, 'context', path, content, [], admin);
}

async function loadContext(id: number): Promise<ContextContent> {
  const { data } = await FilesAPI.loadFile(id, admin);
  return data.content as ContextContent;
}

const viewsSchemaOf = (content: ContextContent) =>
  content.fullSchema
    ?.find((d) => d.databaseName === 'warehouse')
    ?.schemas.find((s) => s.schema === VIEWS_SCHEMA)
    ?.tables.map((t) => t.table) ?? [];

describe('parent → child view integrity (real save/load path)', () => {
  setupTestDb(TEST_DB_PATH);

  beforeEach(async () => {
    mockGetSchema.mockClear();
    await getModules().db.exec('DELETE FROM files', []);
    mockGetSchema.mockImplementation((n: string) =>
      n === 'warehouse' ? Promise.resolve(SCHEMA) : Promise.resolve({ schemas: [] }));

    const conn: ConnectionContent = { type: 'duckdb', config: { file_path: '../x.duckdb' }, schema: SCHEMA };
    await mk('warehouse', '/org/database/warehouse', 'connection', conn);

    // Parent /org offers orders + zones (NOT payroll).
    orgId = await mk('context', '/org/context', 'context', {
      versions: [version(parentWhitelist(['orders', 'zones']))],
      published: { all: 1 },
    } as ContextContent);

    // Child /org/sales whitelists ONLY zones — orders stays hidden from its users.
    salesId = await mk('context', '/org/sales/context', 'context', {
      versions: [version(parentWhitelist(['zones']))],
      published: { all: 1 },
    } as ContextContent);
  });

  it('1. a child view MAY read a table the parent offers but the child hid from users', async () => {
    const sales = await loadContext(salesId);
    await saveContext(salesId, '/org/sales/context', {
      ...sales,
      versions: [{ ...sales.versions![0], views: [{ name: 'zone_revenue', connection: 'warehouse', sql: ZONE_REVENUE_SQL }] }],
    });

    const saved = await loadContext(salesId);
    expect(viewsSchemaOf(saved)).toEqual(['zone_revenue']);
    // and the server computed what it reads — not the client
    const stored = saved.versions![0].views![0];
    expect(stored.reads?.tables).toEqual(expect.arrayContaining([
      { schema: 'mxfood', table: 'orders' },
      { schema: 'mxfood', table: 'zones' },
    ]));
  });

  it('2. a child view MAY NOT read a table the parent does not offer (no escalation)', async () => {
    const sales = await loadContext(salesId);
    await expect(saveContext(salesId, '/org/sales/context', {
      ...sales,
      versions: [{
        ...sales.versions![0],
        views: [{ name: 'salaries', connection: 'warehouse', sql: 'SELECT salary FROM mxfood.payroll' }],
      }],
    })).rejects.toThrow(/payroll/);
  });

  it('3. the boundary holds for the AGENT / raw JSON editor too (same save path)', async () => {
    // Exactly what an agent EditFile would write: content straight onto the file.
    const sales = await loadContext(salesId);
    await expect(saveContext(salesId, '/org/sales/context', {
      ...sales,
      versions: [{
        ...sales.versions![0],
        views: [{ name: 'sneaky', connection: 'warehouse', sql: 'WITH x AS (SELECT * FROM mxfood.payroll) SELECT * FROM x' }],
      }],
    })).rejects.toThrow(/payroll/);
  });

  it('4. a FORGED `reads` cannot smuggle a table past the boundary', async () => {
    const sales = await loadContext(salesId);
    await expect(saveContext(salesId, '/org/sales/context', {
      ...sales,
      versions: [{
        ...sales.versions![0],
        views: [{
          name: 'forged',
          connection: 'warehouse',
          sql: 'SELECT salary FROM mxfood.payroll',
          reads: { tables: [{ schema: 'mxfood', table: 'zones' }], views: [] }, // a lie
        }],
      }],
    })).rejects.toThrow(/payroll/);
  });

  it('5. when the parent LATER narrows its whitelist, the child view is DISABLED, not silently kept', async () => {
    // Child builds a view over orders (allowed today).
    const sales = await loadContext(salesId);
    await saveContext(salesId, '/org/sales/context', {
      ...sales,
      versions: [{ ...sales.versions![0], views: [{ name: 'zone_revenue', connection: 'warehouse', sql: ZONE_REVENUE_SQL }] }],
    });
    expect(viewsSchemaOf(await loadContext(salesId))).toEqual(['zone_revenue']);

    // The org pulls `orders` (say it turned out to contain PII).
    const org = await loadContext(orgId);
    await saveContext(orgId, '/org/context', {
      ...org,
      versions: [{ ...org.versions![0], whitelist: parentWhitelist(['zones']) }],
    });

    // The child's view is now disabled: gone from the exposed schema, with a reason,
    // and no longer resolvable by a query.
    const after = await loadContext(salesId);
    expect(viewsSchemaOf(after)).toEqual([]);
    expect(after.viewProblems?.[0]).toMatchObject({ view: 'zone_revenue' });
    expect(after.viewProblems?.[0].reason).toMatch(/orders/);
    expect(await getViewsForPath('/org/sales/q', 'warehouse', admin)).toEqual([]);
  });

  it('6. deleting a view that another view still reads FAILS the save, naming the dependent', async () => {
    const sales = await loadContext(salesId);
    await saveContext(salesId, '/org/sales/context', {
      ...sales,
      versions: [{
        ...sales.versions![0],
        views: [
          { name: 'zone_revenue', connection: 'warehouse', sql: ZONE_REVENUE_SQL },
          { name: 'top_zones', connection: 'warehouse', sql: 'SELECT zone_name FROM _views.zone_revenue' },
        ],
      }],
    });

    // Now try to remove the base view, leaving its dependent behind.
    const withViews = await loadContext(salesId);
    await expect(saveContext(salesId, '/org/sales/context', {
      ...withViews,
      versions: [{
        ...withViews.versions![0],
        views: [{ name: 'top_zones', connection: 'warehouse', sql: 'SELECT zone_name FROM _views.zone_revenue' }],
      }],
    })).rejects.toThrow(/zone_revenue/);
  });

  it('7. a child INHERITS the parent\'s views, and may build on them', async () => {
    // Parent publishes a view over orders (which it offers).
    const org = await loadContext(orgId);
    await saveContext(orgId, '/org/context', {
      ...org,
      versions: [{ ...org.versions![0], views: [{ name: 'zone_revenue', connection: 'warehouse', sql: ZONE_REVENUE_SQL }] }],
    });

    // The child sees it...
    const sales = await loadContext(salesId);
    expect(sales.fullViews?.map((v) => v.name)).toEqual(['zone_revenue']);
    expect(viewsSchemaOf(sales)).toEqual(['zone_revenue']);

    // ...and can build a view on top of it, even though it never whitelisted `orders`.
    await saveContext(salesId, '/org/sales/context', {
      ...sales,
      versions: [{
        ...sales.versions![0],
        views: [{ name: 'top_zones', connection: 'warehouse', sql: 'SELECT zone_name FROM _views.zone_revenue' }],
      }],
    });
    const after = await loadContext(salesId);
    expect(viewsSchemaOf(after).sort()).toEqual(['top_zones', 'zone_revenue']);
  });

  it('8. the ROOT context may read anything — it has full authority', async () => {
    const org = await loadContext(orgId);
    await saveContext(orgId, '/org/context', {
      ...org,
      versions: [{
        ...org.versions![0],
        views: [{ name: 'salaries', connection: 'warehouse', sql: 'SELECT salary FROM mxfood.payroll' }],
      }],
    });
    expect(viewsSchemaOf(await loadContext(orgId))).toEqual(['salaries']);
  });
});
