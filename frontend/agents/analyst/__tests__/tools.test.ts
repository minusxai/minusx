import { Orchestrator } from '@/orchestrator/orchestrator';
import type { AnalystAgentContext } from '../types';
import {
  ExecuteQuery,
  SearchDBSchema,
} from '../analyst-agent';

// Mock the production chokepoints. Production `SearchDBSchema` / `ExecuteQuery`
// route here, so configuring these mocks is how tests inject schemas/rows.
const { mockLoadSchema, mockRunQuery, mockLoadNearestContext } = vi.hoisted(() => ({
  mockLoadSchema: vi.fn(),
  mockRunQuery: vi.fn(),
  mockLoadNearestContext: vi.fn(),
}));
vi.mock('@/lib/connections/load-schema', () => ({
  loadConnectionSchema: mockLoadSchema,
}));
// SearchDBSchema resolves the nearest context to surface its views as `_views`
// tables; RunSemanticQuery shares the module. Models are irrelevant here.
vi.mock('@/lib/semantic/models.server', () => ({
  loadNearestContext: mockLoadNearestContext,
  resolveModelsForContext: () => [],
}));
// ExecuteQuery inlines `_views.x` via getViewsForPath before executing; keep the
// pure helpers (resolveViewsForContext) real.
const { mockGetViewsForPath } = vi.hoisted(() => ({ mockGetViewsForPath: vi.fn() }));
vi.mock('@/lib/views/views.server', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getViewsForPath: mockGetViewsForPath,
}));
// ExecuteQuery now streams (runQueryStream) and reads BOUNDED through the durable cache
// (getCachedResultBounded). Keep the tests driving rows via mockRunQuery: expose runQueryStream as
// a one-shot stream over its result, and stub the cache to just run the execute thunk + bounded-drain
// it with the REAL primitive (so truncation/compression behavior is exercised, no blob store needed).
vi.mock('@/lib/connections/run-query', async () => {
  const { queryResultToStream } = await import('@/lib/connections/base');
  return {
    runQuery: mockRunQuery,
    runQueryStream: async (...args: unknown[]) => queryResultToStream(await mockRunQuery(...args)),
  };
});
vi.mock('@/lib/query-cache/execute.server', async () => {
  const { drainQueryStreamBounded } = await import('@/lib/connections/base');
  return {
    getCachedResultBounded: async (opts: { execute: () => Promise<any> }, budget: any) => {
      const result = await drainQueryStreamBounded(await opts.execute(), budget);
      return { result, truncated: result.truncated, meta: { rowCount: result.rows.length, colCount: result.columns.length, fromCache: false, cachedAt: 0, finalQuery: result.finalQuery } };
    },
  };
});

// Production tools route via `loadConnectionSchema(name, user)` /
// `runQuery(name, sql, params, user)` — both require an EffectiveUser on
// the context. Synthesise a fake one for these tests; the mocked functions
// ignore the value but the production-side guards check for presence.
const ctx: AnalystAgentContext = {
  userId: 'u',
  mode: 'org',
  effectiveUser: {
    userId: 1,
    email: 'test@example.com',
    name: 'Test',
    role: 'admin',
    home_folder: '/org',
    mode: 'org',
  },
} as AnalystAgentContext;

const fakeSchemas = [
  {
    schema: 'main',
    tables: [
      { table: 'users', columns: [{ name: 'id', type: 'int' }, { name: 'created_at', type: 'timestamp' }] },
    ],
  },
];

describe('SearchDBSchema', () => {
  beforeEach(() => {
    mockLoadSchema.mockReset();
    mockRunQuery.mockReset();
    mockLoadNearestContext.mockReset();
    mockLoadNearestContext.mockResolvedValue(null);
  });

  it('returns production-shaped {success, queryType, tableCount, results} on keyword match', async () => {
    mockLoadSchema.mockResolvedValue(fakeSchemas);

    const orch = new Orchestrator([]);
    const tool = new SearchDBSchema(orch, { connection_id: 'main', query: 'users' }, ctx);
    const res = await tool.run();

    expect(res.isError).toBe(false);
    expect(res.content[0]).toMatchObject({ type: 'text' });
    const parsed = JSON.parse((res.content[0] as { text: string }).text);
    expect(parsed.success).toBe(true);
    expect(parsed.queryType).toBe('string');
    expect(parsed.tableCount).toBeGreaterThanOrEqual(1);
    // Production format: results[].schema wraps the full schema object, with score/matchCount
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].schema).toBeDefined();
    expect(parsed.results[0].schema.schema).toBe('main');
    expect(parsed.results[0].score).toBeGreaterThan(0);
    expect(parsed.results[0].matchCount).toBeGreaterThan(0);
  });

  it('returns empty results array when no schemas match the query', async () => {
    mockLoadSchema.mockResolvedValue(fakeSchemas);

    const orch = new Orchestrator([]);
    const tool = new SearchDBSchema(orch, { connection_id: 'main', query: 'foobars' }, ctx);
    const res = await tool.run();

    expect(res.isError).toBe(false);
    const parsed = JSON.parse((res.content[0] as { text: string }).text);
    expect(parsed).toMatchObject({ success: true, tableCount: 0, results: [] });
  });

  // Views are VIRTUAL tables: injected into the agent's prompt schema by the
  // context loader but absent from the connection's introspected schema. The
  // production tool appends the nearest context's views as a `_views` schema
  // entry so a whitelisted view is discoverable by schema search — without it,
  // searching for a view the agent was just told about returns "no matches".
  const contextWithView = (view: object) => ({
    versions: [{
      version: 1, whitelist: [], docs: [], views: [view],
      createdAt: '', createdBy: 1,
    }],
    published: { all: 1 },
  });
  const CLEAN_KPI = {
    name: 'clean_kpi', connection: 'main', sql: 'SELECT 1',
    columns: [{ name: 'actual', type: 'DOUBLE' }, { name: 'target', type: 'DOUBLE' }],
  };

  it('surfaces the nearest context\'s views as searchable _views tables', async () => {
    mockLoadSchema.mockResolvedValue(fakeSchemas);
    mockLoadNearestContext.mockResolvedValue(contextWithView(CLEAN_KPI));

    const orch = new Orchestrator([]);
    const tool = new SearchDBSchema(orch, { connection_id: 'main', query: 'clean_kpi' }, ctx);
    const res = await tool.run();

    expect(res.isError).toBe(false);
    const parsed = JSON.parse((res.content[0] as { text: string }).text);
    expect(parsed.success).toBe(true);
    const viewsEntry = parsed.results.find(
      (r: { schema: { schema: string } }) => r.schema.schema === '_views',
    );
    expect(viewsEntry).toBeTruthy();
    const table = viewsEntry.schema.tables.find((t: { table: string }) => t.table === 'clean_kpi');
    expect(table).toBeTruthy();
    expect(table.columns.map((c: { name: string }) => c.name)).toEqual(['actual', 'target']);
  });

  it('does not surface views belonging to a different connection', async () => {
    mockLoadSchema.mockResolvedValue(fakeSchemas);
    mockLoadNearestContext.mockResolvedValue(
      contextWithView({ ...CLEAN_KPI, connection: 'other_warehouse' }),
    );

    const orch = new Orchestrator([]);
    const tool = new SearchDBSchema(orch, { connection_id: 'main', query: 'clean_kpi' }, ctx);
    const res = await tool.run();

    const parsed = JSON.parse((res.content[0] as { text: string }).text);
    expect(parsed).toMatchObject({ success: true, tableCount: 0, results: [] });
  });

  it('the per-run table whitelist still applies to _views tables (fail closed)', async () => {
    mockLoadSchema.mockResolvedValue(fakeSchemas);
    mockLoadNearestContext.mockResolvedValue(contextWithView(CLEAN_KPI));

    const orch = new Orchestrator([]);
    // Whitelist names only the physical table — the view is NOT whitelisted.
    const restricted = { ...ctx, whitelistedTables: ['users', 'main.users'] };
    const tool = new SearchDBSchema(orch, { connection_id: 'main', query: 'clean_kpi' }, restricted);
    const res = await tool.run();

    const parsed = JSON.parse((res.content[0] as { text: string }).text);
    expect(parsed).toMatchObject({ success: true, tableCount: 0, results: [] });

    // Whitelisted (the flattened context schema carries both bare and qualified
    // forms) → the view is searchable.
    const allowed = { ...ctx, whitelistedTables: ['users', 'main.users', 'clean_kpi', '_views.clean_kpi'] };
    const tool2 = new SearchDBSchema(orch, { connection_id: 'main', query: 'clean_kpi' }, allowed);
    const res2 = await tool2.run();
    const parsed2 = JSON.parse((res2.content[0] as { text: string }).text);
    expect(parsed2.tableCount).toBeGreaterThanOrEqual(1);
    expect(parsed2.results[0].schema.schema).toBe('_views');
  });

  it('a context that fails to load degrades to the plain connection schema', async () => {
    mockLoadSchema.mockResolvedValue(fakeSchemas);
    mockLoadNearestContext.mockRejectedValue(new Error('db down'));

    const orch = new Orchestrator([]);
    const tool = new SearchDBSchema(orch, { connection_id: 'main' }, ctx);
    const res = await tool.run();

    expect(res.isError).toBe(false);
    const parsed = JSON.parse((res.content[0] as { text: string }).text);
    expect(parsed.schema).toEqual(fakeSchemas);
  });

  it('returns full schema when no query is provided', async () => {
    mockLoadSchema.mockResolvedValue(fakeSchemas);

    const orch = new Orchestrator([]);
    const tool = new SearchDBSchema(orch, { connection_id: 'main' }, ctx);
    const res = await tool.run();

    expect(res.isError).toBe(false);
    const parsed = JSON.parse((res.content[0] as { text: string }).text);
    expect(parsed.success).toBe(true);
    expect(parsed.queryType).toBe('none');
    expect(parsed.schema).toEqual(fakeSchemas);
  });
});

describe('ExecuteQuery', () => {
  beforeEach(() => {
    mockLoadSchema.mockReset();
    mockRunQuery.mockReset();
    mockGetViewsForPath.mockReset();
    mockGetViewsForPath.mockResolvedValue([]);
  });

  // Views are virtual — the warehouse has no `_views` schema, so SQL referencing
  // one must be inlined as a CTE before execution (the UI's /api/query does this;
  // the agent's tool must too, or a view the agent can discover is unqueryable).
  it('inlines _views.x as a CTE before executing (same as /api/query)', async () => {
    mockGetViewsForPath.mockResolvedValue([{
      name: 'zone_speed', connection: 'main',
      sql: 'SELECT zone_name, avg_delivery_time_mins FROM mxfood.zones',
    }]);
    mockRunQuery.mockResolvedValue({ columns: ['zone_name'], types: ['string'], rows: [{ zone_name: 'North' }], finalQuery: '' });

    const orch = new Orchestrator([]);
    const tool = new ExecuteQuery(orch, {
      connectionId: 'main',
      query: 'SELECT zone_name FROM _views.zone_speed LIMIT 5',
    }, ctx);
    const res = await tool.run();

    expect(res.isError).toBe(false);
    const executedSql = mockRunQuery.mock.calls[0][1] as string;
    expect(executedSql).toContain('mxfood.zones');            // view body inlined
    expect(executedSql).not.toContain('_views.zone_speed');   // virtual ref gone
  });

  it('a query referencing an unknown view fails with a pointing error, not a warehouse error', async () => {
    mockGetViewsForPath.mockResolvedValue([]);

    const orch = new Orchestrator([]);
    const tool = new ExecuteQuery(orch, {
      connectionId: 'main',
      query: 'SELECT * FROM _views.nope',
    }, ctx);
    const res = await tool.run();

    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toContain('unknown view');
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it('non-view SQL passes through byte-identical (never parsed)', async () => {
    mockRunQuery.mockResolvedValue({ columns: ['count'], types: ['int'], rows: [{ count: 1 }], finalQuery: '' });
    const weird = 'SELECT count(*) FROM users -- keep\n';

    const orch = new Orchestrator([]);
    const tool = new ExecuteQuery(orch, { connectionId: 'main', query: weird }, ctx);
    await tool.run();

    expect(mockGetViewsForPath).not.toHaveBeenCalled();
    expect(mockRunQuery.mock.calls[0][1]).toBe(weird);
  });

  it('returns compressed markdown + metadata on success', async () => {
    const rows = [{ count: 42 }];
    mockRunQuery.mockResolvedValue({ columns: ['count'], types: ['int'], rows, finalQuery: 'SELECT count(*) FROM users' });

    const orch = new Orchestrator([]);
    const tool = new ExecuteQuery(orch, { connectionId: 'main', query: 'SELECT count(*) FROM users' }, ctx);
    const res = await tool.run();

    expect(res.isError).toBe(false);
    const parsed = JSON.parse((res.content[0] as { text: string }).text);
    // LLM-visible content: markdown table + truncation metadata
    expect(parsed).toMatchObject({
      success: true,
      totalRows: 1,
      shownRows: 1,
      truncated: false,
    });
    expect(typeof parsed.data).toBe('string');
    expect(parsed.data).toContain('count');
    // Full rows available in details for UI display
    expect(res.details).toMatchObject({
      success: true,
      queryResult: { rows },
    });
  });

  it('returns isError=true with the error message when the executor fails', async () => {
    mockRunQuery.mockRejectedValue(new Error('syntax error near "FRM"'));

    const orch = new Orchestrator([]);
    const tool = new ExecuteQuery(orch, { connectionId: 'main', query: 'SELECT * FRM bad' }, ctx);
    const res = await tool.run();

    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toContain('syntax error');
  });
});
