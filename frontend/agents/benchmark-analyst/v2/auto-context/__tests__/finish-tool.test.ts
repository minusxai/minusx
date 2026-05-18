import { describe, it, expect } from 'vitest';
import { Orchestrator } from '@/orchestrator/orchestrator';
import { FinishAutoContext, type AutoContextPayload } from '../finish-tool';

const PAYLOAD: AutoContextPayload = {
  tables: [{
    connection: 'db',
    schema: 'public',
    table: 'users',
    tableNote: 'core user table',
    columns: [
      { name: 'id', note: 'primary key' },
      { name: 'email', note: '' },
    ],
    joins: [{
      fromColumn: 'id',
      toTable: 'orders',
      toColumn: 'user_id',
      evidence: 'COUNT(*) JOIN returned 42 rows',
    }],
  }],
  examples: [{
    description: 'first order per user',
    connection: 'db',
    query: 'SELECT user_id, MIN(created_at) FROM orders GROUP BY user_id',
    rows: [{ user_id: 1, min: '2024-01-01' }],
  }],
};

describe('FinishAutoContext.run', () => {
  it('echoes a summary in content and stashes the payload under details.payload', async () => {
    const orch = new Orchestrator([FinishAutoContext]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tool = new FinishAutoContext(orch, PAYLOAD as any, {} as any);
    const result = await tool.run();
    expect(result.isError).toBe(false);
    expect(result.details).toEqual({ type: 'auto_context', payload: PAYLOAD });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('1 table');
    expect(text).toContain('1 join');
    expect(text).toContain('1 example');
  });
});
