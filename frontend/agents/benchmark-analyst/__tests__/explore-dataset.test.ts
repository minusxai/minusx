import { fauxAssistantMessage, type TextContent } from '@mariozechner/pi-ai';
import { Orchestrator } from '@/orchestrator/orchestrator';
import {
  BenchmarkAnalystAgent,
  fauxRegistration,
} from '../benchmark-analyst';
import {
  BaseExecuteQuery,
  BaseSearchDBSchema,
  ListDBConnections,
  FuzzyMatch,
} from '../db-tools';
import { ExploreDataset, setExploreModel, interpolateMongoRefs } from '../explore-dataset';
import type { BenchmarkAnalystContext } from '../types';

const defaultRows = () => ({
  columns: ['id', 'name', 'category'],
  types: ['INTEGER', 'VARCHAR', 'VARCHAR'],
  rows: [
    { id: 1, name: 'Widget A', category: 'electronics' },
    { id: 2, name: 'Widget B', category: 'electronics' },
    { id: 3, name: 'Gadget C', category: 'home' },
  ] as Record<string, unknown>[],
});
const mockQuery = vi.fn(async (_query?: string) => defaultRows());

// Partial mock — keep handle-table helpers real so storeHandle /
// qualifyHandleRefs work end-to-end in the parity tests below.
vi.mock('../shared-duckdb', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared-duckdb')>()),
  getOrCreateBenchmarkConnector: vi.fn(async () => ({
    query: mockQuery,
    getSchema: vi.fn(async () => []),
    close: vi.fn(),
  })),
}));

const REGISTRABLES = [
  ListDBConnections,
  BaseSearchDBSchema,
  BaseExecuteQuery,
  BenchmarkAnalystAgent,
  FuzzyMatch,
  ExploreDataset,
];

const CTX: BenchmarkAnalystContext = {
  connections: [
    { name: 'orders_db', dialect: 'duckdb', description: 'orders', config: { file_path: '/test/orders.duckdb' } },
    { name: 'products_db', dialect: 'sqlite', description: 'products', config: { file_path: '/test/products.db' } },
    { name: 'mongo_db', dialect: 'mongo', description: 'biz', config: { host: 'localhost', port: 27017, database: 'd' } },
  ],
  contextDocs: '',
};

beforeAll(() => {
  setExploreModel(fauxRegistration.getModel());
});

describe('ExploreDataset', () => {
  it('executes a single query and returns LLM analysis', async () => {
    const analysisText = 'Category "electronics": id 1, 2\nCategory "home": id 3';

    fauxRegistration.setResponses([
      fauxAssistantMessage(analysisText, { stopReason: 'stop' }),
    ]);

    const orch = new Orchestrator(REGISTRABLES);
    const tool = new ExploreDataset(
      orch,
      {
        queries: [
          { connection: 'orders_db', query: 'SELECT id, name, category FROM products ORDER BY id', label: 'products' },
        ],
        prompt: 'Group rows by category, return mapping of category → [ids]',
      },
      CTX,
      'test-single',
    );

    const result = await tool.run();

    expect(result.isError).toBe(false);
    const content = JSON.parse((result.content[0] as TextContent).text);
    expect(content.success).toBe(true);
    expect(content.analysis).toBe(analysisText);
    expect(content.executedQueries).toHaveLength(1);
    expect(result.details?.totalRowCount).toBe(3);
  });

  it('executes multiple queries across connections', async () => {
    const analysisText = 'Top product by revenue: Widget A (id 1), $500';

    fauxRegistration.setResponses([
      fauxAssistantMessage(analysisText, { stopReason: 'stop' }),
    ]);

    const orch = new Orchestrator(REGISTRABLES);
    const tool = new ExploreDataset(
      orch,
      {
        queries: [
          { connection: 'orders_db', query: 'SELECT product_id, SUM(amount) as total FROM orders GROUP BY product_id ORDER BY total DESC LIMIT 1000', label: 'revenue' },
          { connection: 'products_db', query: 'SELECT id, name, category FROM products WHERE id IN ($revenue.product_id)', label: 'products' },
        ],
        prompt: 'Join on product_id=id, return product name + total revenue sorted desc',
      },
      CTX,
      'test-multi',
    );

    const result = await tool.run();

    expect(result.isError).toBe(false);
    const content = JSON.parse((result.content[0] as TextContent).text);
    expect(content.success).toBe(true);
    expect(content.analysis).toBe(analysisText);
    expect(content.executedQueries).toHaveLength(2);
    expect(result.details?.totalRowCount).toBe(6);
  });

  it('interpolates $label.column references from earlier query results', async () => {
    // Query 1 returns rows with id column; query 2 references $revenue.id
    mockQuery
      .mockResolvedValueOnce({
        columns: ['id', 'total'],
        types: ['INTEGER', 'DECIMAL'],
        rows: [
          { id: 10, total: 500 },
          { id: 20, total: 300 },
          { id: 30, total: 100 },
        ],
      })
      .mockResolvedValueOnce({
        columns: ['id', 'name'],
        types: ['INTEGER', 'VARCHAR'],
        rows: [
          { id: 10, name: 'Product X' },
          { id: 20, name: 'Product Y' },
          { id: 30, name: 'Product Z' },
        ],
      });

    fauxRegistration.setResponses([
      fauxAssistantMessage('Product X: $500, Product Y: $300, Product Z: $100', { stopReason: 'stop' }),
    ]);

    const orch = new Orchestrator(REGISTRABLES);
    const tool = new ExploreDataset(
      orch,
      {
        queries: [
          { connection: 'orders_db', query: 'SELECT id, SUM(amount) as total FROM orders GROUP BY id ORDER BY total DESC', label: 'revenue' },
          { connection: 'products_db', query: 'SELECT id, name FROM products WHERE id IN ($revenue.id)', label: 'products' },
        ],
        prompt: 'Return product name + total revenue sorted desc',
      },
      CTX,
      'test-ref',
    );

    const result = await tool.run();

    expect(result.isError).toBe(false);
    const content = JSON.parse((result.content[0] as TextContent).text);
    expect(content.success).toBe(true);
    expect(content.executedQueries).toHaveLength(2);

    // Verify the interpolated query is in executedQueries (finalQuery)
    const secondQuery = content.executedQueries[1].finalQuery as string;
    expect(secondQuery).toContain('10, 20, 30');
    expect(secondQuery).not.toContain('$revenue.id');
  });

  it('passes contextDocs to the explore LLM system prompt', async () => {
    const docs = '## Revenue Table\nContains daily revenue by product.';
    const ctxWithDocs: BenchmarkAnalystContext = {
      ...CTX,
      contextDocs: docs,
    };

    fauxRegistration.setResponses([
      fauxAssistantMessage('done', { stopReason: 'stop' }),
    ]);

    const orch = new Orchestrator(REGISTRABLES);
    const callLLMSpy = vi.spyOn(orch, 'callLLM');

    const tool = new ExploreDataset(
      orch,
      {
        queries: [
          { connection: 'orders_db', query: 'SELECT id, name, category FROM products ORDER BY id', label: 'products' },
        ],
        prompt: 'Summarize',
      },
      ctxWithDocs,
      'test-docs',
    );

    await tool.run();

    expect(callLLMSpy).toHaveBeenCalledOnce();
    const ctx = callLLMSpy.mock.calls[0][1];
    expect(ctx.systemPrompt).toContain(docs);

    callLLMSpy.mockRestore();
  });

  // Parity with ChainedExecuteQuery: the V1 agent learns about `_scratch`
  // and `FROM handle_xyz` from the new tool descriptions and uses BOTH
  // tools interchangeably. ExploreDataset must support the same primitives.
  describe('parity with ChainedExecuteQuery (_scratch + handles)', () => {
    it('auto-injects the _scratch DuckDB connection — agent can use it without listing it in ctx', async () => {
      // Faux LLM response so the tool's lighter-model pass succeeds.
      fauxRegistration.setResponses([
        fauxAssistantMessage('analysis', { stopReason: 'stop' }),
      ]);
      const orch = new Orchestrator(REGISTRABLES);
      const tool = new ExploreDataset(
        orch,
        {
          // _scratch is NOT in ctx.connections, but ExploreDataset must
          // make it available — same as ChainedExecuteQuery does.
          queries: [{ connection: '_scratch', query: 'SELECT 1', label: 'q' }],
          prompt: 'just confirm a row was returned',
        },
        { connections: [], contextDocs: '' },
        'test-scratch-parity',
      );
      const result = await tool.run();
      const content = JSON.parse((result.content[0] as TextContent).text);
      const err = (content.error ?? '') as string;
      expect(err).not.toMatch(/Connection '_scratch' not found/i);
    });

    it('rewrites FROM handle_xyz via qualifyHandleRefs before sending to the connector', async () => {
      const { storeHandle } = await import('../v2/handle-store');
      const stored = await storeHandle({
        columns: ['id'],
        types: ['INTEGER'],
        rows: [{ id: 1 }],
        finalQuery: '',
      });
      expect(stored.error).toBeUndefined();
      const handleId = stored.handleId;

      mockQuery.mockClear();
      fauxRegistration.setResponses([
        fauxAssistantMessage('analysis', { stopReason: 'stop' }),
      ]);
      const orch = new Orchestrator(REGISTRABLES);
      const tool = new ExploreDataset(
        orch,
        {
          queries: [{
            connection: 'orders_db',
            query: `SELECT count(*) AS c FROM ${handleId}`,
            label: 'q',
          }],
          prompt: 'confirm',
        },
        CTX,
        'test-handle-qual',
      );
      await tool.run();

      expect(mockQuery).toHaveBeenCalled();
      const sentSql = mockQuery.mock.calls[0][0] as string;
      expect(sentSql).toContain(`memory.main."${handleId}"`);
    });
  });

  it('returns error when connection is not found', async () => {
    const orch = new Orchestrator(REGISTRABLES);
    const tool = new ExploreDataset(
      orch,
      {
        queries: [{ connection: 'missing_db', query: 'SELECT 1', label: 'test' }],
        prompt: 'test',
      },
      { connections: [], contextDocs: '' },
      'test-bad-conn',
    );

    const result = await tool.run();

    expect(result.isError).toBe(true);
    const content = JSON.parse((result.content[0] as TextContent).text);
    expect(content.success).toBe(false);
    expect(content.error).toContain('not found');
  });
});

describe('interpolateMongoRefs', () => {
  it('replaces a quoted "$label.column" token with a JSON array of values', () => {
    const labeled = new Map([['revenue', [{ id: 10 }, { id: 20 }, { id: 30 }]]]);
    const json = '{"collection":"biz","pipeline":[{"$match":{"id":{"$in":"$revenue.id"}}}]}';
    const out = interpolateMongoRefs(json, labeled);
    expect(out).toBe('{"collection":"biz","pipeline":[{"$match":{"id":{"$in":[10,20,30]}}}]}');
    expect(JSON.parse(out)).toBeDefined(); // still valid JSON
  });

  it('JSON-encodes string values (quoted array elements)', () => {
    const labeled = new Map([['cities', [{ name: 'NYC' }, { name: 'LA' }]]]);
    const out = interpolateMongoRefs('{"$in":"$cities.name"}', labeled);
    expect(out).toBe('{"$in":["NYC","LA"]}');
  });

  it('leaves an unknown label untouched (it is a Mongo field path, not a ref)', () => {
    const labeled = new Map([['revenue', [{ id: 1 }]]]);
    // "$user.name" is a nested-field reference, not a known query label
    const json = '{"$project":{"n":"$user.name"}}';
    expect(interpolateMongoRefs(json, labeled)).toBe(json);
  });

  it('interpolates a missing/empty column to [] ', () => {
    const labeled = new Map([['revenue', [{ id: 1 }, { id: 2 }]]]);
    const out = interpolateMongoRefs('{"$in":"$revenue.missing"}', labeled);
    expect(out).toBe('{"$in":[]}');
  });

  it('replaces multiple refs in one pipeline', () => {
    const labeled = new Map([
      ['a', [{ x: 1 }]],
      ['b', [{ y: 'q' }]],
    ]);
    const out = interpolateMongoRefs('["$a.x","$b.y"]', labeled);
    expect(out).toBe('[[1],["q"]]');
  });

  it('replaces an UNQUOTED "$label.column" token (the common SQL-habit mistake)', () => {
    // The LLM frequently writes `{"$in": $revenue.id}` (SQL `IN ($revenue.id)`
    // habit) instead of the quoted `{"$in": "$revenue.id"}`. We interpolate it
    // anyway so the result is valid JSON the connector can run.
    const labeled = new Map([['revenue', [{ id: 10 }, { id: 20 }, { id: 30 }]]]);
    const json = '{"collection":"biz","pipeline":[{"$match":{"id":{"$in":$revenue.id}}}]}';
    const out = interpolateMongoRefs(json, labeled);
    expect(out).toBe('{"collection":"biz","pipeline":[{"$match":{"id":{"$in":[10,20,30]}}}]}');
    expect(JSON.parse(out)).toBeDefined(); // unquoted ref → now valid JSON
  });

  it('leaves an unquoted unknown label untouched', () => {
    const labeled = new Map([['revenue', [{ id: 1 }]]]);
    expect(interpolateMongoRefs('{"$in":$user.name}', labeled)).toBe('{"$in":$user.name}');
  });
});

describe('ExploreDataset — MongoDB connections (native pipelines)', () => {
  beforeEach(() => {
    mockQuery.mockClear();
    mockQuery.mockImplementation(async () => defaultRows());
  });

  it('runs a native {collection,pipeline} JSON query without SQL limit-enforcement', async () => {
    fauxRegistration.setResponses([fauxAssistantMessage('done', { stopReason: 'stop' })]);
    const orch = new Orchestrator(REGISTRABLES);
    const queryJson = JSON.stringify({ collection: 'biz', pipeline: [{ $group: { _id: '$category' } }] });
    const tool = new ExploreDataset(
      orch,
      {
        queries: [{ connection: 'mongo_db', query: queryJson, label: 'cats' }],
        prompt: 'summarize',
      },
      CTX,
      'test-mongo-single',
    );

    const result = await tool.run();

    expect(result.isError).toBe(false);
    // The JSON string reached the connector verbatim — enforceQueryLimit (a
    // SQL parser) did not run on it.
    expect(mockQuery.mock.calls[0][0]).toBe(queryJson);
  });

  it('interpolates $label.column refs into the pipeline JSON as a JSON array', async () => {
    mockQuery
      .mockResolvedValueOnce({
        columns: ['id'], types: ['INTEGER'],
        rows: [{ id: 10 }, { id: 20 }, { id: 30 }],
      })
      .mockResolvedValueOnce(defaultRows());
    fauxRegistration.setResponses([fauxAssistantMessage('done', { stopReason: 'stop' })]);
    const orch = new Orchestrator(REGISTRABLES);
    const tool = new ExploreDataset(
      orch,
      {
        queries: [
          { connection: 'mongo_db', query: JSON.stringify({ collection: 'sales', pipeline: [{ $group: { _id: '$id' } }] }), label: 'revenue' },
          { connection: 'mongo_db', query: JSON.stringify({ collection: 'biz', pipeline: [{ $match: { id: { $in: '$revenue.id' } } }] }), label: 'biz' },
        ],
        prompt: 'join them',
      },
      CTX,
      'test-mongo-ref',
    );

    const result = await tool.run();

    expect(result.isError).toBe(false);
    const secondQuery = mockQuery.mock.calls[1][0] as string;
    // "$revenue.id" → [10,20,30] (a real JSON array — the query is still valid JSON)
    expect(JSON.parse(secondQuery).pipeline[0].$match.id.$in).toEqual([10, 20, 30]);
    expect(secondQuery).not.toContain('$revenue.id');
  });

  it('rejects a pipeline whose terminal $limit is below 1000', async () => {
    const orch = new Orchestrator(REGISTRABLES);
    const tool = new ExploreDataset(
      orch,
      {
        queries: [{
          connection: 'mongo_db',
          query: JSON.stringify({ collection: 'biz', pipeline: [{ $sort: { n: -1 } }, { $limit: 50 }] }),
          label: 'top',
        }],
        prompt: 'x',
      },
      CTX,
      'test-mongo-lowlimit',
    );

    const result = await tool.run();

    expect(result.isError).toBe(true);
    const content = JSON.parse((result.content[0] as TextContent).text);
    expect(content.error).toMatch(/too low/i);
  });
});
