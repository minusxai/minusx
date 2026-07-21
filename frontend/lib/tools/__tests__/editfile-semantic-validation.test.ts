/**
 * EditFile semantic-model validation (Semantic_Model_v2.md §3 — the agent loop):
 * an EditFile on a CONTEXT runs tiers 1–2 over every authored semantic model the
 * edit would leave staged-but-unsaved, and REJECTS the edit atomically with the
 * issue LIST in the tool result, so the agent self-corrects in-loop instead of
 * discovering the breakage at Publish (where the gate flattens the issues into
 * one human-facing string).
 *
 * Tier 3 (the warehouse `LIMIT 0` dry-run) is deliberately NOT part of this path —
 * it needs connector + server access and the save gate owns it.
 *
 * Scope rule under test: models are checked against the file's SAVED content, so
 * only models the author (agent EditFile markup, or the editor UI staging into
 * Redux) has added/changed since the last publish can block. A model that is
 * merely stale-vs-warehouse never makes an unrelated docs edit un-appliable.
 */
import { configureStore } from '@reduxjs/toolkit';
import filesReducer, { addFile, setEdit, selectMergedContent } from '@/store/filesSlice';
import authReducer from '@/store/authSlice';
import uiReducer from '@/store/uiSlice';
import queryResultsReducer from '@/store/queryResultsSlice';
import { executeToolCall } from '@/lib/tools/tool-handlers';
import type { ContextContent, SemanticModelV2, ToolCall, UserRole } from '@/lib/types';
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

// The exposed schema menu the loader computes onto a context's content — what
// tier 1 resolves sources/columns against.
const FULL_SCHEMA = [{
  databaseName: 'warehouse',
  schemas: [{
    schema: 'mxfood',
    tables: [{ table: 'orders', columns: [{ name: 'zone_name', type: 'VARCHAR' }, { name: 'total', type: 'DOUBLE' }] }],
  }],
}];

const DOC_TEXT = 'Zones are delivery areas.';

const validModel = (overrides: Partial<SemanticModelV2> = {}): SemanticModelV2 => ({
  name: 'Orders',
  connection: 'warehouse',
  primary: { kind: 'table', schema: 'mxfood', table: 'orders' },
  dimensions: [{ name: 'Zone', source: 'primary', column: 'zone_name' }],
  measures: [{ name: 'Revenue', agg: 'SUM', column: 'total' }],
  metrics: [{ name: 'Total Revenue', type: 'sql', sql: 'SUM(primary.total)' }],
  ...overrides,
} as SemanticModelV2);

/** (a) dimension on a column the whitelist does not expose, (b) unqualified bare metric ref. */
const brokenModel = (): SemanticModelV2 => validModel({
  dimensions: [{ name: 'Zone', source: 'primary', column: 'nope_col' }],
  metrics: [{ name: 'Total Revenue', type: 'sql', sql: 'SUM(total)' }],
});

const contextContent = (models: SemanticModelV2[]): ContextContent => ({
  versions: [{
    version: 1,
    whitelist: [{ name: 'warehouse', type: 'connection' }],
    docs: [{ content: DOC_TEXT, title: 'Zones', description: 'zone doc' }],
    semanticModels: models,
    createdAt: '2024-01-01T00:00:00Z',
    createdBy: 1,
  }],
  published: { all: 1 },
  fullSchema: FULL_SCHEMA,
} as unknown as ContextContent);

function addContextToStore(id: number, saved: ContextContent) {
  testStore.dispatch(addFile({
    id,
    name: 'Context',
    path: '/org/context',
    type: 'context' as const,
    content: saved as any,
    references: [],
    draft: false,
    version: 1,
    last_edit_id: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  }));
}

/** Stage a models change the way the editor UI (and, once the markup carries them, EditFile) does. */
function stageModels(id: number, saved: ContextContent, models: SemanticModelV2[]) {
  const versions = (saved.versions ?? []).map((v) => ({ ...v, semanticModels: models }));
  testStore.dispatch(setEdit({ fileId: id as any, edits: { versions } as any }));
}

const editDoc = (id: number) => executeToolCall(tool('EditFile', {
  fileId: String(id),
  changes: [{ oldMatch: DOC_TEXT, newMatch: 'Zones are delivery zones.', replaceAll: false }],
}), { conversationID: 'c1' } as any);

beforeEach(() => {
  testStore = makeStore();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));
});
afterEach(() => vi.unstubAllGlobals());

describe('EditFile — inline semantic-model validation (tiers 1–2)', () => {
  it('REJECTS an edit that leaves a broken semantic model staged, with the ISSUES as an array', async () => {
    const saved = contextContent([validModel()]);
    addContextToStore(401, saved);
    stageModels(401, saved, [brokenModel()]);

    // Setup guard: the broken model really is what the edit would leave staged.
    const staged = selectMergedContent(testStore.getState(), 401) as any;
    expect(staged.versions[0].semanticModels[0].dimensions[0].column).toBe('nope_col');

    const res = await editDoc(401);
    const content = parse(res);

    expect(content.success).toBe(false);
    expect(Array.isArray(content.semanticIssues)).toBe(true);
    // (a) unexposed dimension column and (b) unqualified bare metric ref — BOTH reported.
    expect(content.semanticIssues.some((i: string) => /nope_col/.test(i))).toBe(true);
    expect(content.semanticIssues.some((i: string) => /"total"/.test(i) && /qualif|ambiguous/i.test(i))).toBe(true);
    // Every issue names its model, like the save gate's.
    expect(content.semanticIssues.every((i: string) => i.includes('Orders'))).toBe(true);
    expect(content.error).toContain('nope_col');

    // Atomic: the docs edit was NOT applied.
    const after = selectMergedContent(testStore.getState(), 401) as any;
    expect(after.versions[0].docs[0].content).toBe(DOC_TEXT);
  });

  it('accepts an edit whose staged semantic model is VALID (and applies it)', async () => {
    const saved = contextContent([validModel()]);
    addContextToStore(402, saved);
    // Changed vs saved (so it IS validated) but valid: one more well-formed metric.
    stageModels(402, saved, [validModel({
      metrics: [
        { name: 'Total Revenue', type: 'sql', sql: 'SUM(primary.total)' },
        { name: 'Order Count', type: 'sql', sql: 'COUNT(primary.zone_name)' },
      ],
    })]);

    const res = await editDoc(402);
    const content = parse(res);

    expect(content.success).toBe(true);
    expect(content.semanticIssues).toBeUndefined();
    const after = selectMergedContent(testStore.getState(), 402) as any;
    expect(after.versions[0].docs[0].content).toBe('Zones are delivery zones.');
  });

  it('does NOT block on a model that is unchanged since the last save (drift is the save gate\'s call)', async () => {
    // A broken model already SAVED (e.g. the warehouse dropped the column) must not
    // make an unrelated docs edit un-appliable — the agent could never get unstuck.
    addContextToStore(403, contextContent([brokenModel()]));

    const res = await editDoc(403);
    const content = parse(res);

    expect(content.success).toBe(true);
    const after = selectMergedContent(testStore.getState(), 403) as any;
    expect(after.versions[0].docs[0].content).toBe('Zones are delivery zones.');
    // …but the agent still LEARNS about it, through the non-blocking validation channel
    // (the same one that carries the schema check + story/dashboard lints).
    expect(content.validation?.some((v: string) => /nope_col/.test(v))).toBe(true);
  });
});
