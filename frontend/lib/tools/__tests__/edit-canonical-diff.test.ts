/**
 * EditFile must show the agent the CANONICAL applied edit, not its own input echoed back.
 *
 * The round trip (markup → content → markup) normalizes what the agent wrote (class-prop
 * whitespace collapse, attribute escaping/ordering). The diff used to be computed against the
 * agent's replacement text — hiding the normalization — so the agent's next oldMatch, built
 * from its memory of newMatch, missed the stored form and edits failed in a retry/rewrite loop
 * (worst on immersive/Tailwind stories). The diff must show the stored canonical text, and the
 * response must say when the applied text was normalized.
 */
import { configureStore } from '@reduxjs/toolkit';
import filesReducer, { setFile } from '@/store/filesSlice';
import authReducer from '@/store/authSlice';
import uiReducer from '@/store/uiSlice';
import queryResultsReducer from '@/store/queryResultsSlice';
import { executeToolCall } from '@/lib/tools/tool-handlers';
import type { DbFile, ToolCall, UserRole } from '@/lib/types';
import type { Mode } from '@/lib/mode/mode-types';

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

const tool = (args: Record<string, any>): ToolCall => ({ id: 't', type: 'function', function: { name: 'EditFile', arguments: args } });

function parse(result: { content: any }): Record<string, any> {
  const raw = result.content;
  if (Array.isArray(raw)) return JSON.parse(raw.find((b: any) => b?.type === 'text').text);
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

// A design-system story (data-design="tw") — component class props are whitespace-collapsed by
// the codec, so an agent-authored double space normalizes away in the stored markup.
const STORY_HTML = '<div data-design="tw" class="@container mx-auto px-6"><h1>T</h1><div data-c="Callout" data-tone="info" class="rounded-xl border-l-4 p-4 my-4 border-blue-500 bg-blue-50 dark:bg-blue-950/40" data-cls="mt-6">Old note</div></div>';

describe('EditFile — canonical applied-edit feedback', () => {
  beforeEach(() => {
    testStore = makeStore();
    testStore.dispatch(setFile({ file: {
      id: 77, name: 'S', path: '/org/s', type: 'story',
      content: { description: 'd', story: STORY_HTML, suggestedQuestions: null, colorMode: null, parameterValues: null },
    } as unknown as DbFile }));
  });

  it('diffs against the canonical stored markup and flags normalization', async () => {
    // The agent writes a Callout with a DOUBLE space in the class prop — the codec collapses it.
    const res = await executeToolCall(tool({
      fileId: 77,
      changes: [{ oldMatch: '<Callout tone="info" class="mt-6">Old note</Callout>', newMatch: '<Callout tone="info" class="mt-8  bg-white">New note</Callout>' }],
    }));
    const out = parse(res);
    expect(out.success).toBe(true);
    // The diff shows the CANONICAL form (single space), not the agent's double-spaced input.
    expect(out.diff).toContain('class="mt-8 bg-white"');
    expect(out.diff).not.toContain('mt-8  bg-white');
    // And the response says the applied text was normalized, so the agent anchors on the diff.
    expect(String(out.editNote ?? '')).toMatch(/normali[sz]ed/i);
  });

  it('does not add the note when the applied text is already canonical', async () => {
    const res = await executeToolCall(tool({
      fileId: 77,
      changes: [{ oldMatch: 'Old note', newMatch: 'Fresh note' }],
    }));
    const out = parse(res);
    expect(out.success).toBe(true);
    expect(out.diff).toContain('Fresh note');
    expect(out.editNote).toBeUndefined();
  });
});
