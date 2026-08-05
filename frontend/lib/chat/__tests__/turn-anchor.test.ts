/**
 * The TURN ANCHOR: which path governs a server-side agent turn.
 *
 * When the side chat is open on a file, the turn must be governed by the
 * FILE's path — the same anchor the file's own execution uses — not the
 * user's home folder. Otherwise a question governed by a deeper context than
 * the home folder gets a prompt/toolset resolved from the wrong context:
 * ExecuteQuery rejects `_views.x` the file itself can run, and LoadContext
 * cannot find docs the file's context defines.
 *
 * Derivation is server-side from agent_args.app_state (like pageType), with
 * a mode guard: a path outside the user's mode root falls back to the home
 * folder. Trust model matches /api/query's client-supplied filePath.
 */
import { DocumentDB } from '@/lib/database/documents-db';
import {
  buildServerAgentArgs,
  deriveTurnAnchorPath,
} from '@/lib/chat/agent-args.server';
import { loadContextDocsByKeys } from '@/lib/sql/context-docs';
import { Orchestrator } from '@/orchestrator/orchestrator';
import { ExecuteQuery } from '@/agents/benchmark-analyst/db-tools.server';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { getModules } from '@/lib/modules/registry';
import type {
  ConnectionContent, ContextContent, ContextVersion, DatabaseSchema, ViewDef,
} from '@/lib/types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const { mockGetSchema, mockGetCachedResultBounded } = vi.hoisted(() => ({
  mockGetSchema: vi.fn(),
  mockGetCachedResultBounded: vi.fn(),
}));
vi.mock('@/lib/connections', () => ({
  getNodeConnector: (name: string) => ({
    getSchema: async () => (await mockGetSchema(name))?.schemas ?? [],
    query: vi.fn().mockResolvedValue({ columns: [], types: [], rows: [] }),
  }),
}));
vi.mock('@/lib/connections/statistics-engine', () => ({
  profileDatabase: vi.fn(async (_t: string, schemas: unknown) => ({ schema: schemas, queryCount: 0 })),
}));
vi.mock('@/lib/query-cache/execute.server', () => ({
  getCachedResultBounded: mockGetCachedResultBounded,
}));

const TEST_DB_PATH = getTestDbPath('turn_anchor');

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

const QUESTION_PATH = '/org/team/kpi-question';
const VIEW_SQL = 'SELECT * FROM _views.clean_kpi';

/** The app_state a side chat on the question page sends. */
const fileAppState = {
  type: 'file',
  state: {
    fileState: {
      id: 42, name: 'kpi-question', path: QUESTION_PATH, type: 'question', isDirty: false,
    },
  },
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

describe('deriveTurnAnchorPath', () => {
  it('returns the open file\'s path for a file page', () => {
    expect(deriveTurnAnchorPath(fileAppState, user)).toBe(QUESTION_PATH);
  });

  it('returns undefined for folder, explore, and absent app states', () => {
    expect(deriveTurnAnchorPath({ type: 'folder', state: { files: [] } }, user)).toBeUndefined();
    expect(deriveTurnAnchorPath({ type: 'explore', state: null }, user)).toBeUndefined();
    expect(deriveTurnAnchorPath(null, user)).toBeUndefined();
    expect(deriveTurnAnchorPath(undefined, user)).toBeUndefined();
    expect(deriveTurnAnchorPath('garbage', user)).toBeUndefined();
    expect(deriveTurnAnchorPath({ type: 'file', state: {} }, user)).toBeUndefined();
    expect(deriveTurnAnchorPath({ type: 'file', state: { fileState: { path: 42 } } }, user)).toBeUndefined();
  });

  it('MODE GUARD: a path outside the user\'s mode root is rejected', () => {
    const outside = {
      type: 'file',
      state: { fileState: { path: '/tutorial/sneaky-question', type: 'question' } },
    };
    expect(deriveTurnAnchorPath(outside, user)).toBeUndefined();
    const tutorialUser: EffectiveUser = { ...user, mode: 'tutorial' };
    expect(deriveTurnAnchorPath(fileAppState, tutorialUser)).toBeUndefined();
  });
});

describe('turn anchor end-to-end', () => {
  setupTestDb(TEST_DB_PATH);

  beforeEach(async () => {
    mockGetSchema.mockClear();
    mockGetCachedResultBounded.mockReset();
    mockGetCachedResultBounded.mockResolvedValue({
      result: { columns: ['id', 'total'], types: ['BIGINT', 'DOUBLE'], rows: [[1, 9.5]] },
    });
    await getModules().db.exec('DELETE FROM files', []);
    mockGetSchema.mockImplementation((n: string) =>
      n === 'warehouse' ? Promise.resolve(SCHEMA) : Promise.resolve({ schemas: [] }));

    const conn: ConnectionContent = { type: 'duckdb', config: { file_path: '../data/x.duckdb' }, schema: SCHEMA };
    await mkPublished('warehouse', '/org/database/warehouse', 'connection', conn);

    // Root context: explicit curation, no views, no docs — governs the home folder.
    await mkPublished('context', '/org/context', 'context',
      { versions: [version({})], published: { all: 1 } } as ContextContent);

    // Team context: defines the view AND the doc — governs the question's path.
    await mkPublished('context', '/org/team/context', 'context', {
      versions: [version({
        views: [CLEAN_KPI],
        docs: [{ title: 'BSim Dataset', description: 'What the bsim dataset contains', content: 'Full bsim dataset docs.' }],
      })],
      published: { all: 1 },
    } as ContextContent);
  });

  it('buildServerAgentArgs anchored at the file resolves the FILE\'s context docs', async () => {
    const args = await buildServerAgentArgs(user, { anchorPath: QUESTION_PATH });
    const { payload, isError } = loadContextDocsByKeys(args.context_docs, ['bsim_dataset']);
    expect(isError).toBe(false);
    expect(JSON.stringify(payload)).toContain('Full bsim dataset docs.');
  });

  it('buildServerAgentArgs without an anchor keeps the home-folder behavior', async () => {
    const args = await buildServerAgentArgs(user);
    const { isError } = loadContextDocsByKeys(args.context_docs, ['bsim_dataset']);
    expect(isError).toBe(true);
  });

  it('ExecuteQuery anchored at the file accepts and inlines the view query', async () => {
    const orch = new Orchestrator([]);
    const tool = new ExecuteQuery(orch,
      { connectionId: 'warehouse', query: VIEW_SQL },
      { connections: [], effectiveUser: user, homeFolder: '/org', anchorPath: QUESTION_PATH } as never);
    const res = await tool.run();

    expect(res.isError).toBe(false);
    // The cache was handed the RESOLVED SQL — view body inlined.
    const call = mockGetCachedResultBounded.mock.calls[0][0];
    expect(call.query).toContain('mxfood.orders');
  });

  it('ExecuteQuery without an anchor still enforces the home-folder whitelist', async () => {
    const orch = new Orchestrator([]);
    const tool = new ExecuteQuery(orch,
      { connectionId: 'warehouse', query: VIEW_SQL },
      { connections: [], effectiveUser: user, homeFolder: '/org' } as never);
    const res = await tool.run();

    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain('outside the allowed schema');
  });
});
