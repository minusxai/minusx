// Tests for fetchHandle tool: pagination over stored results
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fauxAssistantMessage, type TextContent } from '@mariozechner/pi-ai';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { BenchmarkAnalystContext } from '../../types';
import { FetchHandleV2 } from '../fetch-handle';
import { storeHandle, clearHandles } from '../handle-store';
import type { QueryResult } from '@/lib/connections/base';

const CTX: BenchmarkAnalystContext = {
  connections: [],
  contextDocs: '',
};

describe('FetchHandleV2', () => {
  beforeEach(async () => {
    await clearHandles();
  });

  describe('basic pagination', () => {
    it('returns rows from offset to offset+length', async () => {
      const result: QueryResult = {
        columns: ['id', 'value'],
        types: ['INTEGER', 'DOUBLE'],
        rows: Array.from({ length: 100 }, (_, i) => ({ id: i, value: i * 10 })),
        finalQuery: '',
      };
      const { handleId: handle } = await storeHandle(result);

      const orch = new Orchestrator([FetchHandleV2]);
      const tool = new FetchHandleV2(
        orch,
        { handle, offset: 10, length: 5 },
        CTX,
        'test-pagination',
      );

      const response = await tool.run();

      expect(response.isError).toBe(false);
      const content = JSON.parse((response.content[0] as TextContent).text);
      expect(content.preview).toBeDefined();
      expect(content.stats.rowCount).toBe(100);
      expect(content.stats.previewCount).toBe(5);
    });

    it('defaults offset to 0 and length to 100', async () => {
      const result: QueryResult = {
        columns: ['id'],
        types: ['INT'],
        rows: Array.from({ length: 200 }, (_, i) => ({ id: i })),
        finalQuery: '',
      };
      const { handleId: handle } = await storeHandle(result);

      const orch = new Orchestrator([FetchHandleV2]);
      const tool = new FetchHandleV2(
        orch,
        { handle },
        CTX,
        'test-defaults',
      );

      const response = await tool.run();

      expect(response.isError).toBe(false);
      const content = JSON.parse((response.content[0] as TextContent).text);
      expect(content.stats.previewCount).toBe(100);
    });

    it('clamps to available rows if offset+length exceeds rowCount', async () => {
      const result: QueryResult = {
        columns: ['id'],
        types: ['INT'],
        rows: [{ id: 1 }, { id: 2 }, { id: 3 }],
        finalQuery: '',
      };
      const { handleId: handle } = await storeHandle(result);

      const orch = new Orchestrator([FetchHandleV2]);
      const tool = new FetchHandleV2(
        orch,
        { handle, offset: 1, length: 100 },
        CTX,
        'test-clamp',
      );

      const response = await tool.run();

      expect(response.isError).toBe(false);
      const content = JSON.parse((response.content[0] as TextContent).text);
      expect(content.stats.previewCount).toBe(2);
    });

    it('returns empty preview when offset >= rowCount', async () => {
      const result: QueryResult = {
        columns: ['id'],
        types: ['INT'],
        rows: [{ id: 1 }],
        finalQuery: '',
      };
      const { handleId: handle } = await storeHandle(result);

      const orch = new Orchestrator([FetchHandleV2]);
      const tool = new FetchHandleV2(
        orch,
        { handle, offset: 100, length: 10 },
        CTX,
        'test-empty',
      );

      const response = await tool.run();

      expect(response.isError).toBe(false);
      const content = JSON.parse((response.content[0] as TextContent).text);
      expect(content.stats.previewCount).toBe(0);
    });
  });

  describe('stats inclusion', () => {
    it('includes column-level stats in the response', async () => {
      const result: QueryResult = {
        columns: ['value', 'category'],
        types: ['INTEGER', 'VARCHAR'],
        rows: [
          { value: 10, category: 'A' },
          { value: 20, category: 'A' },
          { value: 30, category: 'B' },
        ],
        finalQuery: '',
      };
      const { handleId: handle } = await storeHandle(result);

      const orch = new Orchestrator([FetchHandleV2]);
      const tool = new FetchHandleV2(
        orch,
        { handle },
        CTX,
        'test-stats',
      );

      const response = await tool.run();

      expect(response.isError).toBe(false);
      const content = JSON.parse((response.content[0] as TextContent).text);

      expect(content.stats.columns.value.min).toBe(10);
      expect(content.stats.columns.value.max).toBe(30);
      expect(content.stats.columns.category.nDistinct).toBe(2);
    });
  });

  describe('error handling', () => {
    it('returns error for unknown handle', async () => {
      const orch = new Orchestrator([FetchHandleV2]);
      const tool = new FetchHandleV2(
        orch,
        { handle: 'handle_unknown' },
        CTX,
        'test-bad-handle',
      );

      const response = await tool.run();

      expect(response.isError).toBe(true);
      const content = JSON.parse((response.content[0] as TextContent).text);
      expect(content.error).toContain('not found');
    });

    it('returns error for negative offset', async () => {
      const result: QueryResult = {
        columns: ['id'],
        types: ['INT'],
        rows: [{ id: 1 }],
        finalQuery: '',
      };
      const { handleId: handle } = await storeHandle(result);

      const orch = new Orchestrator([FetchHandleV2]);
      const tool = new FetchHandleV2(
        orch,
        { handle, offset: -5 },
        CTX,
        'test-bad-offset',
      );

      const response = await tool.run();

      expect(response.isError).toBe(true);
      const content = JSON.parse((response.content[0] as TextContent).text);
      expect(content.error).toContain('offset');
    });

    it('returns error for zero or negative length', async () => {
      const result: QueryResult = {
        columns: ['id'],
        types: ['INT'],
        rows: [{ id: 1 }],
        finalQuery: '',
      };
      const { handleId: handle } = await storeHandle(result);

      const orch = new Orchestrator([FetchHandleV2]);
      const tool = new FetchHandleV2(
        orch,
        { handle, length: 0 },
        CTX,
        'test-bad-length',
      );

      const response = await tool.run();

      expect(response.isError).toBe(true);
      const content = JSON.parse((response.content[0] as TextContent).text);
      expect(content.error).toContain('length');
    });
  });

  describe('schema validation', () => {
    it('has correct schema name and description', () => {
      expect(FetchHandleV2.schema.name).toBe('fetchHandle');
      expect(FetchHandleV2.schema.description).toContain('pagination');
    });
  });
});
