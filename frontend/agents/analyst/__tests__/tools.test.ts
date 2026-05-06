import { Orchestrator } from '@/orchestrator/orchestrator';
import type { AgentContext } from '@/orchestrator/types';
import {
  ExecuteSQL,
  SearchDBSchema,
} from '../analyst-agent';
import {
  resetSources,
  setSchemaSource,
  setSqlExecutor,
  type SchemaHit,
} from '../sources';

const ctx: AgentContext = { userId: 'u', mode: 'org' };

describe('SearchDBSchema', () => {
  beforeEach(() => resetSources());

  it('returns JSON-stringified hits from the schema source', async () => {
    const hits: SchemaHit[] = [
      { table: 'users', columns: [{ name: 'id', type: 'int' }, { name: 'created_at', type: 'timestamp' }] },
    ];
    setSchemaSource({ search: async () => hits });

    const orch = new Orchestrator([]);
    const tool = new SearchDBSchema(orch, { connection: 'main', query: 'users' }, ctx);
    const res = await tool.run();

    expect(res.isError).toBe(false);
    expect(res.content[0]).toMatchObject({ type: 'text' });
    expect(JSON.parse((res.content[0] as { text: string }).text)).toEqual(hits);
  });

  it('returns an empty array when the source has no matches', async () => {
    setSchemaSource({ search: async () => [] });

    const orch = new Orchestrator([]);
    const tool = new SearchDBSchema(orch, { connection: 'main', query: 'foobars' }, ctx);
    const res = await tool.run();

    expect(res.isError).toBe(false);
    expect(JSON.parse((res.content[0] as { text: string }).text)).toEqual([]);
  });
});

describe('ExecuteSQL', () => {
  beforeEach(() => resetSources());

  it('returns JSON-stringified rows on success', async () => {
    const rows = [{ count: 42 }];
    setSqlExecutor({ execute: async () => ({ rows }) });

    const orch = new Orchestrator([]);
    const tool = new ExecuteSQL(orch, { connection: 'main', sql: 'SELECT count(*) FROM users' }, ctx);
    const res = await tool.run();

    expect(res.isError).toBe(false);
    expect(JSON.parse((res.content[0] as { text: string }).text)).toEqual(rows);
  });

  it('returns isError=true with the error message when the executor fails', async () => {
    setSqlExecutor({ execute: async () => ({ rows: [], error: 'syntax error near "FRM"' }) });

    const orch = new Orchestrator([]);
    const tool = new ExecuteSQL(orch, { connection: 'main', sql: 'SELECT * FRM bad' }, ctx);
    const res = await tool.run();

    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toContain('syntax error');
  });
});
