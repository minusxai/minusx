/**
 * The `/api/query` route with views — the INTEGRATION nobody else exercises.
 *
 * Every other view execution test hits `resolveViewsInSql` or `getViewsForPath`
 * directly. This one drives the REAL route handler, where four things that only
 * compose in production actually meet:
 *   1. whitelist validation ACCEPTS `_views.x` (the loader injects it into the
 *      whitelisted schema, so a curated view is authorized as itself);
 *   2. the view is RESOLVED to an inlined CTE before execution;
 *   3. a column whitelist PROJECTS the CTE (a deselected column ceases to exist);
 *   4. the cache key is computed over the RESOLVED SQL, so editing a view body
 *      busts the cache with no cache-key surgery.
 *
 * The connector is mocked (its correctness is proven against real DuckDB in
 * resolve.test.ts); what this test asserts is the SQL the route HANDS the
 * connector, and how caching behaves.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRunQuery } = vi.hoisted(() => ({ mockRunQuery: vi.fn() }));
vi.mock('@/lib/connections/run-query', async () => {
  const { queryResultToStream } = await import('@/lib/connections/base');
  return {
    runQuery: mockRunQuery,
    runQueryStream: async (...args: unknown[]) => queryResultToStream(await mockRunQuery(...args)),
  };
});

// The context loader introspects the connection to build fullSchema (into which
// views are injected as `_views` tables). Serve a fixed schema.
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

import { POST as queryPost } from '@/app/api/query/route';
import { DocumentDB } from '@/lib/database/documents-db';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { getModules } from '@/lib/modules/registry';
import { NextRequest } from 'next/server';
import type { ConnectionContent, ContextContent, ContextVersion, DatabaseSchema, ViewDef } from '@/lib/types';

const TEST_DB_PATH = getTestDbPath('query_route_views');

const SCHEMA: DatabaseSchema = {
  updated_at: new Date().toISOString(),
  schemas: [{
    schema: 'mxfood',
    tables: [
      { table: 'orders', columns: [{ name: 'zone_id', type: 'BIGINT' }, { name: 'total', type: 'DOUBLE' }, { name: 'created_at', type: 'TIMESTAMP' }] },
      { table: 'zones', columns: [{ name: 'id', type: 'BIGINT' }, { name: 'zone_name', type: 'VARCHAR' }] },
    ],
  }],
};

const ZONE_REVENUE_SQL =
  'SELECT z.zone_name, o.total AS revenue, o.created_at FROM mxfood.orders o JOIN mxfood.zones z ON o.zone_id = z.id';

async function mk(name: string, path: string, type: string, content: object): Promise<number> {
  const id = await DocumentDB.create(name, path, type, content, []);
  await DocumentDB.update(id, name, path, content, [], `init-${id}`);
  return id;
}

/** A root context (offers everything) with the given views. */
async function seedContext(views: ViewDef[]): Promise<number> {
  await getModules().db.exec("DELETE FROM files WHERE type = 'context'", []);
  const version: ContextVersion = {
    version: 1, whitelist: [{ name: 'warehouse', type: 'connection' }], docs: [], views,
    createdAt: new Date().toISOString(), createdBy: 1,
  };
  return mk('context', '/org/context', 'context', { versions: [version], published: { all: 1 } } as ContextContent);
}

/** `filePath: null` OMITS the field entirely — the ad-hoc /explore shape.
 *  (Not `undefined`: that would trigger the default and silently send '/org'.) */
async function runViaRoute(query: string, forceRefresh = false, filePath: string | null = '/org') {
  const req = new NextRequest('http://localhost:3000/api/query?mode=org', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-id': '1' },
    body: JSON.stringify({
      query, connection_name: 'warehouse', parameters: {}, forceRefresh,
      ...(filePath === null ? {} : { filePath }),
    }),
  });
  const res = await queryPost(req);
  return { status: res.status, text: await res.text() };
}

describe('/api/query with views (real route handler)', () => {
  setupTestDb(TEST_DB_PATH);

  beforeEach(async () => {
    mockRunQuery.mockReset();
    mockRunQuery.mockResolvedValue({
      columns: ['zone_name', 'revenue', 'created_at'], types: ['VARCHAR', 'DOUBLE', 'TIMESTAMP'],
      rows: [{ zone_name: 'North', revenue: 100, created_at: '2024-01-01' }], finalQuery: 'x',
    });
    mockGetSchema.mockClear();
    mockGetSchema.mockImplementation((n: string) => (n === 'warehouse' ? Promise.resolve(SCHEMA) : Promise.resolve({ schemas: [] })));
    await getModules().db.exec('DELETE FROM files', []);
    const conn: ConnectionContent = { type: 'duckdb', config: { file_path: '../x.duckdb' }, schema: SCHEMA };
    await mk('warehouse', '/org/database/warehouse', 'connection', conn);
  });

  it('a query reading _views.x is ACCEPTED by whitelist validation and RESOLVED to a CTE', async () => {
    await seedContext([{ name: 'zone_revenue', connection: 'warehouse', sql: ZONE_REVENUE_SQL }]);

    const { status } = await runViaRoute('SELECT zone_name, revenue FROM _views.zone_revenue');

    expect(status).toBe(200);                       // NOT 403 (whitelist accepted _views.zone_revenue)
    expect(mockRunQuery).toHaveBeenCalledTimes(1);
    const sqlHandedToConnector = mockRunQuery.mock.calls[0][1] as string;
    expect(sqlHandedToConnector).toMatch(/WITH\s+_views_zone_revenue AS/i);   // inlined
    expect(sqlHandedToConnector).not.toMatch(/_views\./);                     // schema fully rewritten away
  });

  it('a column whitelist PROJECTS the CTE — the connector never receives the hidden column', async () => {
    await seedContext([{
      name: 'zone_revenue', connection: 'warehouse', sql: ZONE_REVENUE_SQL,
      whitelistedColumns: ['zone_name', 'revenue'], // created_at hidden
    }]);

    await runViaRoute('SELECT * FROM _views.zone_revenue');
    const sql = mockRunQuery.mock.calls[0][1] as string;
    // The projection wraps the body and exposes only the whitelisted columns.
    expect(sql).toMatch(/"zone_name"/);
    expect(sql).toMatch(/"revenue"/);
    // created_at appears in the INNER body (it's selected there) but the outer
    // projection does not re-expose it — the CTE's output omits it.
    expect(sql).toMatch(/SELECT "zone_name", "revenue" FROM/i);
  });

  it('editing a view body BUSTS the cache (key is over the resolved SQL)', async () => {
    const id = await seedContext([{ name: 'v', connection: 'warehouse', sql: 'SELECT zone_name FROM mxfood.zones' }]);

    // First run → miss → connector runs.
    await runViaRoute('SELECT * FROM _views.v');
    expect(mockRunQuery).toHaveBeenCalledTimes(1);

    // Identical query again → cache HIT → connector NOT called again.
    await runViaRoute('SELECT * FROM _views.v');
    expect(mockRunQuery).toHaveBeenCalledTimes(1);

    // Edit the view's body → the resolved SQL changes → new cache key → re-execute.
    const ctx = (await DocumentDB.getById(id))!.content as ContextContent;
    ctx.versions![0].views![0].sql = 'SELECT zone_name, id FROM mxfood.zones';
    await DocumentDB.update(id, 'context', '/org/context', ctx, [], 'edit-view');

    await runViaRoute('SELECT * FROM _views.v');
    expect(mockRunQuery).toHaveBeenCalledTimes(2); // busted, not served stale
  });

  // The canonical curated setup: expose the clean view and NOTHING else. The
  // whitelist fold drops a connection with no whitelisted real tables, and view
  // injection could only decorate connections that survived — so the one thing
  // the context DID expose disappeared with the tables it was hiding.
  it('a VIEWS-ONLY context (no real tables exposed) can still query its view', async () => {
    await getModules().db.exec("DELETE FROM files WHERE type = 'context'", []);
    const version: ContextVersion = {
      version: 1, docs: [], createdAt: new Date().toISOString(), createdBy: 1,
      // warehouse is listed, but exposes no schema at all…
      whitelist: [{ name: 'warehouse', type: 'connection', children: [] }],
      // …while a curated view over its tables IS offered.
      views: [{ name: 'clean_kpi', connection: 'warehouse', sql: ZONE_REVENUE_SQL }],
    };
    await mk('context', '/org/context', 'context',
      { versions: [version], published: { all: 1 } } as ContextContent);

    const { status, text } = await runViaRoute('SELECT zone_name FROM _views.clean_kpi');
    expect(status).toBe(200);
    expect(text).not.toMatch(/FORBIDDEN_TABLES/);
    expect(mockRunQuery.mock.calls[0][1]).toMatch(/WITH\s+_views_clean_kpi AS/i);

    // …and the tables it hides are still hidden.
    expect((await runViaRoute('SELECT * FROM mxfood.zones')).status).toBe(403);
  });

  it('an UNKNOWN view under a real whitelist is REJECTED (403) — it is not an exposed table', async () => {
    // The whitelist only injects REAL views as `_views` tables, so a ghost view
    // is simply not in the whitelisted schema → caught by table validation.
    await seedContext([]);
    const { status, text } = await runViaRoute('SELECT * FROM _views.ghost');
    expect(status).toBe(403);
    expect(text).toMatch(/FORBIDDEN_TABLES|not.*allowed|whitelist/i);
  });

  // CHARACTERIZATION, not an endorsement: ad-hoc SQL (/explore, no filePath) is
  // NOT whitelist-checked, so a user can read a withheld table by typing it into
  // the editor while the agent running the identical SQL is refused.
  //
  // Closing it needs a PROFILING-FREE resolver. Resolving the whitelist today
  // goes through the context loader, which loads connection files and can start
  // a schema refresh — the regression `query-route-no-profiling.test.ts` guards
  // (N parallel dashboard queries → gateway timeout → "Failed to fetch"). A
  // cheap re-fold from raw context reads was attempted and reverted: the
  // loader's `fullSchema` also carries VIEWS injected as `_views` tables, so a
  // whitelist-only re-fold silently denied every view query. Doing it properly
  // means re-folding inherited views, `viewWhitelist` and disabled-view
  // detection too — its own change, with `whitelist-resolver-parity.test.ts`
  // extended to cover views.
  it('ad-hoc SQL with no filePath is currently UNGOVERNED (known gap)', async () => {
    await getModules().db.exec("DELETE FROM files WHERE type = 'context'", []);
    const version: ContextVersion = {
      version: 1, docs: [], views: [], createdAt: new Date().toISOString(), createdBy: 1,
      whitelist: [{
        name: 'warehouse', type: 'connection',
        children: [{ name: 'mxfood', type: 'schema', children: [{ name: 'orders', type: 'table' }] }],
      }],
    };
    await mk('context', '/org/context', 'context',
      { versions: [version], published: { all: 1 } } as ContextContent);

    // `zones` is withheld by that whitelist, yet runs with no filePath…
    expect((await runViaRoute('SELECT * FROM mxfood.zones', false, null)).status).toBe(200);
    // …while the SAME SQL anchored to a file is refused.
    expect((await runViaRoute('SELECT * FROM mxfood.zones')).status).toBe(403);
  });

  it('an UNKNOWN view under a WILDCARD whitelist fails loudly at resolution (400 unknown view)', async () => {
    // '*' whitelist → validateQueryTables is skipped → view resolution is the
    // thing that catches the ghost, and it does so loudly rather than silently.
    await getModules().db.exec("DELETE FROM files WHERE type = 'context'", []);
    const version: ContextVersion = {
      version: 1, whitelist: '*', docs: [], views: [],
      createdAt: new Date().toISOString(), createdBy: 1,
    };
    await mk('context', '/org/context', 'context', { versions: [version], published: { all: 1 } } as ContextContent);
    const { status, text } = await runViaRoute('SELECT * FROM _views.ghost');
    expect(status).toBe(400);
    expect(text).toMatch(/unknown view/i);
  });

  it('a non-view query is untouched (byte-identical) and still runs', async () => {
    await seedContext([]);
    await runViaRoute('SELECT zone_name FROM mxfood.zones');
    expect(mockRunQuery.mock.calls[0][1]).toBe('SELECT zone_name FROM mxfood.zones');
  });
});
