/**
 * EditFile freezes workspace viz-recipe references at APPLY time: the staged
 * content carries the substituted spec (so the chart renders before any save),
 * and an unresolvable reference rejects atomically with the available catalog —
 * the in-loop feedback that lets the agent self-correct a bad name.
 */
import { getTestDbPath, initTestDatabase, cleanupTestDatabase } from './test-utils';
import { readFiles } from '@/lib/file-state/file-state';
import { fileToMarkup } from '@/lib/data/story/file-markup';
import { selectMergedContent } from '@/store/filesSlice';
import { executeToolCall } from '@/lib/tools/tool-handlers';
import { configureStore } from '@reduxjs/toolkit';
import filesReducer from '../filesSlice';
import queryResultsReducer from '../queryResultsSlice';
import authReducer from '../authSlice';
import uiReducer from '../uiSlice';
import { NextRequest } from 'next/server';
import { POST as batchPostHandler } from '@/app/api/files/batch/route';
import { GET as filesGetHandler } from '@/app/api/files/route';
import { DocumentDB } from '@/lib/database/documents-db';
import { getModules } from '@/lib/modules/registry';
import type { QuestionContent } from '@/lib/types';
import type { VizRecipeContent, VizSourceVegaLite } from '@/lib/validation/atlas-schemas';

let testStore: any;
vi.mock('@/store/store', () => ({
  get store() { return testStore; },
  getStore: () => testStore,
}));

const SHARED_DB_PATH = getTestDbPath('editfile_viz_recipe_freeze');

beforeAll(async () => {
  await initTestDatabase(SHARED_DB_PATH);
  global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : url.toString();
    const fullUrl = urlStr.startsWith('http') ? urlStr : `http://localhost:3000${urlStr}`;
    if (urlStr.includes('/api/files/batch')) {
      const request = new NextRequest(fullUrl, { method: 'POST', ...init, headers: { ...init?.headers, 'x-user-id': '1' } } as any);
      const response = await batchPostHandler(request as NextRequest);
      const data = await response.json();
      return { ok: response.status === 200, status: response.status, json: async () => data } as Response;
    }
    if (urlStr.includes('/api/files?')) {
      const request = new NextRequest(fullUrl, { method: 'GET', headers: { 'x-user-id': '1' } } as any);
      const response = await filesGetHandler(request as NextRequest);
      const data = await response.json();
      return { ok: response.status === 200, status: response.status, json: async () => data } as Response;
    }
    if (urlStr.includes('/api/viz/validate')) {
      // validate-remote fails open by contract; keep the test hermetic.
      return { ok: true, status: 200, json: async () => ({ ok: true, issues: [] }) } as Response;
    }
    throw new Error(`Unmocked fetch call to ${urlStr}`);
  });
});
afterAll(async () => {
  vi.restoreAllMocks();
  await cleanupTestDatabase(SHARED_DB_PATH);
});

const KPI_RECIPE: VizRecipeContent = {
  description: 'Simple KPI bar',
  engine: 'vega-lite',
  bindings: [
    { name: 'label', label: 'Label', accepts: ['nominal'] },
    { name: 'value', label: 'Value', accepts: ['quantitative'] },
  ],
  template: {
    mark: 'bar',
    encoding: {
      x: { field: '{{label}}', type: '{{label:kind}}' },
      y: { field: '{{value}}', type: 'quantitative' },
    },
  },
};

const QUESTION: QuestionContent = {
  description: null,
  query: 'SELECT team AS label, revenue AS value FROM t',
  vizSettings: null,
  parameters: null,
  parameterValues: null,
  connection_name: '',
  cachePolicy: null,
  semanticQuery: null,
  viz: {
    version: 2,
    source: { kind: 'table', columnFormats: null, conditionalFormats: null, css: null },
  },
} as unknown as QuestionContent;

describe('EditFile viz-recipe freeze at apply', () => {
  let questionId: number;

  beforeEach(async () => {
    await getModules().db.exec("DELETE FROM files WHERE path != '/org'", []);
    const recipeId = await DocumentDB.create('kpi-bar', '/org/kpi-bar', 'viz', KPI_RECIPE as never, []);
    await DocumentDB.update(recipeId, 'kpi-bar', '/org/kpi-bar', KPI_RECIPE as never, [], 'publish-recipe');
    questionId = await DocumentDB.create('q1', '/org/q1', 'question', QUESTION as never, []);
    await DocumentDB.update(questionId, 'q1', '/org/q1', QUESTION as never, [], 'publish-q');
    testStore = configureStore({ reducer: { files: filesReducer, queryResults: queryResultsReducer, auth: authReducer, ui: uiReducer } });
    vi.clearAllMocks();
  });
  afterEach(() => { testStore = null; });

  // The agent-facing markup forms: the envelope renders as nested elements
  // (schema-driven), with record fields like bindings as JSON leaves.
  const RECIPE_VIZ = [
    '<viz>',
    '  <version>2</version>',
    '  <source>',
    '    <kind>recipe</kind>',
    '    <recipe>kpi-bar</recipe>',
    '    <bindings>{{"label":"label","value":"value"}}</bindings>',
    '  </source>',
    '</viz>',
  ].join('\n');

  /** The exact <viz> block as the agent-facing markup renders it (the edit surface). */
  const currentVizMarkup = (): string => {
    const markup = fileToMarkup('question', QUESTION);
    const block = markup.match(/<viz>[\s\S]*?<\/viz>/)?.[0];
    if (!block) throw new Error(`no <viz> block in markup:\n${markup}`);
    return block;
  };

  it('stages a FROZEN source when the edit references a recipe by name', async () => {
    await readFiles([questionId]);
    const result = await executeToolCall(
      { id: 'c1', type: 'function', function: { name: 'EditFile', arguments: {
        fileId: questionId,
        changes: [{ oldMatch: currentVizMarkup(), newMatch: RECIPE_VIZ }],
      } } } as any,
    );
    const text = Array.isArray(result.content)
      ? (result.content.find((b: any) => b.type === 'text') as any).text
      : String(result.content);
    expect(text).not.toContain('"success": false');

    const merged = selectMergedContent(testStore.getState(), questionId) as QuestionContent;
    const source = merged.viz!.source as VizSourceVegaLite;
    expect(source.kind).toBe('vega-lite');
    expect((source.spec.encoding as any).x.field).toBe('label');
    expect(source.detachedFrom).toMatchObject({ kind: 'recipe', recipe: '/org/kpi-bar' });
  });

  it('rejects an unresolvable recipe name atomically, listing the catalog', async () => {
    await readFiles([questionId]);
    const bad = await executeToolCall(
      { id: 'c3', type: 'function', function: { name: 'EditFile', arguments: {
        fileId: questionId,
        changes: [{ oldMatch: currentVizMarkup(), newMatch: RECIPE_VIZ.replace('kpi-bar', 'no-such-recipe') }],
      } } } as any,
    );
    const text = Array.isArray(bad.content)
      ? (bad.content.find((b: any) => b.type === 'text') as any).text
      : typeof bad.content === 'string' ? bad.content : JSON.stringify(bad.content);
    expect(text).toContain('no-such-recipe');
    expect(text).toContain('kpi-bar'); // the available catalog names the workspace recipe

    // The edit did NOT stage — the merged content still renders the table.
    const merged = selectMergedContent(testStore.getState(), questionId) as QuestionContent;
    expect(merged.viz!.source.kind).toBe('table');
  });
});
