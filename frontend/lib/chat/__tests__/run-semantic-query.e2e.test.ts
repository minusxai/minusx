/**
 * RunSemanticQuery server tool — e2e through the REAL v3 chat routes (turn POST →
 * detached runner → orchestrator → tool execution), faux LLM. The tool resolves the
 * authored semantic model from the nearest context, validates/compiles the spec via
 * lib/semantic/compile, and executes the compiled SQL exactly like ExecuteQuery
 * (runQueryStream through the shared durable cache) — so the tool result carries the
 * same {success, data, columns, types, finalQuery} payload chat display expects.
 */

import { NextRequest } from 'next/server';
import { POST as turnsRoute } from '@/app/api/conversations/[id]/turns/route';
import { createConversation, getConversation, getMaxSeq, loadLog } from '@/lib/data/conversations.server';
import { fauxRegistration as webAnalystFaux } from '@/agents/web-analyst/web-analyst';
import { fauxAssistantMessage, fauxToolCall } from '@/orchestrator/llm/testing';
import { DocumentDB } from '@/lib/database/documents-db';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { getModules } from '@/lib/modules/registry';
import type { ConnectionContent, ContextContent, ContextVersion, SemanticModelV2 } from '@/lib/types';

// Real run-query path over a mock connector (same seam as lib/semantic/__tests__/tier3.test.ts):
// runQueryStream resolves the connection doc, then getNodeConnector returns this mock. A mock with
// only `query()` is wrapped by queryResultToStream inside runQueryStream.
const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
const SCHEMA = {
  updated_at: new Date().toISOString(),
  schemas: [{ schema: 'mxfood', tables: [
    { table: 'orders', columns: [{ name: 'zone_name', type: 'VARCHAR' }, { name: 'total', type: 'DOUBLE' }] },
  ]}],
};
vi.mock('@/lib/connections', () => ({
  getNodeConnector: () => ({ query: mockQuery, getSchema: async () => SCHEMA.schemas }),
}));
vi.mock('@/lib/connections/statistics-engine', () => ({
  profileDatabase: vi.fn(async (_t: string, s: unknown) => ({ schema: s, queryCount: 0 })),
}));

const TEST_DB_PATH = getTestDbPath('run_semantic_query_e2e');
const idCtx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) }) as never;

const MODEL: SemanticModelV2 = {
  name: 'Orders',
  connection: 'warehouse',
  primary: { kind: 'table', schema: 'mxfood', table: 'orders' },
  dimensions: [{ name: 'Zone', source: 'primary', column: 'zone_name' }],
  measures: [{ name: 'Revenue', agg: 'SUM', column: 'total' }],
};

const contextContent = (m: SemanticModelV2): ContextContent => ({
  versions: [{
    version: 1, whitelist: [{ name: 'warehouse', type: 'connection' }], docs: [], semanticModels: [m],
    createdAt: new Date().toISOString(), createdBy: 1,
  } as ContextVersion],
  published: { all: 1 },
} as ContextContent);

async function mkPublished(name: string, path: string, type: string, c: object): Promise<number> {
  const id = await DocumentDB.create(name, path, type, c, []);
  await DocumentDB.update(id, name, path, c, [], `init-${id}`);
  return id;
}

async function waitForIdle(conversationId: number, ms = 15000): Promise<void> {
  const start = Date.now();
  for (;;) {
    const c = await getConversation(conversationId);
    const maxSeq = await getMaxSeq(conversationId);
    if (c && c.runStatus !== 'running' && maxSeq >= 0) return;
    if (Date.now() - start > ms) throw new Error(`turn did not settle (status=${c?.runStatus}, maxSeq=${maxSeq})`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Run one faux-driven turn calling RunSemanticQuery with `args`; returns the tool result entry. */
async function runTurnWith(args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  webAnalystFaux.setResponses([
    fauxAssistantMessage([fauxToolCall('RunSemanticQuery', args)], { stopReason: 'toolUse' }),
    fauxAssistantMessage('Done.', { stopReason: 'stop' }),
  ]);
  const conv = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
  const res = await turnsRoute(
    new NextRequest(`http://localhost/api/conversations/${conv.id}/turns`, {
      method: 'POST', body: JSON.stringify({ userMessage: 'revenue by zone' }),
    }),
    idCtx(conv.id),
  );
  expect(res.status).toBe(200);
  await waitForIdle(conv.id);

  const log = await loadLog(conv.id);
  const entry = log.find((e) => {
    const m = e as { role?: string; toolName?: string };
    return m.role === 'toolResult' && m.toolName === 'RunSemanticQuery';
  }) as { content?: Array<{ type: string; text?: string }>; isError?: boolean } | undefined;
  expect(entry).toBeTruthy();
  const text = (entry!.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  return { text, isError: entry!.isError === true };
}

describe('RunSemanticQuery e2e (real chat routes, faux LLM)', () => {
  it('is ADVERTISED in the production analyst toolset (registration alone is not enough)', async () => {
    // Browser-verification caught this: REGISTRABLES makes the tool resolvable,
    // but the LLM only sees tools an agent declares. Guard the declaration.
    const { RemoteAnalystAgent } = await import('@/agents/analyst/analyst-agent');
    expect(RemoteAnalystAgent.tools.map((t) => t.name)).toContain('RunSemanticQuery');
  });

  setupTestDb(TEST_DB_PATH);

  beforeEach(async () => {
    mockQuery.mockReset();
    // Echo finalQuery like real connectors do — the payload's finalQuery is the SQL as run.
    mockQuery.mockImplementation(async (sql: string) => ({
      columns: ['zone', 'revenue'], types: ['VARCHAR', 'DOUBLE'],
      rows: [{ zone: 'North', revenue: 42 }, { zone: 'South', revenue: 17 }],
      finalQuery: sql,
    }));
    await getModules().db.exec('DELETE FROM query_cache', []);
    await getModules().db.exec('DELETE FROM files', []);
    const conn: ConnectionContent = { type: 'duckdb', config: { file_path: '../x.duckdb' }, schema: SCHEMA };
    await mkPublished('warehouse', '/org/database/warehouse', 'connection', conn);
    await mkPublished('context', '/org/context', 'context', contextContent(MODEL));
  });

  it('valid spec → compiles, executes like ExecuteQuery, returns rows + compiled SQL', async () => {
    const { text, isError } = await runTurnWith({ model: 'Orders', measures: ['Revenue'], dimensions: ['Zone'] });
    expect(isError).toBe(false);

    const payload = JSON.parse(text) as {
      success: boolean; data?: string; columns?: string[]; finalQuery?: string; totalRows?: number;
    };
    expect(payload.success).toBe(true);
    // Row data (ExecuteQuery's compressed markdown table shape) reaches the LLM.
    expect(payload.columns).toEqual(['zone', 'revenue']);
    expect(payload.data).toContain('North');
    expect(payload.totalRows).toBe(2);
    // The compiled SQL is in the payload, exactly where ExecuteQuery puts its query.
    expect(payload.finalQuery).toMatch(/SUM\(\s*"?total"?\s*\)/i);
    expect(payload.finalQuery).toMatch(/GROUP BY/i);
    expect(payload.finalQuery).toMatch(/orders/i);

    // The connector actually ran the compiled SQL (not some hand-written query).
    expect(mockQuery).toHaveBeenCalled();
    const ranSql = String(mockQuery.mock.calls[0][0]);
    expect(ranSql).toMatch(/SUM\(\s*"?total"?\s*\)/i);
  });

  it('unknown measure → validation issues returned as tool error (agent can self-correct)', async () => {
    const { text, isError } = await runTurnWith({ model: 'Orders', measures: ['Profit'] });
    expect(isError).toBe(true);
    const payload = JSON.parse(text) as { success: boolean; error: string };
    expect(payload.success).toBe(false);
    expect(payload.error).toContain('unknown measure "Profit"');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('unknown model → helpful error listing available model names', async () => {
    const { text, isError } = await runTurnWith({ model: 'Sales', measures: ['Revenue'] });
    expect(isError).toBe(true);
    expect(text).toContain('Orders'); // available models listed
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
