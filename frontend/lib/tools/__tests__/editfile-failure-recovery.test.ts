/**
 * EditFile failure recovery: the agent's app-state markup is a TURN-START snapshot that is never
 * refreshed between tool calls, so the 2nd+ edit in a multi-edit turn routinely fails exact-match
 * against stale markup. The failure response must return the file's CURRENT markup so the agent
 * can rebuild `oldMatch` without a ReadFiles round-trip (which the tool description discourages).
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
    content: { description: 'original words', assets: [], layout: { columns: 12, items: [] } },
    references: [],
    draft: true,
    version: 1,
    last_edit_id: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  }));
}

function addStoryToStore(id: number, story = '') {
  testStore.dispatch(addFile({
    id,
    name: 'Test Story',
    path: `/org/test-story-${id}`,
    type: 'story' as const,
    content: { description: '', story, suggestedQuestions: [] },
    references: [],
    draft: true,
    version: 1,
    last_edit_id: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  }));
}

describe('EditFile — match-failure response carries the CURRENT markup', () => {
  beforeEach(() => { testStore = makeStore(); });

  it('returns currentMarkup on a not-found oldMatch so the agent can rebuild the edit', async () => {
    const dashId = 201;
    addDashboardToStore(dashId);

    const res = await executeToolCall(tool('EditFile', {
      fileId: dashId,
      changes: [{ oldMatch: '<description>stale snapshot text</description>', newMatch: '<description>new</description>' }],
    }));

    const parsed = parse(res);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('not found');
    expect(parsed.error).toContain('No changes were applied');
    expect(parsed.currentMarkup).toContain('<description>original words</description>');
  });

  it('the stale-snapshot flow: after edit 1 lands, a stale oldMatch in edit 2 fails WITH fresh markup that reflects edit 1', async () => {
    const dashId = 202;
    addDashboardToStore(dashId);

    // Edit 1 (succeeds): the agent rewrites the description.
    const first = await executeToolCall(tool('EditFile', {
      fileId: dashId,
      changes: [{ oldMatch: '<description>original words</description>', newMatch: '<description>rewritten by edit one</description>' }],
    }));
    expect(parse(first).success).toBe(true);

    // Edit 2 (fails): the agent still matches against its turn-start snapshot ("original words").
    const second = await executeToolCall(tool('EditFile', {
      fileId: dashId,
      changes: [{ oldMatch: '<description>original words</description>', newMatch: '<description>rewritten again</description>' }],
    }));
    const parsed = parse(second);
    expect(parsed.success).toBe(false);
    // Recovery: the failure carries markup reflecting edit 1, so the agent's next attempt can match.
    expect(parsed.currentMarkup).toContain('rewritten by edit one');
    expect(parsed.currentMarkup).not.toContain('original words');
  });

  it('failure at change 2 of 3 applies NOTHING (atomic) and currentMarkup is the true pre-edit file', async () => {
    const dashId = 203;
    addDashboardToStore(dashId);

    const res = await executeToolCall(tool('EditFile', {
      fileId: dashId,
      changes: [
        { oldMatch: '<description>original words</description>', newMatch: '<description>changed</description>' },
        { oldMatch: 'this does not exist anywhere', newMatch: 'x' },
      ],
    }));

    const parsed = parse(res);
    expect(parsed.success).toBe(false);
    expect(parsed.failedIndex).toBe(1);
    // Atomicity: change 1 must NOT appear in the returned markup nor in the store.
    expect(parsed.currentMarkup).toContain('original words');
    expect(parsed.currentMarkup).not.toContain('changed');
    const content = selectMergedContent(testStore.getState(), dashId) as any;
    expect(content.description).toBe('original words');
  });
});

describe('EditFile — story edits tolerate HTML-isms (lenient parse retry)', () => {
  beforeEach(() => { testStore = makeStore(); });

  it('accepts a story body containing HTML comments, unclosed <br>, and a stray < in prose', async () => {
    const storyId = 301;
    addStoryToStore(storyId);

    const res = await executeToolCall(tool('EditFile', {
      fileId: storyId,
      changes: [{
        oldMatch: '<story></story>',
        newMatch: [
          '<story>',
          '<div class="story-x">',
          '  <!-- HERO -->',
          '  <h1>Churn < 5% for the first time</h1>',
          '  <p>line one<br>line two</p>',
          '</div>',
          '</story>',
        ].join('\n'),
      }],
    }));

    const parsed = parse(res);
    expect(parsed.success).toBe(true);
    const content = selectMergedContent(testStore.getState(), storyId) as any;
    expect(content.story).toContain('Churn');
    expect(content.story).toContain('line two');
  });
});
