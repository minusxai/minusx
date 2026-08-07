/**
 * Freeze-at-use through the real save path: a question (or notebook cell) whose
 * `viz` references a workspace/built-in recipe stores the fully substituted spec
 * with provenance — never a live reference. Shipped `minusx/` recipes pass
 * through untouched. Every save flows through FilesAPI, so this is the single
 * choke point for browser tools, GUI saves, and headless agents alike.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FilesAPI } from '@/lib/data/files.server';
import { initTestDatabase, cleanupTestDatabase, getTestDbPath } from '@/store/__tests__/test-utils';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { QuestionContent, NotebookContent } from '@/lib/types';
import type { VizRecipeContent, VizSourceVegaLite } from '@/lib/validation/atlas-schemas';

const TEST_DB_PATH = getTestDbPath('viz-recipe-freeze');

const user: EffectiveUser = {
  userId: 1, name: 'Test User', email: 'test@example.com',
  role: 'admin', mode: 'org', home_folder: '',
};

/** A minimal workspace recipe used across the tests. */
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
  vizSettings: null,
  parameters: null,
  parameterValues: null,
  connection_name: '',
  cachePolicy: null,
  semanticQuery: null,
  viz: viz as QuestionContent['viz'],
}) as QuestionContent;

const recipeViz = (recipe: string, bindings: Record<string, string | string[]>) => ({
  version: 2,
  source: { kind: 'recipe', recipe, bindings, params: null, columnFormats: null },
  dataBindings: null, viewParams: null, interactions: null, assets: null,
});

const createQuestion = async (path: string, viz: unknown) => {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const created = await FilesAPI.createFile({ name, path, type: 'question', content: question(viz) }, user);
  const { data } = await FilesAPI.loadFiles([created.data.id], user);
  return { id: created.data.id, content: data[0].content as QuestionContent };
};

describe('viz recipe freeze at save', () => {
  let recipeFileId: number;

  /** Create + save (files start as drafts; only a SAVED recipe resolves). */
  const publishRecipe = async (path: string, content: VizRecipeContent): Promise<number> => {
    const name = path.slice(path.lastIndexOf('/') + 1);
    const created = await FilesAPI.createFile({ name, path, type: 'viz', content }, user);
    await FilesAPI.saveFile(created.data.id, name, path, content as never, [], user);
    return created.data.id;
  };

  beforeAll(async () => {
    await initTestDatabase(TEST_DB_PATH);
    await FilesAPI.createFile({ name: 'finance', path: '/org/finance', type: 'folder', content: {} }, user);
    recipeFileId = await publishRecipe('/org/kpi-bar', KPI_RECIPE);
    // finance's override renders a POINT instead of a bar — visibly different
    await publishRecipe('/org/finance/kpi-bar',
      { ...KPI_RECIPE, template: { ...KPI_RECIPE.template, mark: 'point' } });
  });

  afterAll(async () => {
    await cleanupTestDatabase(TEST_DB_PATH);
  });

  it('freezes a by-name reference against the question folder (root file wins at root)', async () => {
    const { content } = await createQuestion('/org/q-root', recipeViz('kpi-bar', { label: 'label', value: 'value' }));
    const source = content.viz!.source as VizSourceVegaLite;
    expect(source.kind).toBe('vega-lite');
    expect((source.spec.encoding as any).x.field).toBe('label');
    expect(source.spec.mark).toBe('bar');
    expect(source.detachedFrom).toMatchObject({ kind: 'recipe', recipe: '/org/kpi-bar' });
  });

  it("freezes the folder's OVERRIDE for a question saved in that subtree", async () => {
    const { content } = await createQuestion('/org/finance/q-fin', recipeViz('kpi-bar', { label: 'label', value: 'value' }));
    const source = content.viz!.source as VizSourceVegaLite;
    expect(source.spec.mark).toBe('point'); // finance's shadowing recipe
    expect(source.detachedFrom).toMatchObject({ recipe: '/org/finance/kpi-bar' });
  });

  it('freezes an absolute-path reference regardless of folder', async () => {
    const { content } = await createQuestion('/org/finance/q-abs', recipeViz('/org/kpi-bar', { label: 'label', value: 'value' }));
    const source = content.viz!.source as VizSourceVegaLite;
    expect(source.spec.mark).toBe('bar'); // the root file, not finance's override
    expect(source.detachedFrom).toMatchObject({ recipe: '/org/kpi-bar' });
  });

  it('freezes a built-in recipe by name with the bare name as provenance', async () => {
    const { content } = await createQuestion(
      '/org/q-builtin',
      recipeViz('lollipop', { category: 'label', value: 'value' }),
    );
    const source = content.viz!.source as VizSourceVegaLite;
    expect(source.kind).toBe('vega-lite');
    expect(Array.isArray(source.spec.layer)).toBe(true);
    expect(source.detachedFrom).toMatchObject({ kind: 'recipe', recipe: 'lollipop' });
  });

  it('leaves shipped minusx/ recipe references untouched (live reference)', async () => {
    const { content } = await createQuestion(
      '/org/q-shipped',
      recipeViz('minusx/funnel@1', { stage: 'label', value: 'value' }),
    );
    expect(content.viz!.source.kind).toBe('recipe');
    expect((content.viz!.source as { recipe?: string }).recipe).toBe('minusx/funnel@1');
  });

  it('rejects an unresolvable recipe name, listing what is available', async () => {
    await expect(
      createQuestion('/org/q-bad', recipeViz('no-such-recipe', { label: 'label', value: 'value' })),
    ).rejects.toThrow(/no-such-recipe[\s\S]*kpi-bar/);
  });

  it('rejects missing bindings with the slot named', async () => {
    await expect(
      createQuestion('/org/q-missing', recipeViz('kpi-bar', { label: 'label' })),
    ).rejects.toThrow(/value/);
  });

  it('freezes on saveFile edits too, and re-freezing picks up a recipe edit', async () => {
    const { id, content } = await createQuestion('/org/q-refreeze', recipeViz('kpi-bar', { label: 'label', value: 'value' }));
    expect((content.viz!.source as VizSourceVegaLite).spec.mark).toBe('bar');

    // the recipe file changes its mark — saved charts must NOT change...
    await FilesAPI.saveFile(recipeFileId, 'kpi-bar', '/org/kpi-bar',
      { ...KPI_RECIPE, template: { ...KPI_RECIPE.template, mark: 'tick' } } as never,
      [], user);
    const { data: unchanged } = await FilesAPI.loadFiles([id], user);
    expect(((unchanged[0].content as QuestionContent).viz!.source as VizSourceVegaLite).spec.mark).toBe('bar');

    // ...until the reference is re-applied (re-frozen) on an edit
    await FilesAPI.saveFile(id, 'q-refreeze', '/org/q-refreeze',
      question(recipeViz('kpi-bar', { label: 'label', value: 'value' })) as never, [], user);
    const { data: refrozen } = await FilesAPI.loadFiles([id], user);
    expect(((refrozen[0].content as QuestionContent).viz!.source as VizSourceVegaLite).spec.mark).toBe('tick');
  });

  it('a frozen chart survives deleting the recipe file', async () => {
    const ephemeralId = await publishRecipe('/org/ephemeral', KPI_RECIPE);
    const { content, id } = await createQuestion('/org/q-survivor', recipeViz('/org/ephemeral', { label: 'label', value: 'value' }));
    expect((content.viz!.source as VizSourceVegaLite).spec.mark).toBe('bar');

    await FilesAPI.deleteFile(ephemeralId, user);
    const { data } = await FilesAPI.loadFiles([id], user);
    const source = (data[0].content as QuestionContent).viz!.source as VizSourceVegaLite;
    expect(source.kind).toBe('vega-lite');
    expect(source.spec.mark).toBe('bar'); // fully self-contained
  });

  it('freezes recipe references inside notebook SQL cells', async () => {
    const notebook: NotebookContent = {
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
    const cell = (data[0].content as NotebookContent).cells[0] as { viz?: { source: VizSourceVegaLite } };
    expect(cell.viz!.source.kind).toBe('vega-lite');
    expect(cell.viz!.source.detachedFrom).toMatchObject({ recipe: '/org/kpi-bar' });
  });
});
