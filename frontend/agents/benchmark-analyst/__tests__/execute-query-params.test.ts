// ExecuteQuery must accept `parameters` + `vizSettings` (what the system prompt
// already advertises), and must forward
// agent-supplied query parameters to execution. Previously the v2 ExecuteQuery
// schema omitted both, and run() passed `{}` for parameters (db-tools.ts), so
// parameterized (`:name`) queries silently lost their bindings.
import { describe, it, expect } from 'vitest';
import { Orchestrator } from '@/orchestrator/orchestrator';
import { BaseExecuteQuery, ExecuteQueryParamsNoTimeout } from '@/agents/benchmark-analyst/db-tools';
import type { QueryResult } from '@/lib/connections/base';
import type { Tool } from '@/orchestrator/llm';
import type { TSchema } from 'typebox';

// Records the params handed to the execution fallback (the production path used
// when there's no local connector).
class RecordingExecuteQuery extends BaseExecuteQuery {
  static override readonly schema: Tool<TSchema> = {
    name: 'ExecuteQuery',
    description: 'test',
    parameters: ExecuteQueryParamsNoTimeout,
  };
  recordedParams: Record<string, string | number> | undefined;
  protected override async _initialiseConnectors(): Promise<void> {
    // no-op → connectors empty → run() uses _executeFallback
  }
  protected override async _executeFallback(
    _connectionId: string,
    query: string,
    params: Record<string, string | number>,
  ): Promise<QueryResult> {
    this.recordedParams = params;
    return { columns: ['v'], types: ['number'], rows: [{ v: 1 }], finalQuery: query };
  }
}

describe('ExecuteQuery — parameters + vizSettings parity', () => {
  it('schema exposes `parameters` and `vizSettings`', () => {
    const props = (ExecuteQueryParamsNoTimeout as unknown as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(props)).toContain('parameters');
    expect(Object.keys(props)).toContain('vizSettings');
  });

  it('forwards agent-supplied parameters to query execution', async () => {
    const orch = new Orchestrator([], []);
    const tool = new RecordingExecuteQuery(
      orch,
      { connectionId: 'c', query: 'SELECT :x AS v', parameters: { x: 42 } },
      { connections: [] } as never,
    );
    await tool.run();
    expect(tool.recordedParams).toEqual({ x: 42 });
  });
});
