/**
 * Datasets in the CONTEXT — through the REAL load path (FilesAPI.loadFile →
 * context loader), plus whitelist narrowing through the REAL query-time
 * resolver. What this locks:
 *
 *  1. A context's fullSchema contains a `files` database entry with the
 *     dataset tables visible AT ITS FOLDER (own + ancestors') — so the agent,
 *     the KB UI and the semantic layer all see them like ordinary tables.
 *  2. Folder scoping holds inside contexts: the root context never lists a
 *     child folder's dataset; a child context lists root + its own.
 *  3. Hidden tables are absent (exposure, not concealment).
 *  4. AUTO-EXPOSE: with no `files` whitelist entries, queries pass (null =
 *     unrestricted); when a context explicitly whitelists `files` tables, the
 *     resolver narrows to exactly those.
 */
import { DocumentDB } from '@/lib/database/documents-db';
import { FilesAPI } from '@/lib/data/files.server';
import { getWhitelistForPath } from '@/lib/sql/whitelist-resolver.server';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { getModules } from '@/lib/modules/registry';
import { FILES_CONNECTION } from '@/lib/types/datasets';
import type { DatasetContent, DatasetTable } from '@/lib/types/datasets';
import type { ContextContent, ContextVersion, DatabaseWithSchema } from '@/lib/types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const { mockGetSchema } = vi.hoisted(() => ({ mockGetSchema: vi.fn() }));
vi.mock('@/lib/connections', () => ({
  getNodeConnector: () => ({
    getSchema: async () => (await mockGetSchema())?.schemas ?? [],
    query: vi.fn().mockResolvedValue({ columns: [], types: [], rows: [] }),
  }),
}));
vi.mock('@/lib/connections/statistics-engine', () => ({
  profileDatabase: vi.fn(async (_t: string, s: unknown) => ({ schema: s, queryCount: 0 })),
}));

const TEST_DB_PATH = getTestDbPath('datasets_context');
const ADMIN: EffectiveUser = { userId: 1, name: 'A', email: 'a@e.com', role: 'admin', mode: 'org', home_folder: '' };

const table = (schema: string, name: string): DatasetTable => ({
  filename: `${name}.csv`, table_name: name, schema_name: schema,
  s3_key: `org1/${schema}/${name}.csv`, file_format: 'csv', row_count: 1,
  columns: [{ name: 'id', type: 'BIGINT' }], source: 'upload',
});

async function mk(name: string, path: string, type: string, content: object): Promise<number> {
  const id = await DocumentDB.create(name, path, type, content, []);
  await DocumentDB.update(id, name, path, content, [], `init-${id}`);
  return id;
}

const version = (whitelist: ContextVersion['whitelist']): ContextVersion => ({
  version: 1, whitelist, docs: [],
  createdAt: new Date().toISOString(), createdBy: 1,
});

const filesEntry = (content: ContextContent): DatabaseWithSchema | undefined =>
  content.fullSchema?.find((d) => d.databaseName === FILES_CONNECTION);

const tableNames = (entry: DatabaseWithSchema | undefined): string[] =>
  (entry?.schemas ?? []).flatMap((s) => s.tables.map((t) => `${s.schema}.${t.table}`)).sort();

describe('datasets surface in context fullSchema (real load path)', () => {
  setupTestDb(TEST_DB_PATH);

  let orgCtx: number;
  let salesCtx: number;

  beforeEach(async () => {
    mockGetSchema.mockResolvedValue({ schemas: [] });
    await getModules().db.exec('DELETE FROM files', []);
    orgCtx = await mk('context', '/org/context', 'context', {
      versions: [version('*')], published: { all: 1 },
    } as ContextContent);
    salesCtx = await mk('context', '/org/sales/context', 'context', {
      versions: [version('*')], published: { all: 1 },
    } as ContextContent);
    await mk('reference', '/org/reference', 'dataset', {
      files: [table('public', 'zones')],
    } as DatasetContent);
    await mk('pipeline', '/org/sales/pipeline', 'dataset', {
      files: [table('sales', 'deals'), table('sales', 'secret')],
      hiddenTables: ['sales.secret'],
    } as DatasetContent);
  });

  it('root context lists ONLY root datasets — never a child folder\'s', async () => {
    const { data } = await FilesAPI.loadFile(orgCtx, ADMIN);
    const entry = filesEntry(data.content as ContextContent);
    expect(tableNames(entry)).toEqual(['public.zones']);
  });

  it('child context lists ancestors\' + its own datasets, hidden tables absent', async () => {
    const { data } = await FilesAPI.loadFile(salesCtx, ADMIN);
    const entry = filesEntry(data.content as ContextContent);
    expect(tableNames(entry)).toEqual(['public.zones', 'sales.deals']);
  });

  it('no datasets → no files entry (nothing phantom in the KB)', async () => {
    await getModules().db.exec("DELETE FROM files WHERE type = 'dataset'", []);
    const { data } = await FilesAPI.loadFile(orgCtx, ADMIN);
    expect(filesEntry(data.content as ContextContent)).toBeUndefined();
  });
});

describe('files whitelist narrowing (query-time resolver)', () => {
  setupTestDb(TEST_DB_PATH);

  beforeEach(async () => {
    mockGetSchema.mockResolvedValue({ schemas: [] });
    await getModules().db.exec('DELETE FROM files', []);
  });

  it('AUTO-EXPOSE: a context with no files whitelist entry does not restrict files queries', async () => {
    await mk('context', '/org/context', 'context', {
      versions: [version([{ name: 'warehouse', type: 'connection' }])], published: { all: 1 },
    } as ContextContent);
    const wl = await getWhitelistForPath('/org/q1', FILES_CONNECTION, ADMIN);
    expect(wl).toBeNull(); // null = unrestricted — upload → query, no ceremony
  });

  it('an EXPLICIT files whitelist narrows to exactly the listed tables', async () => {
    await mk('data', '/org/data', 'dataset', {
      files: [table('public', 'zones'), table('public', 'deals')],
    } as DatasetContent);
    await mk('context', '/org/context', 'context', {
      versions: [version([
        { name: FILES_CONNECTION, type: 'connection', children: [
          { name: 'public', type: 'schema', children: [{ name: 'zones', type: 'table' }] },
        ]},
      ])], published: { all: 1 },
    } as ContextContent);
    const wl = await getWhitelistForPath('/org/q1', FILES_CONNECTION, ADMIN);
    expect(wl).not.toBeNull();
    const flat = (wl ?? []).flatMap((s) => s.tables.map((t) => `${s.schema}.${t.table}`));
    expect(flat).toEqual(['public.zones']);
  });
});
