/**
 * The `viz` file type: a workspace `.viz` recipe document. These tests pin the
 * full wiring a new file type needs — the metadata registry, the Atlas content
 * schema, save-time validation (client structural + server deep), the agent
 * markup round-trip, and FilesAPI create/save.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FILE_TYPE_METADATA, SUPPORTED_FILE_TYPES } from '@/lib/ui/file-metadata';
import { validateFileState } from '@/lib/validation/content-validators';
import { validateFileStateServer } from '@/lib/validation/content-validators.server';
import { contentSchemaText, SCHEMA_TEMPLATE_VARS } from '@/lib/validation/atlas-json-schemas';
import { fileToMarkup, markupToContent } from '@/lib/data/story/file-markup';
import type { VizRecipeContent } from '@/lib/validation/atlas-schemas';
import { FilesAPI } from '@/lib/data/files.server';
import { initTestDatabase, cleanupTestDatabase, getTestDbPath } from '@/store/__tests__/test-utils';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const VALID_RECIPE: VizRecipeContent = {
  description: 'Bullet chart: value bars with a target tick per category',
  engine: 'vega-lite',
  bindings: [
    { name: 'category', label: 'Category', accepts: ['nominal', 'temporal'] },
    { name: 'value', label: 'Value', accepts: ['quantitative'] },
    { name: 'target', label: 'Target', accepts: ['quantitative'] },
  ],
  params: [{ name: 'tickColor', label: 'Target color', default: '#e11d48' }],
  template: {
    layer: [
      {
        mark: { type: 'bar', height: 18 },
        encoding: {
          x: { field: '{{value}}', type: 'quantitative' },
          y: { field: '{{category}}', type: '{{category:kind}}' },
        },
      },
      {
        mark: { type: 'tick', color: '{{tickColor}}', thickness: 2 },
        encoding: {
          x: { field: '{{target}}', type: 'quantitative' },
          y: { field: '{{category}}', type: '{{category:kind}}' },
        },
      },
    ],
  },
};

describe('viz file type registration', () => {
  it('is a supported analytics file type', () => {
    expect(FILE_TYPE_METADATA.viz).toBeDefined();
    expect(FILE_TYPE_METADATA.viz.category).toBe('analytics');
    expect(SUPPORTED_FILE_TYPES).toContain('viz');
  });

  it('has a live content schema and a schema template var', () => {
    const text = contentSchemaText('viz');
    expect(text).toContain('bindings');
    expect(text).toContain('template');
    expect(SCHEMA_TEMPLATE_VARS.schema_viz).toBeDefined();
  });
});

describe('validateFileState for viz', () => {
  it('accepts a valid recipe', () => {
    expect(validateFileState({ type: 'viz', content: VALID_RECIPE })).toBeNull();
  });

  it('rejects a structurally wrong recipe (missing template)', () => {
    const { template: _template, ...rest } = VALID_RECIPE;
    const error = validateFileState({ type: 'viz', content: rest });
    expect(error).toBeTruthy();
    expect(error).toContain('template');
  });

  it('rejects a wrong engine value', () => {
    const error = validateFileState({ type: 'viz', content: { ...VALID_RECIPE, engine: 'echarts' } });
    expect(error).toBeTruthy();
  });

  it('rejects a template referencing an undeclared token, naming it', () => {
    const error = validateFileState({
      type: 'viz',
      content: { ...VALID_RECIPE, template: { mark: 'bar', encoding: { x: { field: '{{ghost}}' } } } },
    });
    expect(error).toBeTruthy();
    expect(error).toContain('ghost');
  });

  it('rejects duplicate slot names across bindings and params', () => {
    const error = validateFileState({
      type: 'viz',
      content: { ...VALID_RECIPE, params: [{ name: 'category', label: 'Collides' }] },
    });
    expect(error).toBeTruthy();
    expect(error).toContain('category');
  });
});

describe('validateFileStateServer for viz (deep grammar check)', () => {
  it('accepts a valid recipe', async () => {
    expect(await validateFileStateServer({ type: 'viz', content: VALID_RECIPE })).toBeNull();
  });

  it('rejects a template that materializes to an invalid Vega-Lite spec', async () => {
    const error = await validateFileStateServer({
      type: 'viz',
      content: {
        ...VALID_RECIPE,
        template: { mark: 'not-a-real-mark', encoding: { x: { field: '{{value}}', type: 'quantitative' } } },
      },
    });
    expect(error).toBeTruthy();
  });

  it('rejects a template with an external data url', async () => {
    const error = await validateFileStateServer({
      type: 'viz',
      content: {
        ...VALID_RECIPE,
        template: {
          data: { url: 'https://evil.example/data.json' },
          mark: 'bar',
          encoding: { x: { field: '{{value}}', type: 'quantitative' } },
        },
      },
    });
    expect(error).toBeTruthy();
  });
});

describe('viz markup round-trip', () => {
  it('content → markup → content is identity', () => {
    const markup = fileToMarkup('viz', VALID_RECIPE);
    const back = markupToContent('viz', markup);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.content).toEqual(VALID_RECIPE);
  });

  it('markup carries tokens readably (no escaped-JSON soup for the template)', () => {
    const markup = fileToMarkup('viz', VALID_RECIPE);
    expect(markup).toContain('{{value}}');
  });
});

describe('FilesAPI create/save for viz', () => {
  const TEST_DB_PATH = getTestDbPath('viz-recipe-files');
  const user: EffectiveUser = {
    userId: 1, name: 'Test User', email: 'test@example.com',
    role: 'admin', mode: 'org', home_folder: '',
  };

  beforeAll(async () => {
    await initTestDatabase(TEST_DB_PATH);
  });

  afterAll(async () => {
    await cleanupTestDatabase(TEST_DB_PATH);
  });

  it('creates and loads a viz recipe file', async () => {
    const created = await FilesAPI.createFile(
      { name: 'bullet', path: '/org/bullet', type: 'viz', content: VALID_RECIPE },
      user,
    );
    const { data } = await FilesAPI.loadFiles([created.data.id], user);
    expect(data[0].content).toEqual(VALID_RECIPE);
  });

  it('rejects creating a viz file with a broken template', async () => {
    await expect(
      FilesAPI.createFile(
        {
          name: 'broken', path: '/org/broken', type: 'viz',
          content: { ...VALID_RECIPE, template: { mark: 'bar', encoding: { x: { field: '{{ghost}}' } } } },
        },
        user,
      ),
    ).rejects.toThrow(/ghost/);
  });
});
