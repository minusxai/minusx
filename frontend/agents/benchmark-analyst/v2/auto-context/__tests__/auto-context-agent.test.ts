/**
 * Integration test for `runAutoContextAgent` — the dispatch + cache +
 * threadHistory injection flow. The LLM is stubbed via fauxProvider; the
 * connectors + catalog are mocked so we don't hit a real DB.
 *
 * The agent emits its final payload as `<AutoContext>{...json...}</AutoContext>`
 * tagged text (no finisher tool). We feed that as the agent's first
 * stopReason='stop' response and assert that the rendered triple lands
 * in the parent's `threadHistory`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  fauxAssistantMessage,
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
  runAutoContextAgent,
  clearAutoContextCache,
  type AutoContextPayload,
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
  ChainedExecuteQuery,
  CatalogSearchDBSchema,
];

const VALID_PAYLOAD: AutoContextPayload = {
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

function taggedPayloadMessage(p: AutoContextPayload): AssistantMessage {
  return fauxAssistantMessage(
    `<AutoContext>${JSON.stringify(p)}</AutoContext>`,
    { stopReason: 'stop' },
  );
}

beforeEach(() => {
  setLighterModel(fauxReg.getModel());
  setSamplingEnabled(false);
  clearAutoContextCache();
  clearCatalogCache();
  mockQuery.mockClear();
  fauxReg.setResponses([]);
});

describe('runAutoContextAgent', () => {
  it('dispatches the agent and splices a rendered triple into parent.threadHistory', async () => {
    // Agent's only LLM turn: emit the tagged payload + stop.
    fauxReg.setResponses([taggedPayloadMessage(VALID_PAYLOAD)]);

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

    expect(parent.toolThread).toHaveLength(0);
    // [synthAssistant(toolCall), toolResult(rendered), assistant(ack)]
    expect(parent.threadHistory).toHaveLength(3);

    const synthAssistant = parent.threadHistory[0] as AssistantMessage;
    expect(synthAssistant.role).toBe('assistant');
    const toolCall = synthAssistant.content.find((c) => c.type === 'toolCall');
    expect((toolCall as { name: string }).name).toBe(AutoContextAgent.schema.name);

    const toolResult = parent.threadHistory[1] as {
      role: string; content: { type: string; text: string }[];
    };
    expect(toolResult.role).toBe('toolResult');
    const rendered = toolResult.content[0].text;
    expect(rendered).toContain('# Auto-discovered schema context');
    expect(rendered).toContain('## db.public.users');
    expect(rendered).toContain('a stub user table');
    expect(rendered).toContain('| id | primary key |');

    const ack = parent.threadHistory[2] as AssistantMessage;
    expect(ack.role).toBe('assistant');
    expect((ack.content[0] as { text: string }).text).toMatch(/loaded/i);
  });

  it('caches per (datasetKey, slot) — second call with same key skips dispatch', async () => {
    fauxReg.setResponses([taggedPayloadMessage(VALID_PAYLOAD)]);

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
    expect(parent1.threadHistory).toHaveLength(3);

    // No new LLM responses queued — cache hit on the second call should
    // skip the dispatch.
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
    expect(parent2.threadHistory).toHaveLength(3);
    // Same cached payload → same rendered text + same deterministic toolCallId.
    const text = (m: typeof parent1.threadHistory[number]) =>
      'role' in m && m.role === 'toolResult'
        ? (m.content[0] as { text: string }).text
        : '';
    expect(text(parent2.threadHistory[1])).toEqual(text(parent1.threadHistory[1]));
    const idOf = (m: typeof parent1.threadHistory[number]) =>
      'role' in m && m.role === 'toolResult' ? m.toolCallId : '';
    expect(idOf(parent2.threadHistory[1])).toEqual(idOf(parent1.threadHistory[1]));
  });

  it('isolates cache slots per cacheKey (DoubleCheck primary vs secondary)', async () => {
    fauxReg.setResponses([
      taggedPayloadMessage(VALID_PAYLOAD),
      taggedPayloadMessage(VALID_PAYLOAD),
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

    expect(p1.threadHistory).toHaveLength(3);
    expect(p2.threadHistory).toHaveLength(3);
  });

  it('throws with the agent final text when no <AutoContext> tag is emitted', async () => {
    fauxReg.setResponses([
      fauxAssistantMessage('I refuse to comply.', { stopReason: 'stop' }),
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
    })).rejects.toThrow(/reason=no-tag[\s\S]*I refuse to comply/);
  });

  it('throws with reason=bad-json when the tag is present but JSON is malformed', async () => {
    fauxReg.setResponses([
      fauxAssistantMessage(
        '<AutoContext>{tables: not valid json}</AutoContext>',
        { stopReason: 'stop' },
      ),
    ]);
    const orch = new Orchestrator(REGISTRABLES);
    const parent = new StubParentAgent(orch, { userMessage: 'q' }, {
      connections: CONNECTIONS, contextDocs: 'docs', datasetKey: 'd5',
    });
    await expect(runAutoContextAgent({
      orchestrator: orch,
      parent: parent as unknown as MXAgent,
      connections: CONNECTIONS,
      datasetKey: 'd5',
      contextDocs: 'docs',
    })).rejects.toThrow(/reason=bad-json/);
  });

  it('skips dispatch entirely when parent.threadHistory already contains an AutoContextAgent invocation', async () => {
    // Round 2 of DoubleCheck: parent inherits round 1's full history,
    // which already contains the AutoContext toolCall + result. We should
    // not re-dispatch.
    fauxReg.setResponses([]); // no responses queued — if dispatch fires we crash.

    const orch = new Orchestrator(REGISTRABLES);
    const parent = new StubParentAgent(orch, { userMessage: 'q' }, {
      connections: CONNECTIONS, contextDocs: 'docs', datasetKey: 'd6',
    });
    // Seed threadHistory as if from a prior round.
    parent.threadHistory.push({
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'prior', name: AutoContextAgent.schema.name, arguments: {} }],
      api: 'controller' as never, provider: 'controller', model: 'controller',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'toolUse', timestamp: Date.now(),
    });

    // Should NOT throw and should NOT modify threadHistory beyond what we seeded.
    await runAutoContextAgent({
      orchestrator: orch,
      parent: parent as unknown as MXAgent,
      connections: CONNECTIONS,
      datasetKey: 'd6',
      contextDocs: 'docs',
    });
    expect(parent.threadHistory).toHaveLength(1);
  });
});
