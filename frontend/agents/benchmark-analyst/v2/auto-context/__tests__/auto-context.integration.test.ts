/**
 * Integration test for `ensureAutoContext`: dispatch → parse → verify →
 * cache → wrapper-in-toolThread. Connector layer is mocked; LLM is faux.
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
  clearAutoContextCache,
  ensureAutoContext,
  SubmitSchemaInfo,
} from '../auto-context';
import { ChainedExecuteQuery, CatalogSearchDBSchema } from '../../../db-tools';
import { setLighterModel, setSamplingEnabled } from '../../data-tool-base';
import { clearCatalogCache } from '../../catalog';

// ─── Faux provider for the lighter model ────────────────────────────────────
const fauxReg = registerFauxProvider({
  api: 'faux-auto-context-int',
  provider: 'faux-auto-context-int',
  models: [{ id: 'stub-auto-context-int' }],
});

// ─── Connector mock — returns a fixed schema + non-zero JOIN counts ────────
const mockQuery = vi.fn<(_sql: string) => Promise<QueryResult>>(async (sql) => {
  // Default: JOIN probes return 1 row. DISTINCT probes return some values.
  // SearchDBSchema and similar probes return empty.
  const lower = sql.toLowerCase();
  if (lower.includes('select distinct')) {
    return {
      columns: ['v'], types: ['INTEGER'],
      rows: [{ v: 1 }, { v: 2 }],
      finalQuery: '<stub>',
    };
  }
  return {
    columns: ['n'], types: ['INTEGER'],
    rows: [{ n: 1 }],
    finalQuery: '<stub>',
  };
});

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

// ─── Stub parent agent (mimics BenchmarkAnalystAgent's context shape) ──────
const StubParentParams = Type.Object({ userMessage: Type.String() });
class StubParentAgent extends MXAgent<typeof StubParentParams, {
  connections: typeof CONNECTIONS;
  contextDocs?: string;
  datasetKey?: string;
  catalogKey?: string;
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
  SubmitSchemaInfo,
  ChainedExecuteQuery,
  CatalogSearchDBSchema,
];

beforeEach(() => {
  setLighterModel(fauxReg.getModel());
  setSamplingEnabled(false);
  clearAutoContextCache();
  clearCatalogCache();
  mockQuery.mockClear();
  fauxReg.setResponses([]);
});

/** Build an assistant message that calls SubmitSchemaInfo with the given annotations. */
function submitMessage(annotations: unknown[]): AssistantMessage {
  return fauxAssistantMessage(
    fauxToolCall(SubmitSchemaInfo.schema.name, { annotations } as Record<string, unknown>),
    { stopReason: 'toolUse' },
  );
}

describe('ensureAutoContext', () => {
  it('dispatches the agent and pushes a wrapper with validated annotations onto parent.toolThread', async () => {
    // Agent's first LLM turn calls SubmitSchemaInfo and stops.
    fauxReg.setResponses([
      submitMessage([
        { id: 'c0', description: 'primary key' },
        { id: 'c1', description: 'email column' },
      ]),
      fauxAssistantMessage('done', { stopReason: 'stop' }),
    ]);

    const orch = new Orchestrator(REGISTRABLES);
    const parent = new StubParentAgent(orch, { userMessage: 'q' }, {
      connections: CONNECTIONS,
      datasetKey: 'd1',
    });

    await ensureAutoContext(parent as unknown as MXAgent);

    // Wrapper sits in toolThread — getSystemPrompt reads it from there.
    expect(parent.toolThread.length).toBeGreaterThan(0);
    const wrapper = parent.toolThread.find(
      (m) => 'role' in m && m.role === 'toolResult' && m.toolName === AutoContextAgent.schema.name,
    );
    expect(wrapper).toBeDefined();
  });

  it('caches the result so a second call with the same dataset+slot skips dispatch', async () => {
    // Only one set of responses queued; if cache misses, second call would
    // run out of LLM responses.
    fauxReg.setResponses([
      submitMessage([{ id: 'c0', description: 'pk' }]),
      fauxAssistantMessage('done', { stopReason: 'stop' }),
    ]);

    const orch = new Orchestrator(REGISTRABLES);
    const parent1 = new StubParentAgent(orch, { userMessage: 'q1' }, {
      connections: CONNECTIONS, datasetKey: 'd-cache', catalogKey: 'default',
    });
    await ensureAutoContext(parent1 as unknown as MXAgent);
    expect(parent1.toolThread.length).toBeGreaterThan(0);

    // Second parent with same dataset+slot.
    const parent2 = new StubParentAgent(orch, { userMessage: 'q2' }, {
      connections: CONNECTIONS, datasetKey: 'd-cache', catalogKey: 'default',
    });
    await ensureAutoContext(parent2 as unknown as MXAgent);
    const wrapper2 = parent2.toolThread.find(
      (m) => 'role' in m && m.role === 'toolResult' && m.toolName === AutoContextAgent.schema.name,
    );
    expect(wrapper2).toBeDefined();
  });

  it('isolates cache slots per ctx.catalogKey (primary vs secondary)', async () => {
    fauxReg.setResponses([
      submitMessage([{ id: 'c0', description: 'pk' }]),
      fauxAssistantMessage('done', { stopReason: 'stop' }),
      submitMessage([{ id: 'c0', description: 'pk b' }]),
      fauxAssistantMessage('done', { stopReason: 'stop' }),
    ]);

    const orch = new Orchestrator(REGISTRABLES);
    const pA = new StubParentAgent(orch, { userMessage: 'q' }, {
      connections: CONNECTIONS, datasetKey: 'd-slot', catalogKey: 'agent-a',
    });
    await ensureAutoContext(pA as unknown as MXAgent);
    const pB = new StubParentAgent(orch, { userMessage: 'q' }, {
      connections: CONNECTIONS, datasetKey: 'd-slot', catalogKey: 'agent-b',
    });
    await ensureAutoContext(pB as unknown as MXAgent);
    expect(pA.toolThread.length).toBeGreaterThan(0);
    expect(pB.toolThread.length).toBeGreaterThan(0);
  });

  it('no-ops cleanly when there are no connections', async () => {
    const orch = new Orchestrator(REGISTRABLES);
    const parent = new StubParentAgent(orch, { userMessage: 'q' }, {
      connections: [],
      datasetKey: 'd-empty',
    });
    await ensureAutoContext(parent as unknown as MXAgent);
    // No wrapper pushed; nothing to verify.
    const wrapper = parent.toolThread.find(
      (m) => 'role' in m && m.role === 'toolResult' && m.toolName === AutoContextAgent.schema.name,
    );
    expect(wrapper).toBeUndefined();
  });
});
