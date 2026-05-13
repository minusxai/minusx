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
  FuzzySearch,
} from '../db-tools';
import { ExploreDataset, setExploreModel } from '../explore-dataset';
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
const mockQuery = vi.fn(async () => defaultRows());

vi.mock('../shared-duckdb', () => ({
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
  FuzzySearch,
  ExploreDataset,
];

const CTX: BenchmarkAnalystContext = {
  connections: [
    { name: 'orders_db', dialect: 'duckdb', description: 'orders', config: { file_path: '/test/orders.duckdb' } },
    { name: 'products_db', dialect: 'sqlite', description: 'products', config: { file_path: '/test/products.db' } },
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
