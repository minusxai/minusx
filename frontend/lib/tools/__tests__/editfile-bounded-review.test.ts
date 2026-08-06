/**
 * EditFile must not hang on, or silently swallow, the queries it re-runs after staging an edit —
 * and its permanent per-edit context cost must stay small.
 *
 * 1. Bounded auto-execute: the post-edit re-run wave is capped by its OWN budget (much shorter
 *    than the 120s client query timeout) so ONE hung embed can't hold the tool open for minutes.
 * 2. Surfaced failures: a failed/timed-out re-run is reported in the result status instead of
 *    being console.warn'd away while the edit reports plain success.
 * 3. Compact rubric: the rubric echoed in __status keeps what the skill loop acts on
 *    (overall/grade/category/score + ruleId/severity/title/fix) and drops the prose.
 */
import { configureStore } from '@reduxjs/toolkit';
import filesReducer from '@/store/filesSlice';
import authReducer from '@/store/authSlice';
import uiReducer from '@/store/uiSlice';
import queryResultsReducer from '@/store/queryResultsSlice';
import { executeToolCall } from '@/lib/tools/tool-handlers';
import { settleWithinBudget } from '@/lib/tools/handlers/edit-file';
import type { ToolCall, UserRole } from '@/lib/types';
import type { Mode } from '@/lib/mode/mode-types';
import { setupMockFetch } from '@/test/harness/mock-fetch';
import { POST as templateHandler } from '@/app/api/files/template/route';
import { POST as createFileHandler } from '@/app/api/files/route';
import { POST as batchHandler } from '@/app/api/files/batch/route';
import { getTestDbPath, initTestDatabase, cleanupTestDatabase } from '@/store/__tests__/test-utils';

let testStore: any;
vi.mock('@/store/store', () => ({
  get store() { return testStore; },
  getStore: () => testStore,
}));

const TEST_AUTH_STATE = {
  user: { id: 1, email: 'test@example.com', name: 'Test User', role: 'admin' as UserRole, companyName: 'test-workspace', home_folder: '/org', mode: 'org' as Mode },
  loading: false,
};

function makeStore() {
  return configureStore({
    reducer: { files: filesReducer, auth: authReducer, ui: uiReducer, queryResults: queryResultsReducer },
    preloadedState: { auth: TEST_AUTH_STATE },
  });
}

const tool = (name: string, args: Record<string, any>): ToolCall => ({ id: 't', type: 'function', function: { name, arguments: args } });

function parse(result: { content: any }): Record<string, any> {
  const raw = result.content;
  if (Array.isArray(raw)) return JSON.parse(raw.find((b: any) => b?.type === 'text').text);
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

describe('settleWithinBudget — the wave-level deadline', () => {
  it('reports ok / failed / timedOut per run and resolves at the budget, not at the slowest run', async () => {
    const start = Date.now();
    const never = new Promise(() => {});
    const outcomes = await settleWithinBudget([
      { label: 'good', promise: Promise.resolve('x') },
      { label: 'bad', promise: Promise.reject(new Error('boom')) },
      { label: 'hung', promise: never },
    ], 40);
    expect(Date.now() - start).toBeLessThan(1000);
    expect(outcomes.find((o) => o.label === 'good')?.status).toBe('ok');
    expect(outcomes.find((o) => o.label === 'bad')).toMatchObject({ status: 'failed', error: 'boom' });
    expect(outcomes.find((o) => o.label === 'hung')?.status).toBe('timedOut');
  });

  it('resolves immediately when every run settles inside the budget', async () => {
    const outcomes = await settleWithinBudget([{ label: 'a', promise: Promise.resolve(1) }], 60_000);
    expect(outcomes).toEqual([{ label: 'a', status: 'ok' }]);
  });
});

describe('EditFile — surfaced execution failures + compact rubric', () => {
  const dbPath = getTestDbPath('editfile_bounded_review');
  const mockFetch = setupMockFetch({
    interceptors: [
      { includesUrl: ['/api/files/template'], handler: templateHandler },
      { includesUrl: ['/api/files/batch'], handler: batchHandler },
      { includesUrl: ['/api/files'], handler: createFileHandler },
    ],
    additionalInterceptors: [
      async (url: string) => {
        if (url.includes('/api/capture-error')) {
          return { ok: true, status: 200, json: async () => ({}) } as Response;
        }
        if (url.includes('/api/query')) {
          return {
            ok: false,
            status: 500,
            headers: new Headers(),
            json: async () => ({ error: { message: 'connection refused' } }),
            text: async () => '',
          } as unknown as Response;
        }
        return null;
      },
    ],
  });

  beforeAll(async () => { await initTestDatabase(dbPath); });
  afterAll(async () => { await cleanupTestDatabase(dbPath); });
  beforeEach(() => { testStore = makeStore(); mockFetch.mockClear(); });

  async function createQuestion(query: string) {
    const create = parse(await executeToolCall(tool('CreateFile', {
      file_type: 'question', path: '/org', name: 'Q',
      content: { query, parameters: [], description: 'a question', connection_name: 'test_db' },
    })));
    return create.state.fileState.id as number;
  }

  it('reports a failed post-edit auto-execute in the status instead of swallowing it', async () => {
    const fileId = await createQuestion('SELECT 1 AS n');
    const out = parse(await executeToolCall(tool('EditFile', {
      fileId, changes: [{ oldMatch: 'SELECT 1 AS n', newMatch: 'SELECT 2 AS n' }],
    })));
    expect(out.success).toBe(true); // the edit is still staged
    expect(out.queryExecution).toBeDefined();
    expect(JSON.stringify(out.queryExecution.failed)).toContain('connection refused');
  });

  it('echoes a COMPACT rubric — the loop fields only, no prose', async () => {
    // `:start` is referenced but never declared → an `error` finding the loop must act on.
    const fileId = await createQuestion('SELECT 1 AS n');
    const out = parse(await executeToolCall(tool('EditFile', {
      fileId, changes: [{ oldMatch: 'SELECT 1 AS n', newMatch: 'SELECT 1 AS n WHERE d = :start' }],
    })));
    expect(out.rubric.overall).toBeDefined();
    expect(out.rubric.grade).toBeDefined();
    const findings = out.rubric.categories.flatMap((c: any) => c.findings);
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.ruleId).toBeDefined();
      expect(f.severity).toBeDefined();
      expect(f.title).toBeDefined();
      // `detail` stays (clipped) — it says WHICH thing is wrong, so findings stay locatable
      expect(f.detail.length).toBeLessThanOrEqual(140);
      // the non-actionable fields are dropped from the echo
      expect(f.source).toBeUndefined();
    }
    // errors keep their full `fix` (the skill loop acts on it); warns keep a clipped one
    const err = findings.find((f: any) => f.severity === 'error');
    expect(err?.fix).toBeTruthy();
    for (const f of findings.filter((x: any) => x.severity === 'warn')) {
      if (f.fix) expect(f.fix.length).toBeLessThanOrEqual(201);
    }
  });
});
