import { Orchestrator } from '@/orchestrator/orchestrator';
import type { AnalystAgentContext } from '../types';
import {
  ExecuteQuery,
  SearchDBSchema,
} from '../analyst-agent';

// Mock the production chokepoints. Production `SearchDBSchema` / `ExecuteQuery`
// route here, so configuring these mocks is how tests inject schemas/rows.
const { mockLoadSchema, mockRunQuery } = vi.hoisted(() => ({
  mockLoadSchema: vi.fn(),
  mockRunQuery: vi.fn(),
}));
vi.mock('@/lib/connections/load-schema', () => ({
  loadConnectionSchema: mockLoadSchema,
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
