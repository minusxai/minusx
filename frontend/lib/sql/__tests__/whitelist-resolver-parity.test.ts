/**
 * `getWhitelistForPath` must agree with the CONTEXT LOADER, exactly.
 *
 * The loader (`computeSchemaFromWhitelist`) is the source of truth for what a
 * context exposes, but it is expensive: it loads connection files, so calling it
 * on the query hot path can kick off schema profiling — the regression behind
 * the dashboard "Failed to fetch" storm. The resolver therefore recomputes the
 * same fold from RAW context reads plus the connection's CACHED schema, and
 * touches no loader.
 *
 * Two implementations of one rule is exactly how a security check drifts, so
 * this test pins them together across every whitelist shape that matters:
 * wildcards, explicit lists, narrowing children, childPaths pointing at this
 * subtree and away from it, and a three-level chain.
 */
import { DocumentDB } from '@/lib/database/documents-db';
import { FilesAPI } from '@/lib/data/files.server';
import { getWhitelistForPath } from '@/lib/sql/whitelist-resolver.server';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { getModules } from '@/lib/modules/registry';
import type {
  ConnectionContent, ContextContent, ContextVersion, DatabaseSchema, Whitelist,
} from '@/lib/types';
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

const TEST_DB_PATH = getTestDbPath('whitelist_parity');

const user: EffectiveUser = {
  userId: 1, name: 'Admin', email: 'a@e.com', role: 'admin', mode: 'org', home_folder: '/org',
};

const SCHEMA: DatabaseSchema = {
  updated_at: new Date().toISOString(),
  schemas: [
    {
      schema: 'mxfood',
      tables: [
        { table: 'orders', columns: [{ name: 'id', type: 'BIGINT' }] },
        { table: 'zones', columns: [{ name: 'id', type: 'BIGINT' }] },
        { table: 'salaries', columns: [{ name: 'amt', type: 'DOUBLE' }] },
      ],
    },
    { schema: 'ops', tables: [{ table: 'runs', columns: [{ name: 'id', type: 'BIGINT' }] }] },
  ],
};

async function mk(name: string, path: string, type: string, content: object): Promise<number> {
  const id = await DocumentDB.create(name, path, type, content, []);
  await DocumentDB.update(id, name, path, content, [], `init-${id}`);
  return id;
}

const ctx = (whitelist: Whitelist): ContextContent => {
  const version: ContextVersion = {
    version: 1, whitelist, docs: [], createdAt: new Date().toISOString(), createdBy: 1,
  };
  return { versions: [version], published: { all: 1 } } as ContextContent;
};

/** What the LOADER says this context exposes for the connection — ground truth. */
async function loaderTruth(contextId: number): Promise<unknown> {
  const { data } = await FilesAPI.loadFile(contextId, user);
  const content = data.content as ContextContent;
  const db = (content.fullSchema ?? []).find((d) => d.databaseName === 'warehouse');
  return normalize(db?.schemas ?? []);
}

/** Compare only names — the loader carries columns, the resolver need not. */
function normalize(schemas: Array<{ schema: string; tables: Array<{ table: string }> }>) {
  return schemas
    .map((s) => ({ schema: s.schema, tables: s.tables.map((t) => t.table).sort() }))
    .filter((s) => s.tables.length > 0)
    .sort((a, b) => a.schema.localeCompare(b.schema));
}

const CONNECTION_ONLY: Whitelist = [{ name: 'warehouse', type: 'connection' }];
const ORDERS_ONLY: Whitelist = [{
  name: 'warehouse', type: 'connection',
  children: [{ name: 'mxfood', type: 'schema', children: [{ name: 'orders', type: 'table' }] }],
}];
const MXFOOD_ALL: Whitelist = [{
  name: 'warehouse', type: 'connection',
  children: [{ name: 'mxfood', type: 'schema' }],
}];

describe('getWhitelistForPath agrees with the context loader', () => {
  setupTestDb(TEST_DB_PATH);

  beforeEach(async () => {
    mockGetSchema.mockClear();
    mockGetSchema.mockImplementation((n: string) =>
      n === 'warehouse' ? Promise.resolve(SCHEMA) : Promise.resolve({ schemas: [] }));
    await getModules().db.exec('DELETE FROM files', []);
    const conn: ConnectionContent = { type: 'duckdb', config: { file_path: '../x.duckdb' }, schema: SCHEMA };
    await mk('warehouse', '/org/database/warehouse', 'connection', conn);
  });

  const cases: Array<[string, Whitelist]> = [
    ['wildcard', '*'],
    ['connection node, all schemas', CONNECTION_ONLY],
    ['one schema, all tables', MXFOOD_ALL],
    ['one schema, one table', ORDERS_ONLY],
    ['exposes nothing', []],
  ];

  it.each(cases)('root context: %s', async (_label, whitelist) => {
    const id = await mk('context', '/org/context', 'context', ctx(whitelist));
    const truth = await loaderTruth(id);
    const resolved = normalize((await getWhitelistForPath('/org/q', 'warehouse', user)) ?? []);
    // A `*` whitelist resolves to null (unrestricted) rather than an enumeration —
    // that is the documented contract, and the loader's fullSchema is everything.
    if (whitelist === '*') {
      expect(await getWhitelistForPath('/org/q', 'warehouse', user)).toBeNull();
    } else {
      expect(resolved).toEqual(truth);
    }
  });

  it('child NARROWS the parent: resolver matches the child\'s computed schema', async () => {
    await mk('context', '/org/context', 'context', ctx(MXFOOD_ALL));
    const childId = await mk('context', '/org/team/context', 'context', ctx(ORDERS_ONLY));

    expect(normalize((await getWhitelistForPath('/org/team/q', 'warehouse', user)) ?? []))
      .toEqual(await loaderTruth(childId));
  });

  it('child cannot WIDEN the parent (asks for everything, parent offers one schema)', async () => {
    await mk('context', '/org/context', 'context', ctx(MXFOOD_ALL));
    const childId = await mk('context', '/org/team/context', 'context', ctx('*'));

    const resolved = normalize((await getWhitelistForPath('/org/team/q', 'warehouse', user)) ?? []);
    expect(resolved).toEqual(await loaderTruth(childId));
    expect(JSON.stringify(resolved)).not.toContain('ops'); // parent never offered it
  });

  it('childPaths pointing AWAY from this subtree withholds the table', async () => {
    const parent: Whitelist = [{
      name: 'warehouse', type: 'connection',
      children: [{
        name: 'mxfood', type: 'schema',
        children: [
          { name: 'orders', type: 'table' },
          { name: 'salaries', type: 'table', childPaths: ['/org/finance'] },
        ],
      }],
    }];
    await mk('context', '/org/context', 'context', ctx(parent));
    const teamId = await mk('context', '/org/team/context', 'context', ctx('*'));
    const finId = await mk('context', '/org/finance/context', 'context', ctx('*'));

    const team = normalize((await getWhitelistForPath('/org/team/q', 'warehouse', user)) ?? []);
    expect(team).toEqual(await loaderTruth(teamId));
    expect(JSON.stringify(team)).not.toContain('salaries');

    const fin = normalize((await getWhitelistForPath('/org/finance/q', 'warehouse', user)) ?? []);
    expect(fin).toEqual(await loaderTruth(finId));
    expect(JSON.stringify(fin)).toContain('salaries');
  });

  it('a three-level chain folds the same way the loader folds it', async () => {
    await mk('context', '/org/context', 'context', ctx(CONNECTION_ONLY));
    await mk('context', '/org/a/context', 'context', ctx(MXFOOD_ALL));
    const leafId = await mk('context', '/org/a/b/context', 'context', ctx(ORDERS_ONLY));

    expect(normalize((await getWhitelistForPath('/org/a/b/q', 'warehouse', user)) ?? []))
      .toEqual(await loaderTruth(leafId));
  });
});
