/**
 * LIVE recipe references. A question stores only the reference
 * ({kind:'recipe', recipe, bindings}) — never a frozen spec — and the file
 * LOADER materializes it at read time (computed fields, stripped on save):
 *  - editing the recipe file changes every referencing chart on next load;
 *  - deleting it degrades the chart to an UNRESOLVED marker (the UI renders a
 *    table fallback) while the stored reference survives — restore the file
 *    and the chart comes back;
 *  - an unknown reference is still rejected AT SAVE with the catalog (typo
 *    feedback), because "will never resolve" and "stopped resolving" differ.
 * Resolution is SYSTEM-scoped (DocumentDB), not viewer-scoped: anyone who can
 * see the chart sees it rendered, share guests included.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FilesAPI } from '@/lib/data/files.server';
import { initTestDatabase, cleanupTestDatabase, getTestDbPath } from '@/store/__tests__/test-utils';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { QuestionContent, NotebookContent } from '@/lib/types';
import type { VizRecipeContent, VizSourceRecipe } from '@/lib/validation/atlas-schemas';

const TEST_DB_PATH = getTestDbPath('viz-recipe-reference');

const user: EffectiveUser = {
  userId: 1, name: 'Test User', email: 'test@example.com',
  role: 'admin', mode: 'org', home_folder: '',
};

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

const question = (viz: unknown): QuestionContent => ({
  description: null,
  query: 'SELECT team AS label, revenue AS value FROM t',
  vizSettings: null, parameters: null, parameterValues: null,
  connection_name: '', cachePolicy: null, semanticQuery: null,
  viz: viz as QuestionContent['viz'],
}) as QuestionContent;

const recipeViz = (recipe: string, bindings: Record<string, string | string[]>) => ({
  version: 2,
  source: { kind: 'recipe', recipe, bindings, params: null, columnFormats: null },
  dataBindings: null, viewParams: null, interactions: null, assets: null,
});

type LoadedSource = VizSourceRecipe & {
  spec?: Record<string, unknown>;
  grammar?: string;
  unresolved?: string;
};

const loadSource = async (id: number): Promise<LoadedSource> => {
  const { data } = await FilesAPI.loadFiles([id], user);
  return (data[0].content as QuestionContent).viz!.source as unknown as LoadedSource;
};

describe('live viz recipe references', () => {
  let recipeId: number;
  let questionId: number;

  const publishRecipe = async (path: string, content: VizRecipeContent): Promise<number> => {
    const name = path.slice(path.lastIndexOf('/') + 1);
    const created = await FilesAPI.createFile({ name, path, type: 'viz', content }, user);
    await FilesAPI.saveFile(created.data.id, name, path, content as never, [], user);
    return created.data.id;
  };

  beforeAll(async () => {
    await initTestDatabase(TEST_DB_PATH);
    recipeId = await publishRecipe('/org/kpi-bar', KPI_RECIPE);
    const created = await FilesAPI.createFile(
      { name: 'q1', path: '/org/q1', type: 'question', content: question(recipeViz('kpi-bar', { label: 'label', value: 'value' })) },
      user,
    );
    questionId = created.data.id;
    await FilesAPI.saveFile(questionId, 'q1', '/org/q1',
      question(recipeViz('kpi-bar', { label: 'label', value: 'value' })) as never, [], user);
  });

  afterAll(async () => {
    await cleanupTestDatabase(TEST_DB_PATH);
  });

  it('stores the REFERENCE (no frozen spec) and the loader materializes at read', async () => {
    const source = await loadSource(questionId);
    // Stored + loaded shape: still the reference…
    expect(source.kind).toBe('recipe');
    expect(source.recipe).toBe('kpi-bar');
    expect(source.bindings).toEqual({ label: 'label', value: 'value' });
    // …with the COMPUTED materialization attached for rendering.
    expect(source.spec).toBeDefined();
    expect((source.spec!.encoding as Record<string, { field: string }>).x.field).toBe('label');
    expect(source.grammar).toBe('vega-lite@6');
  });

  it('editing the recipe changes the referencing chart on next load', async () => {
    await FilesAPI.saveFile(recipeId, 'kpi-bar', '/org/kpi-bar',
      { ...KPI_RECIPE, template: { ...KPI_RECIPE.template, mark: 'line' } } as never, [], user);
    const source = await loadSource(questionId);
    expect(source.spec!.mark).toBe('line'); // the LIVE update
  });

  it('re-saving the question persists the reference, never the computed spec', async () => {
    // Round-trip what a client would send back (computed fields included).
    const loaded = await FilesAPI.loadFiles([questionId], user);
    await FilesAPI.saveFile(questionId, 'q1', '/org/q1', loaded.data[0].content as never, [], user);
    const { getModules } = await import('@/lib/modules/registry');
    const row = await getModules().db.exec<{ content: unknown }>(
      'SELECT content FROM files WHERE id = $1', [questionId]);
    const raw = typeof row.rows[0].content === 'string' ? JSON.parse(row.rows[0].content as string) : row.rows[0].content;
    const storedSource = raw.viz.source;
    expect(storedSource.kind).toBe('recipe');
    expect(storedSource.spec).toBeUndefined();
    expect(storedSource.grammar).toBeUndefined();
    expect(storedSource.unresolved).toBeUndefined();
  });

  it('deleting the recipe leaves the reference with an UNRESOLVED marker (UI table fallback)', async () => {
    const ephemeralId = await publishRecipe('/org/ephemeral', KPI_RECIPE);
    const created = await FilesAPI.createFile(
      { name: 'q2', path: '/org/q2', type: 'question', content: question(recipeViz('ephemeral', { label: 'label', value: 'value' })) },
      user,
    );
    await FilesAPI.deleteFile(ephemeralId, user);
    const source = await loadSource(created.data.id);
    expect(source.kind).toBe('recipe');
    expect(source.recipe).toBe('ephemeral');   // the reference SURVIVES
    expect(source.spec).toBeUndefined();
    expect(source.unresolved).toBeTruthy();

    // Restore the recipe under the same name — the chart comes back.
    await publishRecipe('/org/ephemeral', KPI_RECIPE);
    const restored = await loadSource(created.data.id);
    expect(restored.spec).toBeDefined();
    expect(restored.unresolved).toBeUndefined();
  });

  it('still REJECTS an unknown reference at save, listing the catalog', async () => {
    await expect(FilesAPI.createFile(
      { name: 'q-bad', path: '/org/q-bad', type: 'question', content: question(recipeViz('no-such-recipe', { label: 'label', value: 'value' })) },
      user,
    )).rejects.toThrow(/no-such-recipe[\s\S]*kpi-bar/);
  });

  it('materializes references inside notebook SQL cells too', async () => {
    const notebook = {
      description: null,
      cells: [{
        type: 'sql', id: 'c1', name: null,
        query: 'SELECT team AS label, revenue AS value FROM t',
        parameters: null, parameterValues: null, connection_name: '',
        viz: recipeViz('kpi-bar', { label: 'label', value: 'value' }),
      }],
    } as unknown as NotebookContent;
    const created = await FilesAPI.createFile(
      { name: 'nb', path: '/org/nb', type: 'notebook', content: notebook }, user,
    );
    const { data } = await FilesAPI.loadFiles([created.data.id], user);
    const cell = (data[0].content as NotebookContent).cells[0] as { viz?: { source: LoadedSource } };
    expect(cell.viz!.source.kind).toBe('recipe');
    expect(cell.viz!.source.spec).toBeDefined();
  });
});
