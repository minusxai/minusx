/**
 * EditFile `review` flag — the post-edit review (screenshot + LLM visual judge) runs by
 * DEFAULT, but the agent can pass review:false on intermediate edits of a planned batch to
 * skip the expensive capture+judge round. Skipping never drops feedback entirely: the free
 * deterministic rubric is still attached.
 */
import { configureStore } from '@reduxjs/toolkit';
import filesReducer, { setFile } from '@/store/filesSlice';
import authReducer from '@/store/authSlice';
import uiReducer from '@/store/uiSlice';
import queryResultsReducer from '@/store/queryResultsSlice';
import type { DbFile, ToolCall, UserRole } from '@/lib/types';
import type { Mode } from '@/lib/mode/mode-types';

let testStore: any;
vi.mock('@/store/store', () => ({
  get store() { return testStore; },
  getStore: () => testStore,
}));

// Spy on the review core: `reviewFile` is the expensive full review (capture + judge);
// `deterministicAgentRubric` is the free rules-only fallback.
vi.mock('@/lib/tools/handlers/file-review', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/tools/handlers/file-review')>();
  return {
    ...real,
    reviewFile: vi.fn(async (fileId: number) => ({ rubric: real.deterministicAgentRubric(fileId), reviewMode: 'full' as const, screenshotUrl: 'https://x/s.jpg' })),
  };
});

import { executeToolCall } from '@/lib/tools/tool-handlers';
import { reviewFile } from '@/lib/tools/handlers/file-review';

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

const tool = (args: Record<string, any>): ToolCall => ({ id: 't', type: 'function', function: { name: 'EditFile', arguments: args } });
const parse = (r: { content: any }) => JSON.parse((r.content as any[]).find((b: any) => b?.type === 'text').text);

describe('EditFile — review flag', () => {
  beforeEach(() => {
    vi.mocked(reviewFile).mockClear();
    testStore = makeStore();
    testStore.dispatch(setFile({ file: {
      id: 88, name: 'S', path: '/org/s', type: 'story',
      content: { description: 'd', story: '<div class="s" style={{padding:"0 48px"}}><h1>T</h1><Question id={5} /></div>', suggestedQuestions: null, colorMode: null, parameterValues: null },
    } as unknown as DbFile }));
  });

  it('runs the full review by default', async () => {
    const out = parse(await executeToolCall(tool({ fileId: 88, changes: [{ oldMatch: '<h1>T</h1>', newMatch: '<h1>Title</h1>' }] })));
    expect(out.success).toBe(true);
    expect(reviewFile).toHaveBeenCalledTimes(1);
  });

  it('review:false skips the capture+judge but still attaches the deterministic rubric', async () => {
    const out = parse(await executeToolCall(tool({ fileId: 88, review: false, changes: [{ oldMatch: '<h1>T</h1>', newMatch: '<h1>Title</h1>' }] })));
    expect(out.success).toBe(true);
    expect(reviewFile).not.toHaveBeenCalled();
    expect(out.rubric).toBeDefined(); // rules-only feedback is free — never dropped
  });
});
