/**
 * EditFile replaceAll semantics (agent tool handler): the default is REPLACE-ONE.
 * A short oldMatch that occurs more than once must FAIL with actionable guidance
 * (extend the match, or pass replaceAll: true deliberately) instead of silently
 * rewriting every occurrence — the root cause of "the agent changed unrelated
 * parts of my story". An explicit replaceAll: true still replaces all sites and
 * the status reports the occurrence count so multi-site edits are visible.
 */
import { configureStore } from '@reduxjs/toolkit';
import filesReducer, { addFile, selectMergedContent } from '@/store/filesSlice';
import authReducer from '@/store/authSlice';
import uiReducer from '@/store/uiSlice';
import queryResultsReducer from '@/store/queryResultsSlice';
import { executeToolCall } from '@/lib/tools/tool-handlers';
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

function addQuestionToStore(id: number, description: string) {
  testStore.dispatch(addFile({
    id,
    name: 'Replace Question',
    path: `/org/replace-question-${id}`,
    type: 'question' as const,
    content: {
      description,
      query: 'SELECT 1',
      connection_name: 'static',
      vizSettings: { type: 'table', xCols: [], yCols: [] },
    },
    references: [],
    draft: true,
    version: 1,
    last_edit_id: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  }));
}

beforeEach(() => {
  testStore = makeStore();
  // Auto-execute + review network calls fail (best-effort paths) — the edit still stages.
  vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));
});
afterEach(() => vi.unstubAllGlobals());

describe('EditFile — replaceAll default', () => {
  it('FAILS atomically when oldMatch is not unique and replaceAll is omitted', async () => {
    addQuestionToStore(401, 'foo bar foo');
    const res = await executeToolCall(tool('EditFile', {
      fileId: '401',
      changes: [{ oldMatch: 'foo', newMatch: 'qux' }],
    }), { conversationID: 'c1' } as any);

    const content = parse(res);
    expect(content.success).toBe(false);
    expect(content.error).toMatch(/not unique/);
    // Guidance: extend the match OR pass replaceAll: true deliberately.
    expect(content.error).toMatch(/replaceAll/);
    expect(content.failedIndex).toBe(0);
    // Atomic: nothing applied.
    const after = selectMergedContent(testStore.getState(), 401) as any;
    expect(after.description).toBe('foo bar foo');
  });

  it('replaces a unique match when replaceAll is omitted', async () => {
    addQuestionToStore(402, 'a single target');
    const res = await executeToolCall(tool('EditFile', {
      fileId: '402',
      changes: [{ oldMatch: 'a single target', newMatch: 'the new text' }],
    }), { conversationID: 'c1' } as any);

    const content = parse(res);
    expect(content.success).toBe(true);
    const after = selectMergedContent(testStore.getState(), 402) as any;
    expect(after.description).toBe('the new text');
  });

  it('replaceAll: true replaces every occurrence and reports the count', async () => {
    addQuestionToStore(403, 'foo bar foo');
    const res = await executeToolCall(tool('EditFile', {
      fileId: '403',
      changes: [{ oldMatch: 'foo', newMatch: 'qux', replaceAll: true }],
    }), { conversationID: 'c1' } as any);

    const content = parse(res);
    expect(content.success).toBe(true);
    expect(JSON.stringify(content.replaceNotes)).toMatch(/2 occurrences/);
    const after = selectMergedContent(testStore.getState(), 403) as any;
    expect(after.description).toBe('qux bar qux');
  });
});
