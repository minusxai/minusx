/**
 * The governed query seam — one place where "may this SQL run, and what does it
 * actually execute as" is decided.
 *
 * Every surface that executes user/agent-authored SQL composes the same steps in
 * the same order (whitelist → validate → dialect → view inlining). These tests
 * drive the seam through the REAL context machinery (test DB, real loader, real
 * whitelist computation) rather than mocks, because the thing under test is
 * precisely whether the layers agree with each other.
 */
import { DocumentDB } from '@/lib/database/documents-db';
import { resolveQueryForExecution, WhitelistViolationError } from '@/lib/sql/governed-query.server';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { getModules } from '@/lib/modules/registry';
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

const TEST_DB_PATH = getTestDbPath('governed_query');

const user: EffectiveUser = {
  userId: 1, name: 'Admin', email: 'a@e.com', role: 'admin', mode: 'org', home_folder: '/org',
};

const SCHEMA: DatabaseSchema = {
  updated_at: new Date().toISOString(),
  schemas: [{
    schema: 'mxfood',
    tables: [
      { table: 'orders', columns: [{ name: 'id', type: 'BIGINT' }, { name: 'total', type: 'DOUBLE' }, { name: 'zone_id', type: 'BIGINT' }] },
      { table: 'zones', columns: [{ name: 'zone_id', type: 'BIGINT' }, { name: 'zone_name', type: 'VARCHAR' }] },
      { table: 'salaries', columns: [{ name: 'id', type: 'BIGINT' }, { name: 'amount', type: 'DOUBLE' }] },
    ],
  }],
};

const ZONE_REVENUE: ViewDef = {
  name: 'zone_revenue',
  connection: 'warehouse',
  sql: 'SELECT z.zone_name, o.total AS revenue FROM mxfood.orders o JOIN mxfood.zones z ON o.zone_id = z.zone_id',
  columns: [{ name: 'zone_name', type: 'VARCHAR' }, { name: 'revenue', type: 'DOUBLE' }],
};

/** Whitelist exposing only orders+zones — `salaries` is deliberately withheld. */
const NARROW_WHITELIST = [{
  name: 'warehouse', type: 'connection' as const,
  children: [{
    name: 'mxfood', type: 'schema' as const,
    children: [{ name: 'orders', type: 'table' as const }, { name: 'zones', type: 'table' as const }],
  }],
}];

async function mkPublished(name: string, path: string, type: string, content: object): Promise<number> {
  const id = await DocumentDB.create(name, path, type, content, []);
  await DocumentDB.update(id, name, path, content, [], `init-${id}`);
  return id;
}

const version = (over: Partial<ContextVersion> = {}): ContextVersion => ({
  version: 1,
  whitelist: NARROW_WHITELIST,
  docs: [],
  createdAt: new Date().toISOString(),
  createdBy: 1,
  ...over,
});

describe('resolveQueryForExecution', () => {
  setupTestDb(TEST_DB_PATH);

  beforeEach(async () => {
    mockGetSchema.mockClear();
    await getModules().db.exec('DELETE FROM files', []);
    mockGetSchema.mockImplementation((n: string) =>
      n === 'warehouse' ? Promise.resolve(SCHEMA) : Promise.resolve({ schemas: [] }));

    const conn: ConnectionContent = { type: 'duckdb', config: { file_path: '../data/x.duckdb' }, schema: SCHEMA };
    await mkPublished('warehouse', '/org/database/warehouse', 'connection', conn);
    await mkPublished('context', '/org/context', 'context',
      { versions: [version({ views: [ZONE_REVENUE] })], published: { all: 1 } } as ContextContent);
  });

  const call = (sql: string, anchor: Parameters<typeof resolveQueryForExecution>[0]['anchor']) =>
    resolveQueryForExecution({ sql, connectionName: 'warehouse', user, anchor });

  it('ENFORCES the table whitelist — a withheld table is rejected, not executed', async () => {
    await expect(call('SELECT * FROM mxfood.salaries', { kind: 'homeFolder' }))
      .rejects.toThrow(WhitelistViolationError);
  });

  it('allows a whitelisted table through unchanged (byte-identical, never parsed)', async () => {
    const sql = 'SELECT COUNT(*) FROM mxfood.orders -- keep\n';
    const out = await call(sql, { kind: 'homeFolder' });
    expect(out.executedQuery).toBe(sql);
  });

  it('inlines a view as a CTE and drops the virtual reference', async () => {
    const out = await call('SELECT zone_name FROM _views.zone_revenue', { kind: 'homeFolder' });
    expect(out.executedQuery).toContain('mxfood.orders');
    expect(out.executedQuery).not.toContain('_views.zone_revenue');
  });

  it('a view is authorized as ITSELF — its body may read beyond the caller\'s reach', async () => {
    // The view reads orders+zones; the caller may not query them by name here,
    // yet the view resolves — that is the curated-aggregate promise.
    const restricted = [{
      name: 'warehouse', type: 'connection' as const,
      children: [{ name: 'mxfood', type: 'schema' as const, children: [{ name: 'zones', type: 'table' as const }] }],
    }];
    await getModules().db.exec('DELETE FROM files WHERE path = $1', ['/org/context']);
    await mkPublished('context', '/org/context', 'context',
      { versions: [version({ whitelist: restricted, views: [ZONE_REVENUE] })], published: { all: 1 } } as ContextContent);

    await expect(call('SELECT * FROM mxfood.orders', { kind: 'homeFolder' }))
      .rejects.toThrow(WhitelistViolationError);
    const out = await call('SELECT zone_name FROM _views.zone_revenue', { kind: 'homeFolder' });
    expect(out.executedQuery).toContain('mxfood.orders');
  });

  it('an unknown view is refused, naming the view', async () => {
    // Views live in the whitelisted schema as ordinary tables, so an unknown one
    // is caught by whitelist validation before resolution ever runs — either way
    // the error names the reference rather than surfacing a catalog error.
    await expect(call('SELECT * FROM _views.nope', { kind: 'homeFolder' }))
      .rejects.toThrow(/_views\.nope/);
  });

  it('the ANCHOR decides which context governs: a child folder can be stricter', async () => {
    // Child takes only `zones` from the parent's offering, and declines the view.
    const childOnlyZones = [{
      name: 'warehouse', type: 'connection' as const,
      children: [{ name: 'mxfood', type: 'schema' as const, children: [{ name: 'zones', type: 'table' as const }] }],
    }];
    await mkPublished('context', '/org/locked/context', 'context', {
      versions: [version({ whitelist: childOnlyZones, viewWhitelist: [] })], published: { all: 1 },
    } as ContextContent);

    // Home folder (/org) still permits the table…
    await expect(call('SELECT * FROM mxfood.orders', { kind: 'homeFolder' })).resolves.toBeTruthy();
    // …while a file inside the locked folder does not.
    await expect(call('SELECT * FROM mxfood.orders', { kind: 'file', path: '/org/locked/q1' }))
      .rejects.toThrow(WhitelistViolationError);
    // The view the child declined is unavailable there too.
    await expect(call('SELECT * FROM _views.zone_revenue', { kind: 'file', path: '/org/locked/q1' }))
      .rejects.toThrow(/zone_revenue/);
    // …but what the child DID take still works.
    await expect(call('SELECT * FROM mxfood.zones', { kind: 'file', path: '/org/locked/q1' }))
      .resolves.toBeTruthy();
  });

  it('an unrestricted workspace (chain of `*`) is unaffected', async () => {
    await getModules().db.exec('DELETE FROM files WHERE path = $1', ['/org/context']);
    await mkPublished('context', '/org/context', 'context',
      { versions: [version({ whitelist: '*' })], published: { all: 1 } } as ContextContent);

    const out = await call('SELECT * FROM mxfood.salaries', { kind: 'homeFolder' });
    expect(out.executedQuery).toBe('SELECT * FROM mxfood.salaries');
  });
});
