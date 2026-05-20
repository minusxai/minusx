/**
 * Integration test for `runAutoContextForSlot`: dispatch → parse → verify →
 * return result. Connector layer is mocked; LLM is faux.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  fauxAssistantMessage,
  fauxToolCall,
  registerFauxProvider,
  type AssistantMessage,
} from '@mariozechner/pi-ai';
import type { NodeConnector, QueryResult } from '@/lib/connections/base';
import {
  AutoContextAgent,
  runAutoContextForSlot,
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

const CONNECTIONS = [{
  name: 'db', dialect: 'duckdb', description: 'test',
  config: { file_path: '/tmp/stub.duckdb' },
}];

const REGISTRABLES = [
  AutoContextAgent,
  SubmitSchemaInfo,
  ChainedExecuteQuery,
  CatalogSearchDBSchema,
];

beforeEach(() => {
  setLighterModel(fauxReg.getModel());
  setSamplingEnabled(false);
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

describe('runAutoContextForSlot', () => {
  it('dispatches the agent and returns rendered text + log with validated annotations', async () => {
    fauxReg.setResponses([
      submitMessage([
        { id: 'c0', description: 'primary key' },
        { id: 'c1', description: 'email column' },
      ]),
      fauxAssistantMessage('done', { stopReason: 'stop' }),
    ]);

    const result = await runAutoContextForSlot(CONNECTIONS, 'd1', 'default', REGISTRABLES);

    expect(result.catalogKey).toBe('default');
    expect(result.renderedText).toBeTruthy();
    expect(result.log.length).toBeGreaterThan(0);
    expect(result.annotationCount).toBeGreaterThanOrEqual(0);
  });

  it('isolates slots per catalogKey (agent-a vs agent-b)', async () => {
    fauxReg.setResponses([
      submitMessage([{ id: 'c0', description: 'pk a' }]),
      fauxAssistantMessage('done', { stopReason: 'stop' }),
      submitMessage([{ id: 'c0', description: 'pk b' }]),
      fauxAssistantMessage('done', { stopReason: 'stop' }),
    ]);

    const resultA = await runAutoContextForSlot(CONNECTIONS, 'd-slot', 'agent-a', REGISTRABLES);
    const resultB = await runAutoContextForSlot(CONNECTIONS, 'd-slot', 'agent-b', REGISTRABLES);

    expect(resultA.catalogKey).toBe('agent-a');
    expect(resultB.catalogKey).toBe('agent-b');
    expect(resultA.renderedText).toBeTruthy();
    expect(resultB.renderedText).toBeTruthy();
  });

  it('throws when there are no connections', async () => {
    await expect(
      runAutoContextForSlot([], 'd-empty', 'default', REGISTRABLES),
    ).rejects.toThrow('No connections');
  });

  /** Capture every system prompt the AutoContextAgent renders during a run. */
  async function capturePrompts(
    fn: () => Promise<unknown>,
  ): Promise<string[]> {
    const spy = vi.spyOn(
      AutoContextAgent.prototype as unknown as { getSystemPrompt: () => string },
      'getSystemPrompt',
    );
    try {
      await fn();
      return spy.mock.results
        .filter((r) => r.type === 'return')
        .map((r) => r.value as string);
    } finally {
      spy.mockRestore();
    }
  }

  it('threads contextDocs into the AutoContextAgent system prompt (docs/HINTS reach the agent)', async () => {
    fauxReg.setResponses([
      submitMessage([{ id: 'c0', description: 'pk' }]),
      fauxAssistantMessage('done', { stopReason: 'stop' }),
    ]);
    const docs = 'HINTS: business_id corresponds to business_ref. MARKER_DOCS_REACHED_AUTOCTX';

    const prompts = await capturePrompts(() =>
      runAutoContextForSlot(CONNECTIONS, 'd-docs', 'default', REGISTRABLES, docs),
    );

    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts.some((p) => p.includes('MARKER_DOCS_REACHED_AUTOCTX'))).toBe(true);
    // The injected block is `## Data documentation\n<docs>` — the trailing
    // newline distinguishes it from the static instructional mention
    // `(## Data documentation)` that's always in the prompt.
    expect(prompts.some((p) => /## Data documentation\n/.test(p))).toBe(true);
  });

  it('omits the Data documentation block when no contextDocs is provided', async () => {
    fauxReg.setResponses([
      submitMessage([{ id: 'c0', description: 'pk' }]),
      fauxAssistantMessage('done', { stopReason: 'stop' }),
    ]);

    const prompts = await capturePrompts(() =>
      runAutoContextForSlot(CONNECTIONS, 'd-nodocs', 'default', REGISTRABLES),
    );

    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts.every((p) => !/## Data documentation\n/.test(p))).toBe(true);
  });

  it('returns a log that contains the SubmitSchemaInfo tool result', async () => {
    fauxReg.setResponses([
      submitMessage([{ id: 'c0', description: 'pk' }]),
      fauxAssistantMessage('done', { stopReason: 'stop' }),
    ]);

    const result = await runAutoContextForSlot(CONNECTIONS, 'd-log', 'default', REGISTRABLES);

    const submitEntry = result.log.find(
      (e) => 'role' in e && e.role === 'toolResult' && e.toolName === SubmitSchemaInfo.schema.name,
    );
    expect(submitEntry).toBeDefined();
  });
});
