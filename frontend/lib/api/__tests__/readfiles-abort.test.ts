/**
 * ReadFiles must thread the conversation's abort signal into its query auto-execution.
 * Without it, Stop cannot cancel a ReadFiles that is waiting on many uncached queries
 * (up to 2 × 120s semaphore waves on a wide dashboard) — the reported "ReadFiles hangs".
 */
import { configureStore } from '@reduxjs/toolkit';
import filesReducer from '@/store/filesSlice';
import authReducer from '@/store/authSlice';
import uiReducer from '@/store/uiSlice';
import queryResultsReducer from '@/store/queryResultsSlice';
import type { ToolCall, UserRole } from '@/lib/types';
import type { Mode } from '@/lib/mode/mode-types';

let testStore: any;
vi.mock('@/store/store', () => ({
  get store() { return testStore; },
  getStore: () => testStore,
}));

const { readFilesSpy } = vi.hoisted(() => ({ readFilesSpy: vi.fn(async () => []) }));
vi.mock('@/lib/api/file-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/file-state')>();
  return { ...actual, readFiles: readFilesSpy };
});

import { executeToolCall } from '@/lib/api/tool-handlers';

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

describe('ReadFiles — abort signal threading', () => {
  beforeEach(() => {
    testStore = makeStore();
    readFilesSpy.mockClear();
  });

  it('forwards the conversation abort signal into readFiles (so Stop cancels query waits)', async () => {
    const controller = new AbortController();
    await executeToolCall(tool('ReadFiles', { fileIds: [1, 2] }), undefined, controller.signal, testStore.getState());

    expect(readFilesSpy).toHaveBeenCalledTimes(1);
    const [, options] = readFilesSpy.mock.calls[0] as unknown as [number[], { runQueries?: boolean; signal?: AbortSignal }];
    expect(options.runQueries).toBe(true);
    expect(options.signal).toBe(controller.signal);
  });
});
