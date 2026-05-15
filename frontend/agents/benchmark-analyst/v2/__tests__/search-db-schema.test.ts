// Tests for SearchDBSchemaV2: SQL queries against the synthetic catalog
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { fauxAssistantMessage, type TextContent, registerFauxProvider } from '@mariozechner/pi-ai';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { BenchmarkAnalystContext } from '../../types';
import { SearchDBSchemaV2, clearCatalogCache } from '../search-db-schema';
import { setLighterModel } from '../data-tool-base';
import { clearHandles } from '../handle-store';

const fauxReg = registerFauxProvider({
  api: 'faux-v2-api',
  provider: 'faux-v2',
  models: [{ id: 'stub-v2' }],
});

// Partial mock: only the connector factory is faked — the handle-table
// helpers stay real so `storeHandle` / `clearHandles` exercise the real
// shared DuckDB instance.
vi.mock('../../shared-duckdb', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../shared-duckdb')>()),
  getOrCreateBenchmarkConnector: vi.fn(async () => ({
    getSchema: vi.fn(async () => [
      {
        schema: 'public',
        tables: [
          {
            table: 'users',
            columns: [
              { name: 'id', type: 'INTEGER', meta: { category: 'numeric' } },
              { name: 'email', type: 'VARCHAR', meta: { category: 'text' } },
            ],
            indexes: [{ name: 'users_pkey', columns: ['id'], unique: true }],
          },
          {
            table: 'orders',
            columns: [
              { name: 'id', type: 'INTEGER' },
              { name: 'user_id', type: 'INTEGER' },
              { name: 'amount', type: 'DECIMAL', meta: { min: 10, max: 1000 } },
            ],
          },
        ],
      },
    ]),
    query: vi.fn(async () => ({ columns: [], types: [], rows: [] })),
  })),
}));

const CTX: BenchmarkAnalystContext = {
  connections: [
    { name: 'main_db', dialect: 'duckdb', description: 'Main database', config: { file_path: '/test.duckdb' } },
  ],
  contextDocs: '',
};

describe('SearchDBSchemaV2', () => {
  beforeAll(() => {
    setLighterModel(fauxReg.getModel());
  });

  beforeEach(async () => {
    await clearHandles();
    clearCatalogCache();
    fauxReg.setResponses([]);
  });

  describe('basic catalog queries', () => {
    it('returns results for a simple SELECT on connections', async () => {
      const orch = new Orchestrator([SearchDBSchemaV2]);
      const tool = new SearchDBSchemaV2(
        orch,
        {
          queries: [{ query: 'SELECT * FROM connections' }],
        },
        CTX,
        'test-connections',
      );

      const response = await tool.run();

      expect(response.isError).toBe(false);
      const content = JSON.parse((response.content[0] as TextContent).text);
      expect(content.results).toHaveLength(1);
      expect(content.results[0].handle).toMatch(/^handle_/);
      expect(content.results[0].preview).toBeDefined();
      expect(content.results[0].stats.rowCount).toBeGreaterThanOrEqual(1);
    });

    it('queries the tables catalog', async () => {
      const orch = new Orchestrator([SearchDBSchemaV2]);
      const tool = new SearchDBSchemaV2(
        orch,
        {
          queries: [{ query: "SELECT * FROM tables WHERE table_name = 'users'" }],
        },
        CTX,
        'test-tables',
      );

      const response = await tool.run();

      expect(response.isError).toBe(false);
      const content = JSON.parse((response.content[0] as TextContent).text);
      expect(content.results[0].stats.rowCount).toBeGreaterThanOrEqual(1);
    });

    it('queries the columns catalog with filtering', async () => {
      const orch = new Orchestrator([SearchDBSchemaV2]);
      const tool = new SearchDBSchemaV2(
        orch,
        {
          queries: [
            { query: "SELECT column_name, data_type FROM columns WHERE table_name = 'users'" },
          ],
        },
        CTX,
        'test-columns',
      );

      const response = await tool.run();

      expect(response.isError).toBe(false);
      const content = JSON.parse((response.content[0] as TextContent).text);
      expect(content.results).toHaveLength(1);
    });

    it('queries the indexes catalog', async () => {
      const orch = new Orchestrator([SearchDBSchemaV2]);
      const tool = new SearchDBSchemaV2(
        orch,
        {
          queries: [{ query: 'SELECT * FROM indexes' }],
        },
        CTX,
        'test-indexes',
      );

      const response = await tool.run();

      expect(response.isError).toBe(false);
    });

    it('queries the column_stats catalog', async () => {
      const orch = new Orchestrator([SearchDBSchemaV2]);
      const tool = new SearchDBSchemaV2(
        orch,
        {
          queries: [
            { query: "SELECT * FROM column_stats WHERE column_name = 'amount'" },
          ],
        },
        CTX,
        'test-stats',
      );

      const response = await tool.run();

      expect(response.isError).toBe(false);
    });
  });

  describe('multi-query batches', () => {
    it('executes multiple queries and returns results for each', async () => {
      const orch = new Orchestrator([SearchDBSchemaV2]);
      const tool = new SearchDBSchemaV2(
        orch,
        {
          queries: [
            { query: 'SELECT * FROM connections', label: 'conns' },
            { query: 'SELECT * FROM tables', label: 'tbls' },
          ],
        },
        CTX,
        'test-multi',
      );

      const response = await tool.run();

      expect(response.isError).toBe(false);
      const content = JSON.parse((response.content[0] as TextContent).text);
      expect(content.results).toHaveLength(2);
      expect(content.results[0].handle).toBeDefined();
      expect(content.results[1].handle).toBeDefined();
    });

    it('handles per-query errors without failing the batch', async () => {
      const orch = new Orchestrator([SearchDBSchemaV2]);
      const tool = new SearchDBSchemaV2(
        orch,
        {
          queries: [
            { query: 'SELECT * FROM connections' },
            { query: 'SELECT * FROM nonexistent_table' },
            { query: 'SELECT * FROM tables' },
          ],
        },
        CTX,
        'test-partial-error',
      );

      const response = await tool.run();

      expect(response.isError).toBe(false);
      const content = JSON.parse((response.content[0] as TextContent).text);
      expect(content.results).toHaveLength(3);
      expect(content.results[0].handle).toBeDefined();
      expect(content.results[1].error).toBeDefined();
      expect(content.results[2].handle).toBeDefined();
    });
  });

  describe('prompt parameter', () => {
    it('calls LLM and includes info when prompt is provided', async () => {
      const infoText = 'The database has 2 tables: users and orders.';
      fauxReg.setResponses([
        fauxAssistantMessage(infoText, { stopReason: 'stop' }),
      ]);

      const orch = new Orchestrator([SearchDBSchemaV2]);
      const tool = new SearchDBSchemaV2(
        orch,
        {
          queries: [{ query: 'SELECT * FROM tables' }],
          prompt: 'Summarize the table structure.',
        },
        CTX,
        'test-prompt',
      );

      const response = await tool.run();

      expect(response.isError).toBe(false);
      const content = JSON.parse((response.content[0] as TextContent).text);
      expect(content.info).toBe(infoText);
    });

    it('re-ranks the catalog-result preview when the prompt model returns rerankedIds', async () => {
      // The mock schema has 2 tables (users, orders). `SELECT * FROM tables
      // ORDER BY table_name` gives deterministic row order: [orders, users].
      // rerankedIds [r1, r0] → preview rows in [users, orders] order.
      fauxReg.setResponses([
        fauxAssistantMessage(
          '{"results":[{"rerankedIds":["r1","r0"]}],"info":"users first"}',
          { stopReason: 'stop' },
        ),
      ]);

      const orch = new Orchestrator([SearchDBSchemaV2]);
      const tool = new SearchDBSchemaV2(
        orch,
        {
          queries: [{ query: 'SELECT table_name FROM tables ORDER BY table_name' }],
          prompt: 'rank by interest',
        },
        CTX,
        'test-prompt-rerank',
      );

      const response = await tool.run();
      const content = JSON.parse((response.content[0] as TextContent).text);

      expect(content.info).toBe('users first');
      const preview = content.results[0].preview as string;
      expect(preview.indexOf('users')).toBeLessThan(preview.indexOf('orders'));
    });

    it('omits info when no prompt is provided', async () => {
      const orch = new Orchestrator([SearchDBSchemaV2]);
      const tool = new SearchDBSchemaV2(
        orch,
        {
          queries: [{ query: 'SELECT * FROM tables' }],
        },
        CTX,
        'test-no-prompt',
      );

      const response = await tool.run();

      expect(response.isError).toBe(false);
      const content = JSON.parse((response.content[0] as TextContent).text);
      expect(content.info).toBeUndefined();
    });
  });

  describe('sequential mode', () => {
    it('runs queries sequentially when sequential=true', async () => {
      const orch = new Orchestrator([SearchDBSchemaV2]);
      const tool = new SearchDBSchemaV2(
        orch,
        {
          queries: [
            { query: 'SELECT * FROM tables', label: 'tbls' },
            { query: "SELECT * FROM columns WHERE table_name IN (SELECT table_name FROM tables WHERE connection_name = 'main_db')", label: 'cols' },
          ],
          sequential: true,
        },
        CTX,
        'test-sequential',
      );

      const response = await tool.run();

      expect(response.isError).toBe(false);
      const content = JSON.parse((response.content[0] as TextContent).text);
      expect(content.results).toHaveLength(2);
    });
  });

  describe('schema validation', () => {
    it('has correct schema name', () => {
      expect(SearchDBSchemaV2.schema.name).toBe('SearchDBSchema');
    });

    it('schema description mentions catalog tables', () => {
      const desc = SearchDBSchemaV2.schema.description;
      expect(desc).toContain('connections');
      expect(desc).toContain('tables');
      expect(desc).toContain('columns');
    });
  });
});
