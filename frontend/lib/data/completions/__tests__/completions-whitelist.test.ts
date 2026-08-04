/**
 * Autocomplete/suggestion surfaces must obey the SAME whitelist as query
 * execution.
 *
 * These endpoints hand back schema metadata — table names, column names — and
 * every one of them used to answer from the connection's FULL introspected
 * schema. `getMentions` took its `whitelistedSchemas` from the REQUEST BODY, so
 * a caller that simply omitted the field got everything; `getTableSuggestions`
 * and `getColumnSuggestions` never filtered at all. A whitelist that hides a
 * table from the picker but names it to anyone who asks the endpoint directly
 * is not a whitelist.
 *
 * Metadata, not rows — a caller who learns a hidden table's name still cannot
 * query it (see governed-query.test.ts) — but the curated set is the promise,
 * and it has to hold on every read of it.
 */
import { DocumentDB } from '@/lib/database/documents-db';
import { CompletionsAPI } from '@/lib/data/completions/completions.server';
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

const TEST_DB_PATH = getTestDbPath('completions_whitelist');

const user: EffectiveUser = {
  userId: 1, name: 'Admin', email: 'a@e.com', role: 'admin', mode: 'org', home_folder: '/org',
};

const SCHEMA: DatabaseSchema = {
  updated_at: new Date().toISOString(),
  schemas: [{
    schema: 'mxfood',
    tables: [
      { table: 'zones', columns: [{ name: 'zone_id', type: 'BIGINT' }, { name: 'zone_name', type: 'VARCHAR' }] },
      { table: 'salaries', columns: [{ name: 'employee', type: 'VARCHAR' }, { name: 'amount', type: 'DOUBLE' }] },
    ],
  }],
};

/** Exposes `zones` only — `salaries` is withheld. */
const ZONES_ONLY = [{
  name: 'warehouse', type: 'connection' as const,
  children: [{
    name: 'mxfood', type: 'schema' as const,
    children: [{ name: 'zones', type: 'table' as const }],
  }],
}];

async function mkPublished(name: string, path: string, type: string, content: object): Promise<number> {
  const id = await DocumentDB.create(name, path, type, content, []);
  await DocumentDB.update(id, name, path, content, [], `init-${id}`);
  return id;
}

const version = (whitelist: ContextVersion['whitelist']): ContextVersion => ({
  version: 1, whitelist, docs: [], createdAt: new Date().toISOString(), createdBy: 1,
});

async function seed(whitelist: ContextVersion['whitelist']) {
  await getModules().db.exec('DELETE FROM files', []);
  const conn: ConnectionContent = { type: 'duckdb', config: { file_path: '../data/x.duckdb' }, schema: SCHEMA };
  await mkPublished('warehouse', '/org/database/warehouse', 'connection', conn);
  await mkPublished('context', '/org/context', 'context',
    { versions: [version(whitelist)], published: { all: 1 } } as ContextContent);
}

describe('completions respect the context whitelist', () => {
  setupTestDb(TEST_DB_PATH);

  beforeEach(() => {
    mockGetSchema.mockClear();
    mockGetSchema.mockImplementation((n: string) =>
      n === 'warehouse' ? Promise.resolve(SCHEMA) : Promise.resolve({ schemas: [] }));
  });

  it('table suggestions omit a withheld table', async () => {
    await seed(ZONES_ONLY);
    const res = await CompletionsAPI.getTableSuggestions({ databaseName: 'warehouse' }, user);
    const names = (res.tables ?? []).map((t) => t.name);
    expect(names).toContain('zones');
    expect(names).not.toContain('salaries');
  });

  it('column suggestions refuse a withheld table', async () => {
    await seed(ZONES_ONLY);
    const allowed = await CompletionsAPI.getColumnSuggestions(
      { databaseName: 'warehouse', table: 'zones', schema: 'mxfood' }, user);
    expect((allowed.columns ?? []).length).toBeGreaterThan(0);

    const withheld = await CompletionsAPI.getColumnSuggestions(
      { databaseName: 'warehouse', table: 'salaries', schema: 'mxfood' }, user);
    expect((withheld.columns ?? []).map((c) => c.name)).not.toContain('amount');
  });

  it('mentions ignore a client-supplied whitelist and resolve it server-side', async () => {
    await seed(ZONES_ONLY);
    // The caller both omits the whitelist AND tries to widen it by asserting one
    // of its own. Neither may reveal the withheld table.
    const omitted = await CompletionsAPI.getMentions(
      { prefix: 'sal', mentionType: 'all', databaseName: 'warehouse' }, user);
    expect(JSON.stringify(omitted.suggestions ?? [])).not.toContain('salaries');

    const forged = await CompletionsAPI.getMentions({
      prefix: 'sal', mentionType: 'all', databaseName: 'warehouse',
      whitelistedSchemas: [{ databaseName: 'warehouse', schemas: SCHEMA.schemas }],
    }, user);
    expect(JSON.stringify(forged.suggestions ?? [])).not.toContain('salaries');
  });

  it('an unrestricted workspace still sees everything', async () => {
    await seed('*');
    const res = await CompletionsAPI.getTableSuggestions({ databaseName: 'warehouse' }, user);
    const names = (res.tables ?? []).map((t) => t.name);
    expect(names).toContain('zones');
    expect(names).toContain('salaries');
  });
});
