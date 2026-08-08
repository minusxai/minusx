/**
 * Resolution semantics of LIVE recipe references through the real save+load
 * path: a question (or notebook cell) whose `viz` references a workspace or
 * built-in recipe stores the REFERENCE, and the file loader materializes the
 * computed `spec` at read time against the file's folder — root file at the
 * root, the folder's override inside its subtree, an absolute path regardless
 * of folder, a built-in by bare name. Shipped `minusx/` recipes pass through
 * untouched. Every save flows through FilesAPI, so this is the single choke
 * point for browser tools, GUI saves, and headless agents alike. The lifecycle
 * half — edit propagation, delete → unresolved, computed-field stripping — is
 * lib/data/__tests__/viz-recipe-reference.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FilesAPI } from '@/lib/data/files.server';
import { initTestDatabase, cleanupTestDatabase, getTestDbPath } from '@/store/__tests__/test-utils';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { QuestionContent, NotebookContent } from '@/lib/types';
import type { VizRecipeContent, VizSourceRecipe } from '@/lib/validation/atlas-schemas';

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

type LoadedSource = VizSourceRecipe & {
  spec?: Record<string, unknown>;
  grammar?: string;
  unresolved?: string;
};

const createQuestion = async (path: string, viz: unknown) => {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const created = await FilesAPI.createFile({ name, path, type: 'question', content: question(viz) }, user);
  const { data } = await FilesAPI.loadFiles([created.data.id], user);
  return { id: created.data.id, content: data[0].content as QuestionContent };
};

const sourceOf = (content: QuestionContent): LoadedSource =>
  content.viz!.source as unknown as LoadedSource;

describe('live viz recipe reference resolution', () => {
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
    await publishRecipe('/org/kpi-bar', KPI_RECIPE);
    // finance's override renders a POINT instead of a bar — visibly different
    await publishRecipe('/org/finance/kpi-bar',
      { ...KPI_RECIPE, template: { ...KPI_RECIPE.template, mark: 'point' } });
  });

  afterAll(async () => {
    await cleanupTestDatabase(TEST_DB_PATH);
  });

  it('materializes a by-name reference against the question folder (root file wins at root)', async () => {
    const { content } = await createQuestion('/org/q-root', recipeViz('kpi-bar', { label: 'label', value: 'value' }));
    const source = sourceOf(content);
    expect(source.kind).toBe('recipe');
    expect(source.recipe).toBe('kpi-bar'); // the stored reference stays the bare name
    expect((source.spec!.encoding as any).x.field).toBe('label');
    expect(source.spec!.mark).toBe('bar');
  });

  it("materializes the folder's OVERRIDE for a question in that subtree", async () => {
    const { content } = await createQuestion('/org/finance/q-fin', recipeViz('kpi-bar', { label: 'label', value: 'value' }));
    expect(sourceOf(content).spec!.mark).toBe('point'); // finance's shadowing recipe
  });

  it('materializes an absolute-path reference regardless of folder', async () => {
    const { content } = await createQuestion('/org/finance/q-abs', recipeViz('/org/kpi-bar', { label: 'label', value: 'value' }));
    expect(sourceOf(content).spec!.mark).toBe('bar'); // the root file, not finance's override
  });

  it('materializes a built-in recipe by bare name', async () => {
    const { content } = await createQuestion(
      '/org/q-builtin',
      recipeViz('lollipop', { category: 'label', value: 'value' }),
    );
    const source = sourceOf(content);
    expect(source.recipe).toBe('lollipop');
    expect(Array.isArray(source.spec!.layer)).toBe(true);
    expect(source.grammar).toBe('vega-lite@6');
  });

  it('leaves shipped minusx/ recipe references untouched (no computed fields)', async () => {
    const { content } = await createQuestion(
      '/org/q-shipped',
      recipeViz('minusx/funnel@1', { stage: 'label', value: 'value' }),
    );
    const source = sourceOf(content);
    expect(source.kind).toBe('recipe');
    expect(source.recipe).toBe('minusx/funnel@1');
    expect(source.spec).toBeUndefined(); // the renderer materializes from the shipped registry
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

  it('a DRAFT recipe file does not resolve — only saved recipes are usable', async () => {
    // createFile without saveFile leaves draft:true (invisible in listings).
    await FilesAPI.createFile(
      { name: 'draft-only', path: '/org/draft-only', type: 'viz', content: KPI_RECIPE }, user,
    );
    await expect(
      createQuestion('/org/q-draft-ref', recipeViz('draft-only', { label: 'label', value: 'value' })),
    ).rejects.toThrow(/draft-only/); // unknown — the draft is not in the catalog
  });

  it('materializes references inside notebook SQL cells against the notebook folder', async () => {
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
      { name: 'nb', path: '/org/finance/nb', type: 'notebook', content: notebook }, user,
    );
    const { data } = await FilesAPI.loadFiles([created.data.id], user);
    const cell = (data[0].content as NotebookContent).cells[0] as { viz?: { source: LoadedSource } };
    expect(cell.viz!.source.kind).toBe('recipe');
    expect(cell.viz!.source.spec!.mark).toBe('point'); // finance's override governs the notebook's folder
  });
});
