import { Orchestrator } from '@/orchestrator/orchestrator';
import type { AnalystAgentContext } from '../types';
import {
  ExecuteQuery,
  SearchDBSchema,
} from '../analyst-agent';
import {
  resetSources,
  setSchemaSource,
  setSqlExecutor,
  type SchemaHit,
} from '../sources';

const ctx: AnalystAgentContext = { userId: 'u', mode: 'org' };

describe('SearchDBSchema', () => {
  beforeEach(() => resetSources());

  it('returns structured {success, queryType, tableCount, results} on keyword match', async () => {
    const hits: SchemaHit[] = [
      { table: 'users', columns: [{ name: 'id', type: 'int' }, { name: 'created_at', type: 'timestamp' }] },
    ];
    setSchemaSource({ search: async () => hits });

    const orch = new Orchestrator([]);
    const tool = new SearchDBSchema(orch, { connection: 'main', query: 'users' }, ctx);
    const res = await tool.run();

    expect(res.isError).toBe(false);
    expect(res.content[0]).toMatchObject({ type: 'text' });
    const parsed = JSON.parse((res.content[0] as { text: string }).text);
    expect(parsed).toMatchObject({
      success: true,
      queryType: 'string',
      tableCount: hits.length,
      results: hits,
    });
  });

  it('returns empty results array when the source has no matches', async () => {
    setSchemaSource({ search: async () => [] });

    const orch = new Orchestrator([]);
    const tool = new SearchDBSchema(orch, { connection: 'main', query: 'foobars' }, ctx);
    const res = await tool.run();

    expect(res.isError).toBe(false);
    const parsed = JSON.parse((res.content[0] as { text: string }).text);
    expect(parsed).toMatchObject({ success: true, tableCount: 0, results: [] });
  });
});

describe('ExecuteQuery', () => {
  beforeEach(() => resetSources());

  it('returns compressed markdown + metadata on success', async () => {
    const rows = [{ count: 42 }];
    setSqlExecutor({ execute: async () => ({ rows }) });

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
    setSqlExecutor({ execute: async () => ({ rows: [], error: 'syntax error near "FRM"' }) });

    const orch = new Orchestrator([]);
    const tool = new ExecuteQuery(orch, { connectionId: 'main', query: 'SELECT * FRM bad' }, ctx);
    const res = await tool.run();

    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toContain('syntax error');
  });
});
