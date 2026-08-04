/**
 * The reviewed whitelist/views access matrix, as tests.
 *
 * These cases were agreed up front and then driven by hand in a browser, which
 * proved them ONCE. This file is the part that keeps proving them — the cases
 * that were browser-only, plus the two anchors they turn on:
 *
 *   · a QUESTION is governed by the nearest context to ITS OWN path, so moving
 *     a file changes what its saved SQL may read;
 *   · CHAT and MCP have no file, so they are governed by the user's home folder.
 *
 * The cases already pinned elsewhere are not repeated here — view↔table
 * dependency and escalation in `parent-child-integrity.test.ts` and
 * `integrity.test.ts`, inlining/projection in `resolve.test.ts`, the seam in
 * `lib/sql/__tests__/governed-query.test.ts`, the suggestion surfaces in
 * `lib/data/completions/__tests__/completions-whitelist.test.ts`.
 *
 * One case is deliberately absent: "does creating a file through the New menu
 * land it under the folder's context". That is a UI navigation question with no
 * server-side seam to assert on, and belongs in the QA flows.
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
import { FilesAPI } from '@/lib/data/files.server';
import { CompletionsAPI } from '@/lib/data/completions/completions.server';
import { resolveQueryForExecution, WhitelistViolationError } from '@/lib/sql/governed-query.server';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { getModules } from '@/lib/modules/registry';
import { NextRequest } from 'next/server';
import { VIEWS_SCHEMA } from '@/lib/types';
import type {
  ConnectionContent, ContextContent, ContextVersion, DatabaseSchema, ViewDef,
} from '@/lib/types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const TEST_DB_PATH = getTestDbPath('whitelist_matrix');

const admin: EffectiveUser = {
  userId: 1, name: 'Admin', email: 'a@e.com', role: 'admin', mode: 'org', home_folder: '/org',
};

const SCHEMA: DatabaseSchema = {
  updated_at: new Date().toISOString(),
  schemas: [{
    schema: 'mxfood',
    tables: [
      { table: 'orders', columns: [{ name: 'zone_id', type: 'BIGINT' }, { name: 'total', type: 'DOUBLE' }] },
      { table: 'zones', columns: [{ name: 'id', type: 'BIGINT' }, { name: 'zone_name', type: 'VARCHAR' }] },
    ],
  }],
};

const V_SQL = 'SELECT z.zone_name, o.total AS revenue FROM mxfood.orders o JOIN mxfood.zones z ON o.zone_id = z.id';

/** The curated view every case below refers to as `V`. */
const V: ViewDef = {
  name: 'zone_revenue', connection: 'warehouse', sql: V_SQL,
  columns: [{ name: 'zone_name', type: 'VARCHAR' }, { name: 'revenue', type: 'DOUBLE' }],
};

/** Whitelist offering the whole connection. */
const ALL = [{ name: 'warehouse', type: 'connection' as const }];
/** Whitelist naming the connection but offering nothing from it. */
const NOTHING = [{ name: 'warehouse', type: 'connection' as const, children: [] }];

async function mk(name: string, path: string, type: string, content: object): Promise<number> {
  const id = await DocumentDB.create(name, path, type, content, []);
  await DocumentDB.update(id, name, path, content, [], `init-${id}`);
  return id;
}

const version = (over: Partial<ContextVersion>): ContextVersion => ({
  version: 1, whitelist: ALL, docs: [], createdAt: new Date().toISOString(), createdBy: 1, ...over,
});

async function seedContext(path: string, over: Partial<ContextVersion>): Promise<number> {
  return mk('context', path, 'context',
    { versions: [version(over)], published: { all: 1 } } as ContextContent);
}

/** Run SQL through the real route as a question living at `filePath`. */
async function asQuestionAt(filePath: string, query: string, mode = 'org') {
  const req = new NextRequest(`http://localhost:3000/api/query?mode=${mode}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-id': '1' },
    body: JSON.stringify({ query, connection_name: 'warehouse', parameters: {}, filePath }),
  });
  const res = await queryPost(req);
  return { status: res.status, text: await res.text() };
}

/** Run SQL the way CHAT does — anchored on the user's home folder, no file. */
async function asAgent(query: string, user: EffectiveUser = admin) {
  return resolveQueryForExecution({
    sql: query, connectionName: 'warehouse', user, anchor: { kind: 'homeFolder' },
  });
}

describe('whitelist × views access matrix', () => {
  setupTestDb(TEST_DB_PATH);

  beforeEach(async () => {
    mockRunQuery.mockReset();
    mockRunQuery.mockResolvedValue({
      columns: ['zone_name', 'revenue'], types: ['VARCHAR', 'DOUBLE'],
      rows: [{ zone_name: 'North', revenue: 100 }], finalQuery: 'x',
    });
    mockGetSchema.mockClear();
    mockGetSchema.mockImplementation((n: string) =>
      n === 'warehouse' ? Promise.resolve(SCHEMA) : Promise.resolve({ schemas: [] }));
    await getModules().db.exec('DELETE FROM files', []);
    const conn: ConnectionContent = { type: 'duckdb', config: { file_path: '../x.duckdb' }, schema: SCHEMA };
    await mk('warehouse', '/org/database/warehouse', 'connection', conn);
  });

  // ── Case 8: a view turned OFF ──────────────────────────────────────────────
  it('8. a view turned OFF (whitelistedColumns: []) is not a table anywhere', async () => {
    const id = await seedContext('/org/context', { views: [{ ...V, whitelistedColumns: [] }] });

    // Not in the exposed schema…
    const { data } = await FilesAPI.loadFile(id, admin);
    const db = (data.content as ContextContent).fullSchema?.find((d) => d.databaseName === 'warehouse');
    expect(db?.schemas.find((s) => s.schema === VIEWS_SCHEMA)).toBeUndefined();

    // …not offered by the picker…
    const tables = await CompletionsAPI.getTableSuggestions({ databaseName: 'warehouse' }, admin);
    expect((tables.tables ?? []).map((t) => t.name)).not.toContain('zone_revenue');

    // …and not queryable: it is not in the whitelisted schema, so it is refused
    // before resolution ever renders its `WHERE 1 = 0` stub.
    expect((await asQuestionAt('/org/q1', 'SELECT * FROM _views.zone_revenue')).status).toBe(403);
  });

  // ── Case 10: mode isolation ────────────────────────────────────────────────
  it('10. a view defined in TUTORIAL is invisible and unqueryable from ORG', async () => {
    await seedContext('/tutorial/context', { views: [V] });
    // ORG gets a REAL governing context of its own — without one the query would
    // fail for the uninteresting reason that org has no context at all, and a
    // regression leaking tutorial's views into org would still pass.
    await seedContext('/org/context', { views: [] });

    const { status, text } = await asQuestionAt('/org/q1', 'SELECT * FROM _views.zone_revenue');
    expect(status).toBe(403); // not in org's whitelisted schema — it is tutorial's view
    expect(text).toMatch(/FORBIDDEN_TABLES/i);
    // …and org's own tables are fine, so this is isolation, not a broken context.
    expect((await asQuestionAt('/org/q1', 'SELECT * FROM mxfood.zones')).status).toBe(200);

    // The chat anchor is mode-scoped the same way.
    await expect(asAgent('SELECT * FROM _views.zone_revenue')).rejects.toThrow();
  });

  // ── Case 11: a view with no column snapshot ────────────────────────────────
  it('11. a NAMES-ONLY view (no column snapshot yet) is still exposed and queryable', async () => {
    const noColumns: ViewDef = { name: 'zone_revenue', connection: 'warehouse', sql: V_SQL };
    const id = await seedContext('/org/context', { views: [noColumns] });

    const { data } = await FilesAPI.loadFile(id, admin);
    const viewsSchema = (data.content as ContextContent).fullSchema
      ?.find((d) => d.databaseName === 'warehouse')?.schemas.find((s) => s.schema === VIEWS_SCHEMA);
    expect(viewsSchema?.tables.map((t) => t.table)).toEqual(['zone_revenue']);
    expect(viewsSchema?.tables[0].columns).toEqual([]); // columns come from probing, not the snapshot

    expect((await asQuestionAt('/org/q1', 'SELECT * FROM _views.zone_revenue')).status).toBe(200);
  });

  // ── Case 12: the auto-created child context inherits everything ────────────
  it('12. a DEFAULT child context (whitelist "*") lets its questions query the table AND the view', async () => {
    await seedContext('/org/context', { views: [V] });
    await seedContext('/org/team/context', { whitelist: '*' });

    expect((await asQuestionAt('/org/team/q1', 'SELECT * FROM mxfood.zones')).status).toBe(200);
    expect((await asQuestionAt('/org/team/q1', 'SELECT * FROM _views.zone_revenue')).status).toBe(200);
  });

  // ── Case 14: child keeps the view, drops the table ─────────────────────────
  it('14. a child that keeps the VIEW but drops the TABLE serves one and refuses the other', async () => {
    await seedContext('/org/context', { views: [V] });
    await seedContext('/org/team/context', { whitelist: NOTHING });

    expect((await asQuestionAt('/org/team/q1', 'SELECT * FROM _views.zone_revenue')).status).toBe(200);
    expect((await asQuestionAt('/org/team/q1', 'SELECT * FROM mxfood.zones')).status).toBe(403);
    // …while the same SQL in the parent folder is fine — location is the rule.
    expect((await asQuestionAt('/org/q1', 'SELECT * FROM mxfood.zones')).status).toBe(200);
  });

  // ── Case 15: child declines the inherited view ─────────────────────────────
  it('15. a child that DECLINES the inherited view (viewWhitelist: []) refuses it, loudly', async () => {
    await seedContext('/org/context', { views: [V] });
    await seedContext('/org/team/context', { viewWhitelist: [] });

    // 403, not 400: a declined view leaves the child's exposed schema, so table
    // validation refuses it BEFORE resolution ever looks for a view body. Pinned
    // to the exact code — "either 400 or 403" would still pass if declining
    // stopped taking effect and the query started failing somewhere else.
    const child = await asQuestionAt('/org/team/q1', 'SELECT * FROM _views.zone_revenue');
    expect(child.status).toBe(403);
    expect(child.text).toMatch(/FORBIDDEN_TABLES/i);

    // The parent's questions are unaffected — declining is local to the child.
    expect((await asQuestionAt('/org/q1', 'SELECT * FROM _views.zone_revenue')).status).toBe(200);
  });

  // ── Case 16: the same file, moved ──────────────────────────────────────────
  it('16. MOVING a question into a restricted folder makes its saved SQL fail', async () => {
    await seedContext('/org/context', { views: [V] });
    await seedContext('/org/team/context', { whitelist: NOTHING });

    const sql = 'SELECT * FROM mxfood.zones';
    const id = await mk('q1', '/org/q1', 'question',
      { query: sql, connection_name: 'warehouse' });

    expect((await asQuestionAt('/org/q1', sql)).status).toBe(200);

    await DocumentDB.update(id, 'q1', '/org/team/q1',
      { query: sql, connection_name: 'warehouse' }, [], 'moved');

    // Nothing about the question changed. Its PATH did, and the path is the rule.
    expect((await asQuestionAt('/org/team/q1', sql)).status).toBe(403);
  });

  // ── Case 18: the two anchors genuinely differ ──────────────────────────────
  it('18. CHARACTERIZATION: chat is governed by the home folder, not by the folder on screen', async () => {
    await seedContext('/org/context', { views: [V] });
    await seedContext('/org/team/context', { whitelist: NOTHING });

    // A question in /org/team may not read the table…
    expect((await asQuestionAt('/org/team/q1', 'SELECT * FROM mxfood.zones')).status).toBe(403);

    // …but chat anchors on the user's HOME folder (/org), so the same SQL runs
    // for the agent regardless of which folder the user is looking at. This is
    // not escalation — the agent runs as the user, and /org is genuinely the
    // user's own context — but it does mean the agent can test SQL that a
    // question saved in that folder cannot run. CreateFile/EditFile report that
    // failure back rather than saving a question that silently errors.
    const governed = await asAgent('SELECT * FROM mxfood.zones');
    expect(governed.executedQuery).toBe('SELECT * FROM mxfood.zones');

    // A user whose HOME is the restricted folder is refused, which is the part
    // that actually matters for a locked-down team.
    const teamUser: EffectiveUser = { ...admin, home_folder: '/org/team' };
    await expect(asAgent('SELECT * FROM mxfood.zones', teamUser))
      .rejects.toThrow(WhitelistViolationError);
  });

  // ── Mentions: the same rules, on the surface people actually click ─────────
  it('MENTIONS offer the exposed table and the curated view, and nothing withheld', async () => {
    await seedContext('/org/context', {
      whitelist: [{
        name: 'warehouse', type: 'connection',
        children: [{ name: 'mxfood', type: 'schema', children: [{ name: 'zones', type: 'table' }] }],
      }],
      views: [V],
    });

    const offered = async (prefix: string) => JSON.stringify(
      (await CompletionsAPI.getMentions({ prefix, mentionType: 'all', databaseName: 'warehouse' }, admin))
        .suggestions ?? []);

    expect(await offered('zone')).toContain('zones');          // exposed table
    expect(await offered('zone')).toContain('zone_revenue');   // curated view
    expect(await offered('order')).not.toContain('orders');    // withheld table
  });
});
