/**
 * Title feedback + the agent's ability to SET a title.
 *
 * - CreateFile on a title-bearing file with an empty name returns non-blocking feedback telling the
 *   agent to set a title (it used to be a silent success with name: "").
 * - EditFile can set/rename the file's title via a new `name` arg (the only way — the title is
 *   metadata, never part of the markup the agent edits).
 * - EditFile keeps nudging while the file is still untitled.
 */
import { configureStore } from '@reduxjs/toolkit';
import filesReducer from '@/store/filesSlice';
import authReducer from '@/store/authSlice';
import uiReducer from '@/store/uiSlice';
import queryResultsReducer from '@/store/queryResultsSlice';
import { executeToolCall } from '@/lib/api/tool-handlers';
import { selectEffectiveName } from '@/store/filesSlice';
import type { ToolCall, UserRole } from '@/lib/types';
import type { Mode } from '@/lib/mode/mode-types';
import { setupMockFetch } from '@/test/harness/mock-fetch';
import { POST as templateHandler } from '@/app/api/files/template/route';
import { POST as createFileHandler } from '@/app/api/files/route';
import { POST as batchHandler } from '@/app/api/files/batch/route';
import { getTestDbPath, initTestDatabase, cleanupTestDatabase } from '@/store/__tests__/test-utils';

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined, DB_PATH: undefined, DB_DIR: undefined, getDbType: () => 'pglite' as const,
}));

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

describe('CreateFile / EditFile — title feedback + rename', () => {
  const dbPath = getTestDbPath('file_title_feedback');
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

  it('CreateFile with an empty name returns a non-blocking missing-title warning', async () => {
    const res = await executeToolCall(tool('CreateFile', { file_type: 'question', path: '/org', name: '' }));
    const out = parse(res);
    expect(out.success).toBe(true); // still created — feedback is non-blocking
    expect((out.validation ?? []).join(' ')).toMatch(/title/i);
    expect((out.validation ?? []).join(' ')).toMatch(/EditFile/);
  });

  it('CreateFile with a real name has no missing-title warning', async () => {
    const res = await executeToolCall(tool('CreateFile', { file_type: 'question', path: '/org', name: 'MRR by month' }));
    const out = parse(res);
    expect(out.success).toBe(true);
    expect((out.validation ?? []).join(' ')).not.toMatch(/has no title/i);
  });

  it('EditFile sets the title via the `name` arg (rename-only)', async () => {
    const created = parse(await executeToolCall(tool('CreateFile', { file_type: 'question', path: '/org', name: '' })));
    const fileId = created.state.fileState.id as number;
    expect(selectEffectiveName(testStore.getState(), fileId)).toBe('');

    const edited = parse(await executeToolCall(tool('EditFile', { fileId, name: 'Revenue Overview', changes: [] })));
    expect(edited.success).toBe(true);
    expect(selectEffectiveName(testStore.getState(), fileId)).toBe('Revenue Overview');
    expect(JSON.stringify(edited)).not.toMatch(/has no title/i); // warning cleared once titled
  });

  it('EditFile still warns when the file remains untitled after a content edit', async () => {
    const created = parse(await executeToolCall(tool('CreateFile', {
      file_type: 'question', path: '/org', name: '',
      content: { query: 'SELECT 1 AS n', connection_name: 'static', vizSettings: { type: 'table' }, parameters: [] },
    })));
    const fileId = created.state.fileState.id as number;

    const edited = parse(await executeToolCall(tool('EditFile', {
      fileId, changes: [{ oldMatch: 'SELECT 1 AS n', newMatch: 'SELECT 2 AS n' }],
    })));
    expect(edited.success).toBe(true);
    expect(edited.titleWarning ?? '').toMatch(/has no title/i);
  });
});
