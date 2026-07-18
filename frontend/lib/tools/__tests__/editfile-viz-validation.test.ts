/**
 * EditFile viz validation (RFC §11 — the agent loop): viz changes are validated
 * INLINE in the write path, compiler-style. Errors REJECT the edit atomically with
 * the issues in the tool result; the file is untouched. Nothing to remember to
 * call — validation happens because the agent edited.
 *
 * The handler calls POST /api/viz/validate (the vendored VL schema is server-only);
 * here global fetch routes that call to the real validator in-process.
 */
import { configureStore } from '@reduxjs/toolkit';
import filesReducer, { addFile, selectMergedContent } from '@/store/filesSlice';
import authReducer from '@/store/authSlice';
import uiReducer from '@/store/uiSlice';
import queryResultsReducer, { setQueryResult } from '@/store/queryResultsSlice';
import { executeToolCall } from '@/lib/tools/tool-handlers';
import { validateVizEnvelope } from '@/lib/viz/validate';
import type { ToolCall, UserRole } from '@/lib/types';
import type { Mode } from '@/lib/mode/mode-types';

let testStore: any;
vi.mock('@/store/store', () => ({
  get store() { return testStore; },
  getStore: () => testStore,
}));

const AUTH_STATE = {
  user: { id: 1, email: 'test@example.com', name: 'Test User', role: 'admin' as UserRole, companyName: 'test-workspace', home_folder: '/org', mode: 'org' as Mode },
  loading: false,
};

function makeStore() {
  return configureStore({
    reducer: { files: filesReducer, auth: authReducer, ui: uiReducer, queryResults: queryResultsReducer },
    preloadedState: { auth: AUTH_STATE },
  });
}

const tool = (name: string, args: Record<string, any>): ToolCall => ({ id: 't', type: 'function', function: { name, arguments: args } });
function parse(result: { content: any }) {
  const raw = result.content;
  if (Array.isArray(raw)) return JSON.parse(raw.find((b: any) => b?.type === 'text').text);
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

const QUERY = "SELECT 'iOS' AS platform, 120 AS revenue";
const VIZ: any = {
  version: 2,
  source: {
    kind: 'vega-lite',
    grammar: 'vega-lite@6',
    spec: {
      mark: { type: 'bar' },
      encoding: {
        x: { field: 'platform', type: 'nominal' },
        y: { field: 'revenue', type: 'quantitative' },
      },
    },
  },
};

function addQuestionToStore(id: number) {
  testStore.dispatch(addFile({
    id,
    name: 'Viz Question',
    path: `/org/viz-question-${id}`,
    type: 'question' as const,
    content: {
      query: QUERY,
      connection_name: 'static',
      vizSettings: { type: 'table', xCols: [], yCols: [] },
      viz: VIZ,
    },
    references: [],
    draft: true,
    version: 1,
    last_edit_id: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  }));
  // Cached result for the question's query — field checks validate against these columns.
  testStore.dispatch(setQueryResult({
    query: QUERY,
    params: {},
    database: 'static',
    data: { columns: ['platform', 'revenue'], types: ['VARCHAR', 'BIGINT'], rows: [{ platform: 'iOS', revenue: 120 }] },
  }));
}

// Route the handler's /api/viz/validate call to the real validator; the auto-execute
// /api/query call fails (post-execute revalidation is then skipped — best-effort).
beforeEach(() => {
  testStore = makeStore();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes('/api/viz/validate')) {
      const { viz, columns } = JSON.parse(String(init?.body ?? '{}'));
      return new Response(JSON.stringify({ success: true, data: validateVizEnvelope(viz, columns) }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('EditFile — inline viz validation', () => {
  it('REJECTS a viz edit referencing a field not in the result (file untouched)', async () => {
    addQuestionToStore(301);
    const res = await executeToolCall(tool('EditFile', {
      fileId: '301',
      changes: [{ oldMatch: '"field":"revenue"', newMatch: '"field":"revenu"', replaceAll: false }],
    }), { conversationID: 'c1' } as any);

    const content = parse(res);
    expect(content.success).toBe(false);
    expect(content.error).toContain('E_FIELD_NOT_FOUND');
    expect(content.error).toContain('revenue'); // available-fields hint

    // Atomic: the staged content still has the original field.
    const after = selectMergedContent(testStore.getState(), 301) as any;
    expect(JSON.stringify(after.viz)).toContain('"revenue"');
    expect(JSON.stringify(after.viz)).not.toContain('"revenu"');
  });

  it('REJECTS a schema-invalid viz edit', async () => {
    addQuestionToStore(302);
    const res = await executeToolCall(tool('EditFile', {
      fileId: '302',
      changes: [{ oldMatch: '"type":"quantitative"', newMatch: '"type":"quantitativ"', replaceAll: false }],
    }), { conversationID: 'c1' } as any);

    const content = parse(res);
    expect(content.success).toBe(false);
    expect(content.error).toContain('E_SCHEMA');
  });

  it('accepts a valid viz edit (bar → line)', async () => {
    addQuestionToStore(303);
    const res = await executeToolCall(tool('EditFile', {
      fileId: '303',
      changes: [{ oldMatch: '"type":"bar"', newMatch: '"type":"line"', replaceAll: false }],
    }), { conversationID: 'c1' } as any);

    const content = parse(res);
    expect(content.success).toBe(true);
    const after = selectMergedContent(testStore.getState(), 303) as any;
    expect(after.viz.source.spec.mark.type).toBe('line');
  });

  it('non-viz edits skip validation entirely (no fetch to the validate route)', async () => {
    addQuestionToStore(304);
    await executeToolCall(tool('EditFile', {
      fileId: '304',
      changes: [{ oldMatch: QUERY, newMatch: "SELECT 'x' AS platform, 1 AS revenue", replaceAll: false }],
    }), { conversationID: 'c1' } as any);

    const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.map(c => String(c[0]));
    expect(calls.filter(u => u.includes('/api/viz/validate'))).toEqual([]);
  });
});
