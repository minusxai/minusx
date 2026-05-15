// Tests for Explore tool: cross-table discovery search
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { fauxAssistantMessage, type TextContent, registerFauxProvider } from '@mariozechner/pi-ai';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { BenchmarkAnalystContext } from '../../types';
import { ExploreV2, setExploreModel } from '../explore';
import { clearHandles } from '../handle-store';
import type { QueryResult } from '@/lib/connections/base';

const fauxReg = registerFauxProvider({
  api: 'faux-explore-api',
  provider: 'faux-explore',
  models: [{ id: 'stub-explore' }],
});

const mockQuery = vi.fn(async (): Promise<QueryResult> => ({
  columns: ['id', 'text', 'source', 'score'],
  types: ['INTEGER', 'VARCHAR', 'VARCHAR', 'DOUBLE'],
  rows: [
    { id: 1, text: 'solar energy systems', source: 'products.description', score: 0.95 },
    { id: 2, text: 'renewable solar panels', source: 'products.description', score: 0.90 },
  ],
  finalQuery: '',
}));

vi.mock('../../shared-duckdb', () => ({
  getOrCreateBenchmarkConnector: vi.fn(async () => ({
    query: mockQuery,
    getSchema: vi.fn(async () => [
      {
        schema: 'public',
        tables: [
          {
            table: 'products',
            columns: [
              { name: 'id', type: 'INTEGER' },
              { name: 'name', type: 'VARCHAR' },
              { name: 'description', type: 'TEXT' },
            ],
          },
          {
            table: 'categories',
            columns: [
              { name: 'id', type: 'INTEGER' },
              { name: 'label', type: 'VARCHAR' },
            ],
          },
        ],
      },
    ]),
  })),
}));

const CTX: BenchmarkAnalystContext = {
  connections: [
    { name: 'main_db', dialect: 'duckdb', description: 'Main', config: { file_path: '/main.duckdb' } },
    { name: 'catalog_db', dialect: 'sqlite', description: 'Catalog', config: { file_path: '/catalog.db' } },
  ],
  contextDocs: '',
};

describe('ExploreV2', () => {
  beforeAll(() => {
    setExploreModel(fauxReg.getModel());
  });

  beforeEach(async () => {
    await clearHandles();
    mockQuery.mockClear();
    fauxReg.setResponses([]);
  });

  describe('filter scoping', () => {
    it('searches all connections when no filter specified', async () => {
      const orch = new Orchestrator([ExploreV2]);
      const tool = new ExploreV2(
        orch,
        {
          filter: { match: 'solar' },
        },
        CTX,
        'test-all-conn',
      );

      const response = await tool.run();

      expect(response.isError).toBe(false);
      const content = JSON.parse((response.content[0] as TextContent).text);
      expect(content.results).toBeDefined();
    });

    it('filters to specific connection when provided', async () => {
      const orch = new Orchestrator([ExploreV2]);
      const tool = new ExploreV2(
        orch,
        {
          filter: { connection: 'main_db', match: 'solar' },
        },
        CTX,
        'test-conn-filter',
      );

      const response = await tool.run();

      expect(response.isError).toBe(false);
    });

    it('filters to specific schema when provided', async () => {
      const orch = new Orchestrator([ExploreV2]);
      const tool = new ExploreV2(
        orch,
        {
          filter: { schema: 'public', match: 'energy' },
        },
        CTX,
        'test-schema-filter',
      );

      const response = await tool.run();

      expect(response.isError).toBe(false);
    });

    it('filters to specific table when provided', async () => {
      const orch = new Orchestrator([ExploreV2]);
      const tool = new ExploreV2(
        orch,
        {
          filter: { table: 'products', match: 'panel' },
        },
        CTX,
        'test-table-filter',
      );

      const response = await tool.run();

      expect(response.isError).toBe(false);
    });

    it('filters to specific columns when provided', async () => {
      const orch = new Orchestrator([ExploreV2]);
      const tool = new ExploreV2(
        orch,
        {
          filter: { columns: ['description', 'name'], match: 'renewable' },
        },
        CTX,
        'test-cols-filter',
      );

      const response = await tool.run();

      expect(response.isError).toBe(false);
    });
  });

  describe('lexical match', () => {
    it('runs lexical/fuzzy match on text columns', async () => {
      mockQuery.mockResolvedValueOnce({
        columns: ['id', 'matched_text', 'source', 'score'],
        types: ['INT', 'VARCHAR', 'VARCHAR', 'DOUBLE'],
        rows: [
          { id: 1, matched_text: 'solar power', source: 'products.name', score: 1.0 },
          { id: 2, matched_text: 'SolarMax Inc', source: 'products.name', score: 0.8 },
        ],
        finalQuery: '',
      });

      const orch = new Orchestrator([ExploreV2]);
      const tool = new ExploreV2(
        orch,
        {
          filter: { match: 'solar' },
        },
        CTX,
        'test-lexical',
      );

      const response = await tool.run();

      expect(response.isError).toBe(false);
      const content = JSON.parse((response.content[0] as TextContent).text);
      expect(content.results[0].preview).toBeDefined();
    });

    it('includes source and score columns in results', async () => {
      mockQuery.mockResolvedValueOnce({
        columns: ['id', 'matched_text', 'source', 'score'],
        types: ['INT', 'VARCHAR', 'VARCHAR', 'DOUBLE'],
        rows: [
          { id: 1, matched_text: 'test', source: 'table.column', score: 0.95 },
        ],
        finalQuery: '',
      });

      const orch = new Orchestrator([ExploreV2]);
      const tool = new ExploreV2(
        orch,
        {
          filter: { match: 'test' },
        },
        CTX,
        'test-source-score',
      );

      const response = await tool.run();

      expect(response.isError).toBe(false);
      const content = JSON.parse((response.content[0] as TextContent).text);
      expect(content.results[0].stats.columns.source).toBeDefined();
      expect(content.results[0].stats.columns.score).toBeDefined();
    });
  });

  describe('prompt re-ranking', () => {
    it('performs semantic re-ranking when prompt is provided', async () => {
      fauxReg.setResponses([
        fauxAssistantMessage('Re-ranked results: id 2 is most relevant.', { stopReason: 'stop' }),
      ]);

      const orch = new Orchestrator([ExploreV2]);
      const tool = new ExploreV2(
        orch,
        {
          filter: { match: 'energy' },
          prompt: 'Rank by relevance to renewable energy products.',
        },
        CTX,
        'test-rerank',
      );

      const response = await tool.run();

      expect(response.isError).toBe(false);
      const content = JSON.parse((response.content[0] as TextContent).text);
      expect(content.info).toContain('Re-ranked');
    });

    it('skips LLM call when no prompt provided', async () => {
      const orch = new Orchestrator([ExploreV2]);
      const callLLMSpy = vi.spyOn(orch, 'callLLM');

      const tool = new ExploreV2(
        orch,
        {
          filter: { match: 'test' },
        },
        CTX,
        'test-no-prompt',
      );

      await tool.run();

      expect(callLLMSpy).not.toHaveBeenCalled();
      callLLMSpy.mockRestore();
    });
  });

  describe('result format', () => {
    it('returns {results, info?} shape', async () => {
      const orch = new Orchestrator([ExploreV2]);
      const tool = new ExploreV2(
        orch,
        {
          filter: { match: 'test' },
        },
        CTX,
        'test-shape',
      );

      const response = await tool.run();

      expect(response.isError).toBe(false);
      const content = JSON.parse((response.content[0] as TextContent).text);
      expect(Array.isArray(content.results)).toBe(true);
      expect(content.results[0]).toHaveProperty('preview');
      expect(content.results[0]).toHaveProperty('handle');
      expect(content.results[0]).toHaveProperty('stats');
    });

    it('stores results as handles', async () => {
      const orch = new Orchestrator([ExploreV2]);
      const tool = new ExploreV2(
        orch,
        {
          filter: { match: 'test' },
        },
        CTX,
        'test-handle',
      );

      const response = await tool.run();

      const content = JSON.parse((response.content[0] as TextContent).text);
      expect(content.results[0].handle).toMatch(/^handle_/);
    });
  });

  describe('error handling', () => {
    it('returns error for invalid connection in filter', async () => {
      const orch = new Orchestrator([ExploreV2]);
      const tool = new ExploreV2(
        orch,
        {
          filter: { connection: 'nonexistent', match: 'test' },
        },
        CTX,
        'test-bad-conn',
      );

      const response = await tool.run();

      expect(response.isError).toBe(true);
      const content = JSON.parse((response.content[0] as TextContent).text);
      expect(content.error).toContain('not found');
    });

    it('returns empty results for no matches', async () => {
      // Mock returns empty rows for all query calls (there may be multiple for each text column)
      mockQuery.mockResolvedValue({
        columns: ['id', 'matched_text', 'source', 'score'],
        types: ['VARCHAR', 'VARCHAR', 'VARCHAR', 'DOUBLE'],
        rows: [],
        finalQuery: '',
      });

      const orch = new Orchestrator([ExploreV2]);
      const tool = new ExploreV2(
        orch,
        {
          filter: { match: 'xyznonexistent' },
        },
        CTX,
        'test-no-match',
      );

      const response = await tool.run();

      expect(response.isError).toBe(false);
      const content = JSON.parse((response.content[0] as TextContent).text);
      expect(content.results[0].stats.rowCount).toBe(0);
    });
  });

  describe('schema', () => {
    it('has correct schema name', () => {
      expect(ExploreV2.schema.name).toBe('Explore');
    });

    it('describes when to use it vs ExecuteQuery', () => {
      const desc = ExploreV2.schema.description;
      expect(desc).toContain('discovery');
    });
  });
});
