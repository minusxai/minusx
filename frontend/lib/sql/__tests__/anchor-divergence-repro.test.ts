/**
 * REPRO: server-side agent turns anchor at the user's HOME FOLDER, while a
 * question's own execution anchors at the FILE's path. When the question is
 * governed by a deeper context than the home folder's nearest context, the two
 * surfaces disagree:
 *
 *   1. ExecuteQuery (anchored at homeFolder) rejects `_views.x` with a
 *      WhitelistViolationError, while the identical SQL saved into the file
 *      executes fine (anchored at the file's path).
 *   2. buildServerAgentArgs resolves context DOCS from the home folder's
 *      nearest context, so LoadContext answers "No context documents are
 *      available to load" for a doc the question's own context defines.
 */
import { DocumentDB } from '@/lib/database/documents-db';
import { FilesAPI } from '@/lib/data/files.server';
import {
  resolveQueryForExecution,
  WhitelistViolationError,
} from '@/lib/sql/governed-query.server';
import { loadContextDocsByKeys, resolveContextDocs } from '@/lib/sql/context-docs';
import { buildServerAgentArgs } from '@/lib/chat/agent-args.server';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { getModules } from '@/lib/modules/registry';
import type {
  ConnectionContent, ContextContent, ContextVersion, DatabaseSchema, ViewDef,
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
  profileDatabase: vi.fn(async (_t: string, schemas: unknown) => ({ schema: schemas, queryCount: 0 })),
}));

const TEST_DB_PATH = getTestDbPath('anchor_divergence');

// home_folder '' resolves to the mode root — the anchor the agent's
// ExecuteQuery and buildServerAgentArgs both use today.
const user: EffectiveUser = {
  userId: 1, name: 'U', email: 'u@e.com', role: 'admin', mode: 'org', home_folder: '',
};

const SCHEMA: DatabaseSchema = {
  updated_at: new Date().toISOString(),
  schemas: [{
    schema: 'mxfood',
    tables: [
      { table: 'orders', columns: [{ name: 'id', type: 'BIGINT' }, { name: 'total', type: 'DOUBLE' }] },
    ],
  }],
};

const CLEAN_KPI: ViewDef = {
  name: 'clean_kpi',
  connection: 'warehouse',
  sql: 'SELECT id, total FROM mxfood.orders WHERE total > 0',
  columns: [{ name: 'id', type: 'BIGINT' }, { name: 'total', type: 'DOUBLE' }],
  description: 'Cleaned KPI rows',
};

async function mkPublished(name: string, path: string, type: string, content: object): Promise<number> {
  const id = await DocumentDB.create(name, path, type, content, []);
  await DocumentDB.update(id, name, path, content, [], `init-${id}`);
  return id;
}

const version = (extra: Partial<ContextVersion>): ContextVersion => ({
  version: 1,
  whitelist: [{ name: 'warehouse', type: 'connection' }],
  docs: [],
  createdAt: new Date().toISOString(),
  createdBy: 1,
  ...extra,
});

describe('anchor divergence: home folder vs file path', () => {
  setupTestDb(TEST_DB_PATH);
  let teamContextId: number;

  beforeEach(async () => {
    mockGetSchema.mockClear();
    await getModules().db.exec('DELETE FROM files', []);
    mockGetSchema.mockImplementation((n: string) =>
      n === 'warehouse' ? Promise.resolve(SCHEMA) : Promise.resolve({ schemas: [] }));

    const conn: ConnectionContent = { type: 'duckdb', config: { file_path: '../data/x.duckdb' }, schema: SCHEMA };
    await mkPublished('warehouse', '/org/database/warehouse', 'connection', conn);

    // Root context: curates explicitly (NOT '*'), no views, no docs. This is
    // what governs the HOME FOLDER anchor.
    await mkPublished('context', '/org/context', 'context',
      { versions: [version({})], published: { all: 1 } } as ContextContent);

    // Team context: defines the view AND the doc. This is what governs the
    // question file's own path.
    teamContextId = await mkPublished('context', '/org/team/context', 'context', {
      versions: [version({
        views: [CLEAN_KPI],
        docs: [{ title: 'BSim Dataset', description: 'What the bsim dataset contains', content: 'Full bsim dataset docs.' }],
      })],
      published: { all: 1 },
    } as ContextContent);
  });

  const SQL = 'SELECT * FROM _views.clean_kpi';

  it('ISSUE 1 repro: the agent anchor (home folder) rejects the view query', async () => {
    // Exactly what ExecuteQuery does: anchor {kind:'file', path: homeFolder}.
    await expect(resolveQueryForExecution({
      sql: SQL, connectionName: 'warehouse', user,
      anchor: { kind: 'file', path: '/org' },
    })).rejects.toThrow(WhitelistViolationError);
  });

  it('ISSUE 1 control: the file anchor accepts and inlines the same SQL', async () => {
    const governed = await resolveQueryForExecution({
      sql: SQL, connectionName: 'warehouse', user,
      anchor: { kind: 'file', path: '/org/team/kpi-question' },
    });
    expect(governed.executedQuery).toContain('mxfood.orders'); // view body inlined
  });

  it('ISSUE 2 repro: buildServerAgentArgs resolves docs from the home folder, so LoadContext finds nothing', async () => {
    const args = await buildServerAgentArgs(user);
    // The turn's resolvedContextDocs — what the LoadContext tool reads.
    const { payload, isError } = loadContextDocsByKeys(args.context_docs, ['bsim_dataset']);
    expect(isError).toBe(true);
    expect(JSON.stringify(payload)).toContain('No context documents are available to load');
  });

  it('ISSUE 2 control: the question\'s own context resolves the doc', async () => {
    const { data } = await FilesAPI.loadFile(teamContextId, user);
    const docs = resolveContextDocs(data.content as ContextContent, user.userId);
    const { payload, isError } = loadContextDocsByKeys(docs, ['bsim_dataset']);
    expect(isError).toBe(false);
    expect(JSON.stringify(payload)).toContain('Full bsim dataset docs.');
  });
});
