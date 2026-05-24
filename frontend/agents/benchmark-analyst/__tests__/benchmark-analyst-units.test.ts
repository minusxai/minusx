// Benchmark-analyst unit tests — merged from the former execute-query-params,
// fuzzy-match-server, search-db-schema-connection, and
// benchmark-analyst-systemprompt files (all share the same module graph, so
// merging amortizes the per-file import).
//
// Covers:
//   - ExecuteQuery must accept + forward `parameters`/`vizSettings` (the system
//     prompt advertises them; v2 previously dropped agent-supplied bindings).
//   - SearchDBSchema's connection param must be `connection_id` (prompt parity).
//   - The production FuzzyMatch tool exposes the documented params and fails
//     gracefully when the agent context lacks an effectiveUser.
//   - BenchmarkAnalystAgent's system prompt wraps contextDocs in <UserContext>
//     and embeds rendered auto-context under <GeneratedContext>.

import { Orchestrator } from '@/orchestrator/orchestrator';
import { BaseExecuteQuery, ExecuteQueryParamsNoTimeout, BaseSearchDBSchema } from '@/agents/benchmark-analyst/db-tools';
import { FuzzyMatch } from '@/agents/benchmark-analyst/db-tools.server';
import { BenchmarkAnalystAgent, fauxRegistration } from '../benchmark-analyst';
import { fauxAssistantMessage } from '@/orchestrator/llm/testing';
import type { QueryResult, SchemaEntry } from '@/lib/connections/base';
import type { Tool, Context, TextContent } from '@/orchestrator/llm';
import type { TSchema } from 'typebox';
import type { RemoteAnalystContext } from '@/agents/analyst/types';
import type { BenchmarkAnalystContext } from '../types';

// ── ExecuteQuery: parameters + vizSettings parity ───────────────────────────

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

// ── production FuzzyMatch tool ──────────────────────────────────────────────

describe('production FuzzyMatch tool', () => {
  it('exposes the documented parameters', () => {
    const props = (FuzzyMatch.schema.parameters as unknown as { properties: Record<string, unknown> }).properties;
    for (const key of ['connection_id', 'table', 'column', 'search_term', 'schema', 'limit', 'semantic_expansion', 'return_columns']) {
      expect(Object.keys(props)).toContain(key);
    }
    expect(FuzzyMatch.schema.name).toBe('FuzzyMatch');
  });

  it('returns an error result when effectiveUser is missing from context', async () => {
    const orch = new Orchestrator([], []);
    const ctx: RemoteAnalystContext = { userId: 'u', mode: 'org' };
    const tool = new FuzzyMatch(orch, { connection_id: 'c', table: 't', column: 'col', search_term: 'x' }, ctx);
    const res = await tool.run();
    const payload = JSON.parse((res as { content: { text: string }[] }).content[0].text);
    expect(payload.success).toBe(false);
  });
});

// ── SearchDBSchema: connection_id parity ────────────────────────────────────

// Records the connection name the handler resolves against.
class RecordingSearchDBSchema extends BaseSearchDBSchema {
  resolvedConnection: string | undefined;
  protected override async _initialiseConnectors(): Promise<void> {
    // no-op → no local connectors → run() falls through to _loadSchemaFallback
  }
  protected override async _loadSchemaFallback(connection: string): Promise<SchemaEntry[]> {
    this.resolvedConnection = connection;
    return [];
  }
}

describe('SearchDBSchema — connection_id parity', () => {
  it('schema exposes `connection_id` (not `connection`)', () => {
    const props = (BaseSearchDBSchema.schema.parameters as unknown as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(props)).toContain('connection_id');
    expect(Object.keys(props)).not.toContain('connection');
  });

  it('resolves the schema against the agent-supplied connection_id', async () => {
    const orch = new Orchestrator([], []);
    const tool = new RecordingSearchDBSchema(
      orch,
      { connection_id: 'mydb', query: '' },
      { connections: [] } as never,
    );
    await tool.run();
    expect(tool.resolvedConnection).toBe('mydb');
  });
});

// ── BenchmarkAnalystAgent system prompt ─────────────────────────────────────

const REGISTRABLES = [BenchmarkAnalystAgent];

const AUTO_CTX_MARKER = 'AUTOCTX_MARKER';

const CTX: BenchmarkAnalystContext = {
  connections: [
    { name: 'test_db', dialect: 'duckdb', description: 'test', config: { file_path: '/nonexistent/test.duckdb' } },
  ],
  contextDocs: '## doc heading\nUserContext-payload-marker',
  datasetKey: 'test-dataset',
  // Simulate the runner having pre-populated auto-context
  autoContextRendered: `## test_db.public.tbl_with_marker — ${AUTO_CTX_MARKER}\n| col | type | stats | description | joins |\n|---|---|---|---|---|\n| col_a | VARCHAR | | | |`,
};

describe('BenchmarkAnalystAgent system prompt', () => {
  async function captureFirstSystemPromptAndUser(
    ctxOverride?: Partial<BenchmarkAnalystContext>,
  ): Promise<{ systemPrompt: string; userContent: TextContent[] | string }> {
    fauxRegistration.setResponses([
      fauxAssistantMessage('TL;DR: stub answer', { stopReason: 'stop' }),
    ]);
    const orch = new Orchestrator(REGISTRABLES);
    const ctx = ctxOverride ? { ...CTX, ...ctxOverride } : CTX;
    const root = new BenchmarkAnalystAgent(orch, { userMessage: 'find the thing' }, ctx);
    let systemPrompt: string | undefined;
    let userContent: TextContent[] | string = '';
    const origCall = orch.callLLM.bind(orch);
    orch.callLLM = async (m, c: Context, id, opts) => {
      if (systemPrompt === undefined) {
        systemPrompt = c.systemPrompt;
        const userMsg = c.messages.find((msg) => msg.role === 'user');
        userContent = (userMsg?.content ?? '') as TextContent[] | string;
      }
      return origCall(m, c, id, opts);
    };
    const stream = orch.run(root);
    for await (const _ev of stream) { /* drain */ }
    await stream.result();
    return { systemPrompt: systemPrompt ?? '', userContent };
  }

  it('reads autoContextRendered from context and embeds it under <GeneratedContext>', async () => {
    const { systemPrompt } = await captureFirstSystemPromptAndUser();

    expect(systemPrompt).toMatch(/<UserContext>[\s\S]*UserContext-payload-marker[\s\S]*<\/UserContext>/);
    expect(systemPrompt).toMatch(new RegExp(`<GeneratedContext>[\\s\\S]*${AUTO_CTX_MARKER}[\\s\\S]*</GeneratedContext>`));
    // UserContext appears before GeneratedContext.
    expect(systemPrompt.indexOf('<UserContext>')).toBeLessThan(systemPrompt.indexOf('<GeneratedContext>'));
  });

  it('includes the analysis guideline distinguishing UserContext vs GeneratedContext', async () => {
    const { systemPrompt } = await captureFirstSystemPromptAndUser();
    expect(systemPrompt).toMatch(/UserContext.*authoritative|authoritative.*UserContext/i);
    expect(systemPrompt).toMatch(/GeneratedContext/);
  });

  it('omits <GeneratedContext> when autoContextRendered is not set', async () => {
    const { systemPrompt } = await captureFirstSystemPromptAndUser({
      autoContextRendered: undefined,
      autoContextBySlot: undefined,
    });
    expect(systemPrompt).not.toContain('<GeneratedContext>');
    expect(systemPrompt).toContain('<UserContext>');
  });

  it('omits <GeneratedContext> for production path (no datasetKey, no auto-context)', async () => {
    const { systemPrompt } = await captureFirstSystemPromptAndUser({
      datasetKey: undefined,
      autoContextRendered: undefined,
      autoContextBySlot: undefined,
    });
    expect(systemPrompt).not.toContain('<GeneratedContext>');
    expect(systemPrompt).toContain('<UserContext>');
  });
});
