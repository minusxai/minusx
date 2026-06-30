/**
 * Production OOM fix: the context loader must BOUND the columnar schema it computes (a 1963-table
 * connection is ~4 MB/field) before it's stored/serialized/shipped, and must DEDUPE concurrent loads
 * of the same context (each previously allocated the multi-MB schema independently). This guards both.
 */
import { DocumentDB } from '@/lib/database/documents-db';
import { FilesAPI } from '@/lib/data/files.server';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { getModules } from '@/lib/modules/registry';
import type { ConnectionContent, ContextContent, DatabaseSchema } from '@/lib/types';
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
vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined, DB_PATH: undefined, DB_DIR: undefined, getDbType: () => 'pglite' as const,
}));

const TEST_DB_PATH = getTestDbPath('context_loader_bounding');
const user: EffectiveUser = { userId: 1, name: 'A', email: 'a@x.com', role: 'admin', mode: 'org', home_folder: '' };

// A "1963-table"-class connection: thousands of tables, each with columns → multi-MB raw schema.
const HUGE_SCHEMA: DatabaseSchema = {
  updated_at: '2026-01-01T00:00:00.000Z',
  schemas: [{
    schema: 'warehouse',
    tables: Array.from({ length: 3000 }, (_, i) => ({
      table: `events_2025_${i}`,
      columns: Array.from({ length: 20 }, (_, c) => ({ name: `column_number_${c}`, type: 'STRING' })),
    })),
  }],
};

describe('contextLoader — bounds huge schemas + dedupes concurrent loads', () => {
  setupTestDb(TEST_DB_PATH);

  beforeEach(async () => {
    mockGetSchema.mockClear();
    await getModules().db.exec('DELETE FROM files', []);
    mockGetSchema.mockImplementation((name: string) =>
      Promise.resolve(name === 'big_conn' ? HUGE_SCHEMA : ({ schemas: [], updated_at: new Date().toISOString() } as DatabaseSchema)));

    const connContent: ConnectionContent = { type: 'duckdb', config: { file_path: '../data/x.duckdb' } };
    const connId = await DocumentDB.create('big_conn', '/org/database/big_conn', 'connection', connContent, []);
    await DocumentDB.update(connId, 'big_conn', '/org/database/big_conn', connContent, [], 'init-conn');

    const ctx: ContextContent = {
      versions: [{ version: 1, whitelist: '*', docs: [], createdAt: new Date().toISOString(), createdBy: 1 }],
      published: { all: 1 },
      fullSchema: [], fullDocs: [], fullSkills: [],
    };
    const id = await DocumentDB.create('context', '/org/context', 'context', ctx, []);
    await DocumentDB.update(id, 'context', '/org/context', ctx, [], 'init');
    (globalThis as any).__ctxId = id;
  });

  it('bounds fullSchema and parentSchema (names-only, no columns) for a huge connection', async () => {
    const { data } = await FilesAPI.loadFiles([(globalThis as any).__ctxId], user);
    const content = data[0].content as ContextContent;

    // parentSchema (the editor MENU) is table-capped to the budget — safe, it's not an inheritance source.
    expect(JSON.stringify(content.parentSchema).length).toBeLessThan(60_000);
    // fullSchema (the CHILD-inheritance source) keeps EVERY table name (never capped), but drops the
    // columnar bulk — so it's far below the raw multi-MB schema yet still lists all 3000 tables.
    expect(JSON.stringify(content.fullSchema).length).toBeLessThan(400_000);

    // Columns are stripped for the huge schema (the memory bulk) on BOTH fields.
    for (const field of [content.parentSchema, content.fullSchema]) {
      const firstTable = (field as any)?.[0]?.schemas?.[0]?.tables?.[0];
      expect(firstTable?.table).toBeTruthy();          // table NAMES kept (for whitelisting / inheritance)
      expect('columns' in (firstTable ?? {})).toBe(false); // but columns dropped
    }
  });

  it('a CHILD context can still inherit any parent table — fullSchema is never table-capped', async () => {
    // The parent (/org/context) whitelists '*' over the 3000-table connection. A child that whitelists
    // a SPECIFIC table near the END (well past any cap budget) must still resolve it: the child inherits
    // from the parent's fullSchema, so capping the parent's table list would silently hide tables.
    const childCtx: ContextContent = {
      versions: [{
        version: 1,
        whitelist: [{ name: 'big_conn', type: 'connection', children: [
          { name: 'warehouse', type: 'schema', children: [{ name: 'events_2025_2999', type: 'table' }] },
        ] }],
        docs: [], createdAt: new Date().toISOString(), createdBy: 1,
      }],
      published: { all: 1 },
      fullSchema: [], fullDocs: [], fullSkills: [],
    } as unknown as ContextContent;
    const childId = await DocumentDB.create('context', '/org/sub/context', 'context', childCtx, []);
    await DocumentDB.update(childId, 'context', '/org/sub/context', childCtx, [], 'init-child');

    const { data } = await FilesAPI.loadFiles([childId], user);
    const content = data[0].content as ContextContent;
    const tables = (content.fullSchema as any)?.flatMap((db: any) => (db.schemas || []).flatMap((s: any) => (s.tables || []).map((t: any) => t.table))) ?? [];
    expect(tables).toContain('events_2025_2999'); // inherited despite being far past any cap budget
  });

  it('dedupes concurrent loads — the connection schema is fetched once, not per-load', async () => {
    const id = (globalThis as any).__ctxId as number;
    await Promise.all([
      FilesAPI.loadFiles([id], user),
      FilesAPI.loadFiles([id], user),
      FilesAPI.loadFiles([id], user),
    ]);
    // With context-load coalescing, three concurrent loads share ONE schema computation, so the
    // big connection's getSchema runs far fewer times than 3× (ideally once).
    const bigCalls = mockGetSchema.mock.calls.filter(([n]) => n === 'big_conn').length;
    expect(bigCalls).toBeLessThan(3);
  });
});
