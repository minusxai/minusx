/**
 * SECURITY: public-share GUESTS and views.
 *
 * A guest is a folder-scoped viewer pinned to the shared page's OWN containing
 * folder (storyHomeFolder: '/org/demos/acme/story' → home 'demos/acme'). Views
 * are authored in a context and inlined at query time by getViewsForPath, which
 * resolves the nearest context AT OR ABOVE the page's folder. Because the guest's
 * pin equals the page's folder, that nearest context is always an ancestor of the
 * guest's home — readable via `isAncestorContext` (the same mechanism that already
 * lets a guest's whitelist/schema resolve). So a shared page that reads `_views.x`
 * works for guests; there is no "guest cannot resolve its own page's view" gap.
 *
 * But that access is not unconditional: a folder-scoped viewer must NOT pull a
 * view out of a context that sits in a SIBLING subtree (not an ancestor of their
 * home) — getViewsForPath is gated by real file access, so views don't leak
 * across the tree. Both directions are proven here, against the layout the share
 * derivation actually produces (context strictly above the guest, never wedged
 * below it).
 */
import { DocumentDB } from '@/lib/database/documents-db';
import { getViewsForPath } from '@/lib/views/views.server';
import { assertGuestQueryAllowed, GuestQueryDeniedError } from '@/lib/query-cache/guest-query.server';
import { inlineQuestionToPlaceholder } from '@/lib/data/story/story-question';
import { storyHomeFolder } from '@/lib/auth/guest-session';
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
  profileDatabase: vi.fn(async (_t: string, s: unknown) => ({ schema: s, queryCount: 0 })),
}));

const TEST_DB_PATH = getTestDbPath('views_guest');
const ADMIN: EffectiveUser = { userId: 1, name: 'A', email: 'a@e.com', role: 'admin', mode: 'org', home_folder: '' };

/** A guest pinned to `home` (the share's own folder), exactly as guestToEffectiveUser builds it. */
const guest = (home: string): EffectiveUser => ({
  userId: -1001, email: 'g@anon.share', name: 'Guest', role: 'viewer', home_folder: home, mode: 'org',
  guest: { canChat: false, shareFileId: 0, nonce: 'n' },
});

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

const ZONE_REVENUE_SQL =
  'SELECT z.zone_name, o.total FROM mxfood.orders o JOIN mxfood.zones z ON o.zone_id = z.id';
const VIEW_QUERY = 'SELECT zone_name, total FROM _views.zone_revenue';

const version = (views: ViewDef[]): ContextVersion => ({
  version: 1, whitelist: '*', docs: [], views,
  createdAt: new Date().toISOString(), createdBy: 1,
});

async function mk(name: string, path: string, type: string, content: object): Promise<number> {
  const id = await DocumentDB.create(name, path, type, content, []);
  await DocumentDB.update(id, name, path, content, [], `init-${id}`);
  return id;
}

describe('guests + views (public share resolution)', () => {
  setupTestDb(TEST_DB_PATH);

  beforeEach(async () => {
    mockGetSchema.mockClear();
    mockGetSchema.mockImplementation((n: string) =>
      n === 'warehouse' ? Promise.resolve(SCHEMA) : Promise.resolve({ schemas: [] }));
    await getModules().db.exec('DELETE FROM files', []);
    const conn: ConnectionContent = { type: 'duckdb', config: { file_path: '../x.duckdb' }, schema: SCHEMA };
    await mk('warehouse', '/org/database/warehouse', 'connection', conn);
  });

  it('a guest RESOLVES a view defined in an ancestor context (context strictly ABOVE its home)', async () => {
    // Org-wide context at /org (serves every folder beneath it) owns the view.
    await mk('context', '/org/context', 'context', {
      versions: [version([{ name: 'zone_revenue', connection: 'warehouse', sql: ZONE_REVENUE_SQL }])],
      published: { all: 1 },
    } as ContextContent);

    // The share lives deeper, at /org/reports/story → guest is pinned to 'reports'.
    const home = storyHomeFolder('/org/reports/story', 'org');
    expect(home).toBe('reports'); // the pin equals the page's own folder, not broader

    const views = await getViewsForPath('/org/reports/story', 'warehouse', guest(home));
    // The context /org is a STRICT ancestor of home /org/reports — resolvable only
    // via isAncestorContext, not plain home access. This is the linchpin.
    expect(views.map((v) => v.name)).toEqual(['zone_revenue']);
    expect(views[0].sql).toBe(ZONE_REVENUE_SQL);
  });

  it('a folder-scoped viewer does NOT pull a view from a SIBLING subtree\'s context', async () => {
    // The ONLY context lives under team-a; its view must not leak to a team-b guest.
    await mk('context', '/org/team-a/context', 'context', {
      versions: [version([{ name: 'ta_secret', connection: 'warehouse', sql: ZONE_REVENUE_SQL }])],
      published: { all: 1 },
    } as ContextContent);

    // team-b guest: /org/team-a is NOT an ancestor of home /org/team-b → denied.
    const views = await getViewsForPath('/org/team-b/story', 'warehouse', guest('team-b'));
    expect(views).toEqual([]); // real access control, not topology luck

    // Sanity: a team-a guest, for whom that context IS an ancestor, does resolve it.
    const own = await getViewsForPath('/org/team-a/reports/story', 'warehouse', guest('team-a/reports'));
    expect(own.map((v) => v.name)).toEqual(['ta_secret']);
  });

  it('a guest may run a `_views.x` query only if it is embedded in their page (membership freeze)', async () => {
    await mk('context', '/org/context', 'context', {
      versions: [version([{ name: 'zone_revenue', connection: 'warehouse', sql: ZONE_REVENUE_SQL }])],
      published: { all: 1 },
    } as ContextContent);
    // A story that embeds exactly the view query, nothing else.
    await mk('story', '/org/reports/story', 'story', {
      description: 'x',
      story: `<div class="story">${inlineQuestionToPlaceholder({ query: VIEW_QUERY, connection: 'warehouse', vizSettings: { type: 'table', yCols: [] } })}</div>`,
      parameterValues: {},
    });

    const g = guest(storyHomeFolder('/org/reports/story', 'org'));
    // The embedded view query is allowed; a DIFFERENT _views read the page never
    // showed is denied — a guest cannot fabricate access to another view.
    await expect(
      assertGuestQueryAllowed('/org/reports/story', VIEW_QUERY, 'warehouse', g),
    ).resolves.toBeUndefined();
    await expect(
      assertGuestQueryAllowed('/org/reports/story', 'SELECT * FROM _views.payroll', 'warehouse', g),
    ).rejects.toBeInstanceOf(GuestQueryDeniedError);
  });
});
