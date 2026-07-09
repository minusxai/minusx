/**
 * Rubric v2 — feedback where the agent ACTS:
 * - CreateFile returns the rules-only rubric (a created file is a background draft — nothing
 *   rendered to screenshot/judge).
 * - EditFile returns a rubric in its status (full review when the view is mounted; here, in a
 *   headless node env, it degrades to the deterministic rubric — the fallback under test).
 * - The error gate: a file with an `error` finding scores overall 0 / poor.
 */
import { configureStore } from '@reduxjs/toolkit';
import filesReducer from '@/store/filesSlice';
import authReducer from '@/store/authSlice';
import uiReducer from '@/store/uiSlice';
import queryResultsReducer from '@/store/queryResultsSlice';
import { executeToolCall } from '@/lib/tools/tool-handlers';
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

describe('CreateFile / EditFile — rubric v2 feedback', () => {
  const dbPath = getTestDbPath('edit_create_rubric');
  const mockFetch = setupMockFetch({
    interceptors: [
      { includesUrl: ['/api/files/template'], handler: templateHandler },
      { includesUrl: ['/api/files/batch'], handler: batchHandler },
      { includesUrl: ['/api/files'], handler: createFileHandler },
    ],
  });

  beforeAll(async () => { await initTestDatabase(dbPath); });
  afterAll(async () => { await cleanupTestDatabase(dbPath); });
  beforeEach(() => { testStore = makeStore(); mockFetch.mockClear(); });

  it('CreateFile returns the deterministic rubric; an undeclared param is an error that gates overall to 0', async () => {
    const res = await executeToolCall(tool('CreateFile', {
      file_type: 'question', path: '/org', name: 'Broken Q',
      // :start is referenced but never declared → question.undeclared-param (error)
      content: { query: 'SELECT * FROM t WHERE d > :start', parameters: [] },
    }));
    const out = parse(res);
    expect(out.success).toBe(true);
    expect(out.rubric).toBeDefined();
    expect(out.rubric.overall).toBe(0);
    expect(out.rubric.grade).toBe('poor');
    const findings = out.rubric.categories.flatMap((c: any) => c.findings);
    expect(findings.some((f: any) => f.ruleId === 'question.undeclared-param' && f.severity === 'error')).toBe(true);
  });

  it('EditFile returns a rubric in its status (deterministic fallback when no view is mounted)', async () => {
    const create = parse(await executeToolCall(tool('CreateFile', {
      file_type: 'question', path: '/org', name: 'Clean Q',
      content: { query: 'SELECT 1 AS n', parameters: [], description: 'one' },
    })));
    const fileId = create.state.fileState.id;
    const res = await executeToolCall(tool('EditFile', {
      fileId,
      changes: [{ oldMatch: 'SELECT 1 AS n', newMatch: 'SELECT 2 AS n' }],
    }));
    const out = parse(res);
    expect(out.success).toBe(true);
    expect(out.rubric).toBeDefined();
    // No error findings on this file → the overall is a real (non-gated) score.
    const findings = out.rubric.categories.flatMap((c: any) => c.findings);
    expect(findings.every((f: any) => f.severity !== 'error')).toBe(true);
    expect(out.rubric.overall).toBeGreaterThan(0);
  });
});
