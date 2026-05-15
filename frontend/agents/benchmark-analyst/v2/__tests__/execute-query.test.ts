// Tests for ExecuteQueryV2: QuerySpec[], cross-connection, sequential labels, handles-as-tables
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { fauxAssistantMessage, type TextContent, registerFauxProvider } from '@mariozechner/pi-ai';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { BenchmarkAnalystContext } from '../../types';
import { ExecuteQueryV2, setInfoModel } from '../execute-query';
import { storeHandle, clearHandles, fetchHandle } from '../handle-store';
import type { QueryResult } from '@/lib/connections/base';

const fauxReg = registerFauxProvider({
  api: 'faux-exec-api',
  provider: 'faux-exec',
  models: [{ id: 'stub-exec' }],
});

const mockQuery = vi.fn(async (): Promise<QueryResult> => ({
  columns: ['id', 'name'],
  types: ['INTEGER', 'VARCHAR'],
  rows: [{ id: 1, name: 'Test' }],
  finalQuery: '',
}));

// Partial mock: only the connector factory is faked — the handle-table
// helpers stay real so `storeHandle` / `clearHandles` exercise the real
// shared DuckDB instance. (Real `FROM handle_xyz` joins against live data are
// covered by execute-query.handle-tables.test.ts, which uses a real connector.)
vi.mock('../../shared-duckdb', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../shared-duckdb')>()),
  getOrCreateBenchmarkConnector: vi.fn(async () => ({
    query: mockQuery,
    getSchema: vi.fn(async () => []),
  })),
}));

const CTX: BenchmarkAnalystContext = {
  connections: [
    { name: 'orders_db', dialect: 'duckdb', description: 'Orders', config: { file_path: '/orders.duckdb' } },
    { name: 'products_db', dialect: 'sqlite', description: 'Products', config: { file_path: '/products.db' } },
  ],
  contextDocs: '',
};

describe('ExecuteQueryV2', () => {
  beforeAll(() => {
    setInfoModel(fauxReg.getModel());
  });

  beforeEach(async () => {
    await clearHandles();
    mockQuery.mockClear();
    fauxReg.setResponses([]);
  });

  describe('basic execution', () => {
    it('executes a single query and returns handle + preview + stats', async () => {
      const orch = new Orchestrator([ExecuteQueryV2]);
      const tool = new ExecuteQueryV2(
        orch,
        {
          queries: [
            { connection: 'orders_db', query: 'SELECT * FROM orders LIMIT 100' },
          ],
        },
        CTX,
        'test-single',
      );

      const response = await tool.run();

      expect(response.isError).toBe(false);
      const content = JSON.parse((response.content[0] as TextContent).text);
      expect(content.results).toHaveLength(1);
      expect(content.results[0].handle).toMatch(/^handle_/);
      expect(content.results[0].preview).toBeDefined();
      expect(content.results[0].stats).toBeDefined();
    });

    it('stores results as handles that can be fetched', async () => {
      const orch = new Orchestrator([ExecuteQueryV2]);
      const tool = new ExecuteQueryV2(
        orch,
        {
          queries: [
            { connection: 'orders_db', query: 'SELECT * FROM orders' },
          ],
        },
        CTX,
        'test-store',
      );

      const response = await tool.run();
      const content = JSON.parse((response.content[0] as TextContent).text);
      const handle = content.results[0].handle;

      const stored = fetchHandle(handle);
      expect(stored).toBeDefined();
      expect(stored?.rows).toBeDefined();
    });
  });

  describe('cross-connection queries', () => {
    it('executes queries across different connections', async () => {
      mockQuery
        .mockResolvedValueOnce({
          columns: ['product_id', 'revenue'],
          types: ['INT', 'DECIMAL'],
          rows: [{ product_id: 100, revenue: 500 }],
          finalQuery: '',
        })
        .mockResolvedValueOnce({
          columns: ['id', 'name'],
          types: ['INT', 'VARCHAR'],
          rows: [{ id: 100, name: 'Widget' }],
          finalQuery: '',
        });

      const orch = new Orchestrator([ExecuteQueryV2]);
      const tool = new ExecuteQueryV2(
        orch,
        {
          queries: [
            { connection: 'orders_db', query: 'SELECT product_id, SUM(amount) as revenue FROM orders GROUP BY product_id', label: 'revenue' },
            { connection: 'products_db', query: 'SELECT id, name FROM products', label: 'products' },
          ],
        },
        CTX,
        'test-cross',
      );

      const response = await tool.run();

      expect(response.isError).toBe(false);
      const content = JSON.parse((response.content[0] as TextContent).text);
      expect(content.results).toHaveLength(2);
    });
  });

  describe('sequential mode with label interpolation', () => {
    it('interpolates $label.column in sequential queries', async () => {
      mockQuery
        .mockResolvedValueOnce({
          columns: ['id'],
          types: ['INTEGER'],
          rows: [{ id: 10 }, { id: 20 }, { id: 30 }],
          finalQuery: '',
        })
        .mockResolvedValueOnce({
          columns: ['id', 'name'],
          types: ['INT', 'VARCHAR'],
          rows: [{ id: 10, name: 'A' }, { id: 20, name: 'B' }],
          finalQuery: '',
        });

      const orch = new Orchestrator([ExecuteQueryV2]);
      const tool = new ExecuteQueryV2(
        orch,
        {
          queries: [
            { connection: 'orders_db', query: 'SELECT id FROM orders', label: 'top_orders' },
            { connection: 'products_db', query: 'SELECT id, name FROM products WHERE id IN ($top_orders.id)', label: 'details' },
          ],
          sequential: true,
        },
        CTX,
        'test-seq-interp',
      );

      const response = await tool.run();

      expect(response.isError).toBe(false);
      expect(mockQuery.mock.calls.length).toBeGreaterThan(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const secondCall = (mockQuery.mock.calls as any)[1]?.[0] as string;
      expect(secondCall).toContain('10, 20, 30');
      expect(secondCall).not.toContain('$top_orders.id');
    });

    it('validates 2nd+ queries must reference earlier results in sequential mode', async () => {
      const orch = new Orchestrator([ExecuteQueryV2]);
      const tool = new ExecuteQueryV2(
        orch,
        {
          queries: [
            { connection: 'orders_db', query: 'SELECT * FROM orders', label: 'a' },
            { connection: 'products_db', query: 'SELECT * FROM products', label: 'b' },
          ],
          sequential: true,
        },
        CTX,
        'test-seq-validate',
      );

      const response = await tool.run();

      // Per-query validation error is returned in the result slot, not as top-level error
      expect(response.isError).toBe(false);
      const content = JSON.parse((response.content[0] as TextContent).text);
      expect(content.results[1].error).toContain('reference');
    });
  });

  // Real `FROM handle_xyz` join coverage lives in
  // execute-query.handle-tables.test.ts — that test uses a real sqlite
  // connector so the handle actually resolves as a table. A mocked connector
  // here can't verify it (mockQuery ignores the SQL).

  describe('per-query errors', () => {
    it('returns error in result slot without failing entire batch', async () => {
      mockQuery
        .mockResolvedValueOnce({
          columns: ['id'],
          types: ['INT'],
          rows: [{ id: 1 }],
          finalQuery: '',
        })
        .mockRejectedValueOnce(new Error('Syntax error'))
        .mockResolvedValueOnce({
          columns: ['id'],
          types: ['INT'],
          rows: [{ id: 2 }],
          finalQuery: '',
        });

      const orch = new Orchestrator([ExecuteQueryV2]);
      const tool = new ExecuteQueryV2(
        orch,
        {
          queries: [
            { connection: 'orders_db', query: 'SELECT 1' },
            { connection: 'orders_db', query: 'INVALID SQL' },
            { connection: 'orders_db', query: 'SELECT 2' },
          ],
        },
        CTX,
        'test-per-error',
      );

      const response = await tool.run();

      expect(response.isError).toBe(false);
      const content = JSON.parse((response.content[0] as TextContent).text);
      expect(content.results).toHaveLength(3);
      expect(content.results[0].handle).toBeDefined();
      expect(content.results[1].error).toContain('Syntax error');
      expect(content.results[2].handle).toBeDefined();
    });
  });

  describe('prompt parameter', () => {
    it('calls LLM across all results when prompt is provided', async () => {
      fauxReg.setResponses([
        fauxAssistantMessage('Summary: 2 results found.', { stopReason: 'stop' }),
      ]);

      mockQuery.mockResolvedValue({
        columns: ['id'],
        types: ['INT'],
        rows: [{ id: 1 }],
        finalQuery: '',
      });

      const orch = new Orchestrator([ExecuteQueryV2]);
      const tool = new ExecuteQueryV2(
        orch,
        {
          queries: [
            { connection: 'orders_db', query: 'SELECT 1', label: 'a' },
            { connection: 'orders_db', query: 'SELECT 2', label: 'b' },
          ],
          prompt: 'Summarize both result sets.',
        },
        CTX,
        'test-prompt-all',
      );

      const response = await tool.run();

      expect(response.isError).toBe(false);
      const content = JSON.parse((response.content[0] as TextContent).text);
      expect(content.info).toBe('Summary: 2 results found.');
    });

    it('re-ranks each preview when the prompt model returns rerankedIds', async () => {
      mockQuery.mockResolvedValue({
        columns: ['name'],
        types: ['VARCHAR'],
        rows: [{ name: 'alpha' }, { name: 'beta' }, { name: 'gamma' }],
        finalQuery: '',
      });
      fauxReg.setResponses([
        fauxAssistantMessage(
          '{"results":[{"rerankedIds":["r2","r0","r1"]}],"info":"ranked by relevance"}',
          { stopReason: 'stop' },
        ),
      ]);

      const orch = new Orchestrator([ExecuteQueryV2]);
      const tool = new ExecuteQueryV2(
        orch,
        {
          queries: [{ connection: 'orders_db', query: 'SELECT name FROM t', label: 'q' }],
          prompt: 'rank them',
        },
        CTX,
        'test-prompt-rerank',
      );

      const response = await tool.run();
      const content = JSON.parse((response.content[0] as TextContent).text);

      expect(content.info).toBe('ranked by relevance');
      const preview = content.results[0].preview as string;
      // Order in the preview reflects the model's rerankedIds [r2, r0, r1].
      expect(preview.indexOf('gamma')).toBeLessThan(preview.indexOf('alpha'));
      expect(preview.indexOf('alpha')).toBeLessThan(preview.indexOf('beta'));
    });
  });

  describe('connection validation', () => {
    it('returns error for unknown connection', async () => {
      const orch = new Orchestrator([ExecuteQueryV2]);
      const tool = new ExecuteQueryV2(
        orch,
        {
          queries: [
            { connection: 'unknown_db', query: 'SELECT 1' },
          ],
        },
        CTX,
        'test-bad-conn',
      );

      const response = await tool.run();

      expect(response.isError).toBe(false);
      const content = JSON.parse((response.content[0] as TextContent).text);
      expect(content.results[0].error).toContain('not found');
    });
  });

  describe('schema', () => {
    it('has correct schema name', () => {
      expect(ExecuteQueryV2.schema.name).toBe('ExecuteQuery');
    });

    it('schema mentions QuerySpec, sequential, and handle references', () => {
      const desc = ExecuteQueryV2.schema.description;
      expect(desc).toContain('sequential');
      expect(desc).toContain('handle');
    });
  });
});
