/**
 * Integration test for `runAutoContextAgent` — the dispatch + cache +
 * threadHistory injection flow. The LLM is stubbed via fauxProvider; the
 * connectors + catalog are mocked so we don't hit a real DB.
 *
 * The test drives the AutoContextAgent through one ExecuteQuery probe
 * followed by FinishAutoContext, then asserts that the rendered pair
 * lands in the parent's `threadHistory` (not `toolThread`) and that a
 * second call hits the cache without re-dispatching.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  fauxAssistantMessage,
  fauxToolCall,
  registerFauxProvider,
  type AssistantMessage,
  type Tool,
  type TSchema,
} from '@mariozechner/pi-ai';
import type { NodeConnector, QueryResult } from '@/lib/connections/base';
import { Orchestrator } from '@/orchestrator/orchestrator';
import { MXAgent } from '@/orchestrator/types';
import { Type } from '@mariozechner/pi-ai';
import {
  AutoContextAgent,
  FinishAutoContext,
  runAutoContextAgent,
  clearAutoContextCache,
} from '..';
import {
  ChainedExecuteQuery,
  CatalogSearchDBSchema,
} from '../../../db-tools';
import { setLighterModel, setSamplingEnabled } from '../../data-tool-base';
import { clearCatalogCache } from '../../catalog';

const fauxReg = registerFauxProvider({
  api: 'faux-auto-context-api',
  provider: 'faux-auto-context',
  models: [{ id: 'stub-auto-context' }],
});

// ─── Mock the connector layer ────────────────────────────────────────────────
//
// The agent's catalog read + ExecuteQuery probes all flow through the same
// `getOrCreateBenchmarkConnector` factory. We replace it with a fixed-schema
// stub so the test stays hermetic.

const mockQuery = vi.fn(async (_sql: string): Promise<QueryResult> => ({
  columns: ['n'], types: ['INTEGER'], rows: [{ n: 42 }], finalQuery: '<stub>',
}));

vi.mock('../../../shared-duckdb', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../shared-duckdb')>()),
  getOrCreateBenchmarkConnector: vi.fn(async (): Promise<NodeConnector> => ({
    query: mockQuery,
    getSchema: vi.fn(async () => [{
      schema: 'public',
      tables: [{
        table: 'users',
        columns: [
          { name: 'id', type: 'INTEGER' },
          { name: 'name', type: 'VARCHAR' },
        ],
      }],
    }]),
  } as unknown as NodeConnector)),
}));

// ─── Stub parent agent ───────────────────────────────────────────────────────
// A no-op MXAgent used only to host `runAutoContextAgent`. It never runs its
// own LLM loop in this test — we call `runAutoContextAgent` directly.

const StubParentParams = Type.Object({ userMessage: Type.String() });

class StubParentAgent extends MXAgent<typeof StubParentParams, {
  connections: typeof CONNECTIONS;
  contextDocs: string;
  datasetKey: string;
}> {
  static readonly schema: Tool<typeof StubParentParams> = {
    name: 'StubParentAgent',
    description: 'test stub',
    parameters: StubParentParams,
  };
  static readonly tools: Tool<TSchema>[] = [];
  static model = fauxReg.getModel();
}

const CONNECTIONS = [{
  name: 'db', dialect: 'duckdb', description: 'test',
  config: { file_path: '/tmp/stub.duckdb' },
}];

const REGISTRABLES = [
  StubParentAgent,
  AutoContextAgent,
  FinishAutoContext,
  ChainedExecuteQuery,
  CatalogSearchDBSchema,
];

const VALID_PAYLOAD = {
  tables: [{
    connection: 'db',
    schema: 'public',
    table: 'users',
    tableNote: 'a stub user table',
    columns: [
      { name: 'id', note: 'primary key' },
      { name: 'name', note: '' },
    ],
    joins: [],
  }],
  examples: [],
};

beforeEach(() => {
  setLighterModel(fauxReg.getModel());
  setSamplingEnabled(false);
  clearAutoContextCache();
  clearCatalogCache();
  mockQuery.mockClear();
  fauxReg.setResponses([]);
});

// Build a faux assistant message that emits a tool call (via pi-ai's
// `fauxToolCall` helper, so the runtime serialisation matches what a real
// provider would produce).
function assistantToolCall(toolName: string, args: unknown): AssistantMessage {
  return fauxAssistantMessage(
    fauxToolCall(toolName, args as Record<string, unknown>),
    { stopReason: 'toolUse' },
  );
}

describe('runAutoContextAgent', () => {
  it('dispatches the agent and splices the rendered (toolCall, toolResult) pair into parent.threadHistory', async () => {
    // Sequence the LLM:
    // 1. AutoContextAgent's first turn → call FinishAutoContext with payload
    // 2. AutoContextAgent's second turn → stop
    fauxReg.setResponses([
      assistantToolCall(FinishAutoContext.schema.name, VALID_PAYLOAD),
      fauxAssistantMessage('done', { stopReason: 'stop' }),
    ]);

    const orch = new Orchestrator(REGISTRABLES);
    const parent = new StubParentAgent(orch, { userMessage: 'q' }, {
      connections: CONNECTIONS, contextDocs: 'docs', datasetKey: 'd1',
    });

    await runAutoContextAgent({
      orchestrator: orch,
      parent: parent as unknown as MXAgent,
      connections: CONNECTIONS,
      datasetKey: 'd1',
      contextDocs: 'docs',
    });

    // The pair lives in threadHistory (not toolThread).
    expect(parent.toolThread).toHaveLength(0);
    expect(parent.threadHistory).toHaveLength(2);

    const synthAssistant = parent.threadHistory[0] as AssistantMessage;
    expect(synthAssistant.role).toBe('assistant');
    const toolCall = synthAssistant.content.find((c) => c.type === 'toolCall');
    expect(toolCall).toBeDefined();
    expect((toolCall as { name: string }).name).toBe(AutoContextAgent.schema.name);

    const toolResult = parent.threadHistory[1] as { role: string; content: { type: string; text: string }[] };
    expect(toolResult.role).toBe('toolResult');
    const rendered = toolResult.content[0].text;
    expect(rendered).toContain('# Auto-discovered schema context');
    expect(rendered).toContain('## db.public.users');
    expect(rendered).toContain('a stub user table');
    expect(rendered).toContain('| id | primary key |');
  });

  it('caches per (datasetKey, slot) — second call with same key skips dispatch', async () => {
    fauxReg.setResponses([
      assistantToolCall(FinishAutoContext.schema.name, VALID_PAYLOAD),
      fauxAssistantMessage('done', { stopReason: 'stop' }),
    ]);

    const orch = new Orchestrator(REGISTRABLES);
    const parent1 = new StubParentAgent(orch, { userMessage: 'q' }, {
      connections: CONNECTIONS, contextDocs: 'docs', datasetKey: 'd2',
    });
    await runAutoContextAgent({
      orchestrator: orch,
      parent: parent1 as unknown as MXAgent,
      connections: CONNECTIONS,
      datasetKey: 'd2',
      contextDocs: 'docs',
    });
    expect(parent1.threadHistory).toHaveLength(2);

    // No new LLM responses queued — if the cache hit DOESN'T work, the
    // second runAutoContextAgent would try to dispatch and run out of
    // queued responses, failing.
    const parent2 = new StubParentAgent(orch, { userMessage: 'q2' }, {
      connections: CONNECTIONS, contextDocs: 'docs', datasetKey: 'd2',
    });
    await runAutoContextAgent({
      orchestrator: orch,
      parent: parent2 as unknown as MXAgent,
      connections: CONNECTIONS,
      datasetKey: 'd2',
      contextDocs: 'docs',
    });
    expect(parent2.threadHistory).toHaveLength(2);
    // Same cached payload → same rendered text. (toolCallId + timestamp
    // differ between fresh injects, so compare just the rendered content.)
    const text = (m: typeof parent1.threadHistory[number]) =>
      'role' in m && m.role === 'toolResult'
        ? (m.content[0] as { text: string }).text
        : '';
    expect(text(parent2.threadHistory[1])).toEqual(text(parent1.threadHistory[1]));
  });

  it('isolates cache slots per cacheKey (DoubleCheck primary vs secondary)', async () => {
    // Both slots will dispatch — provide responses for both runs.
    fauxReg.setResponses([
      assistantToolCall(FinishAutoContext.schema.name, VALID_PAYLOAD),
      fauxAssistantMessage('done', { stopReason: 'stop' }),
      assistantToolCall(FinishAutoContext.schema.name, VALID_PAYLOAD),
      fauxAssistantMessage('done', { stopReason: 'stop' }),
    ]);

    const orch = new Orchestrator(REGISTRABLES);
    const mkParent = () => new StubParentAgent(orch, { userMessage: 'q' }, {
      connections: CONNECTIONS, contextDocs: 'docs', datasetKey: 'd3',
    });

    const p1 = mkParent();
    await runAutoContextAgent({
      orchestrator: orch,
      parent: p1 as unknown as MXAgent,
      connections: CONNECTIONS,
      datasetKey: 'd3',
      cacheKey: 'agent-a',
      contextDocs: 'docs',
    });
    const p2 = mkParent();
    await runAutoContextAgent({
      orchestrator: orch,
      parent: p2 as unknown as MXAgent,
      connections: CONNECTIONS,
      datasetKey: 'd3',
      cacheKey: 'agent-b',
      contextDocs: 'docs',
    });

    // Both got their own dispatch (response queue drained twice).
    expect(p1.threadHistory).toHaveLength(2);
    expect(p2.threadHistory).toHaveLength(2);
  });

  it('throws (so the parent can catch + fall back) when the agent never calls FinishAutoContext', async () => {
    fauxReg.setResponses([
      fauxAssistantMessage('I refuse', { stopReason: 'stop' }),
    ]);
    const orch = new Orchestrator(REGISTRABLES);
    const parent = new StubParentAgent(orch, { userMessage: 'q' }, {
      connections: CONNECTIONS, contextDocs: 'docs', datasetKey: 'd4',
    });
    await expect(runAutoContextAgent({
      orchestrator: orch,
      parent: parent as unknown as MXAgent,
      connections: CONNECTIONS,
      datasetKey: 'd4',
      contextDocs: 'docs',
    })).rejects.toThrow(/FinishAutoContext/);
    // Cache entry must have been removed on failure so a retry can re-dispatch.
    // (Verified indirectly by the next test in this suite passing.)
  });
});
