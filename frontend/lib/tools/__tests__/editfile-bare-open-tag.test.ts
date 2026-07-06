/**
 * Regression: EditFile with oldMatch="<description>" (bare opening tag) and
 * newMatch="<description>text</description>" (full element) on a fresh dashboard
 * leaves the original </description> dangling → double closing tag → JSX parse error.
 *
 * Fix: the handler auto-expands a bare opening-tag oldMatch to include the current
 * element content up to the first matching closing tag, so the replacement is correct.
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

function addDashboardToStore(id: number) {
  testStore.dispatch(addFile({
    id,
    name: 'Test Dashboard',
    path: `/org/test-dashboard-${id}`,
    type: 'dashboard' as const,
    content: { description: '', assets: [], layout: { columns: 12, items: [] } },
    references: [],
    draft: true,
    version: 1,
    last_edit_id: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  }));
}

describe('EditFile — bare opening-tag oldMatch auto-expand', () => {
  beforeEach(() => { testStore = makeStore(); });

  it('succeeds when oldMatch is just the opening tag but newMatch is a full element (auto-expands to include closing tag)', async () => {
    const dashId = 101;
    addDashboardToStore(dashId);

    const res = await executeToolCall(tool('EditFile', {
      fileId: dashId,
      changes: [
        {
          oldMatch: '<description>',
          newMatch: '<description>My dashboard description</description>',
        },
      ],
    }));

    const parsed = parse(res);
    expect(parsed.success).toBe(true);
    // Model is informed of the correction so it can learn the correct pattern
    expect(parsed.autoCorrections).toHaveLength(1);
    expect(parsed.autoCorrections[0]).toContain('<description>');
    expect(parsed.autoCorrections[0]).toContain('auto-expanded');

    const content = selectMergedContent(testStore.getState(), dashId) as any;
    expect(content.description).toBe('My dashboard description');
  });

  it('handles bare opening-tag when the field already has text content', async () => {
    const dashId = 102;
    addDashboardToStore(dashId);

    // First give it a description via correct full-element match
    await executeToolCall(tool('EditFile', {
      fileId: dashId,
      changes: [{ oldMatch: '<description></description>', newMatch: '<description>old text</description>' }],
    }));

    // Now replace using bare opening tag (the bug pattern)
    const res = await executeToolCall(tool('EditFile', {
      fileId: dashId,
      changes: [{ oldMatch: '<description>', newMatch: '<description>new text</description>' }],
    }));

    const parsed = parse(res);
    expect(parsed.success).toBe(true);

    const content = selectMergedContent(testStore.getState(), dashId) as any;
    expect(content.description).toBe('new text');
  });

  it('still fails correctly when oldMatch genuinely does not exist in the file', async () => {
    const dashId = 103;
    addDashboardToStore(dashId);

    const res = await executeToolCall(tool('EditFile', {
      fileId: dashId,
      changes: [{ oldMatch: '<nonexistent>', newMatch: '<nonexistent>text</nonexistent>' }],
    }));

    const parsed = parse(res);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('not found');
  });

  it('handles the full dashboard assembly: description + assets + layout in one EditFile call', async () => {
    const dashId = 104;
    addDashboardToStore(dashId);

    const res = await executeToolCall(tool('EditFile', {
      fileId: dashId,
      changes: [
        {
          oldMatch: '<description>',
          newMatch: '<description>Web event overview dashboard</description>',
        },
        {
          oldMatch: '<assets/>',
          newMatch: '<assets>\n  <item><type>question</type><id>200</id></item>\n  <item><type>question</type><id>201</id></item>\n</assets>',
        },
        {
          oldMatch: '<items/>',
          newMatch: '<items>\n  <item><id>200</id><x>0</x><y>0</y><w>6</w><h>4</h></item>\n  <item><id>201</id><x>6</x><y>0</y><w>6</w><h>4</h></item>\n</items>',
        },
      ],
    }));

    const parsed = parse(res);
    expect(parsed.success).toBe(true);

    const content = selectMergedContent(testStore.getState(), dashId) as any;
    expect(content.description).toBe('Web event overview dashboard');
    expect(content.assets).toHaveLength(2);
    expect(content.assets[0].id).toBe(200);
    expect(content.layout.items).toHaveLength(2);
    expect(content.layout.items[0].id).toBe(200);
  });
});
