/**
 * The recipe catalog served through the real file API: the built-in and shipped
 * recipes browse and open exactly like `.viz` files, in the current mode's
 * `/visualizations` folder, while every write path refuses them. Nothing is
 * stored — these rows are synthesized per request — so the guarantee that
 * matters is that the read surfaces include them and the write surfaces do not.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FilesAPI } from '@/lib/data/files.server';
import { initTestDatabase, cleanupTestDatabase, getTestDbPath } from '@/store/__tests__/test-utils';
import { catalogVizFiles, CATALOG_VIZ_ID_BASE } from '@/lib/viz/recipe-catalog';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { VizRecipeContent } from '@/lib/validation/atlas-schemas';

const TEST_DB_PATH = getTestDbPath('viz-catalog-files');

const user: EffectiveUser = {
  userId: 1, name: 'Test User', email: 'test@example.com',
  role: 'admin', mode: 'org', home_folder: '',
};
const viewer: EffectiveUser = { ...user, userId: 2, role: 'viewer' };

beforeAll(async () => { await initTestDatabase(TEST_DB_PATH); });
afterAll(async () => { await cleanupTestDatabase(TEST_DB_PATH); });

describe('recipe catalog as virtual files', () => {
  it('lists every catalog recipe when browsing the visualizations folder', async () => {
    const { data } = await FilesAPI.getFiles({ paths: ['/org/visualizations'], depth: 1 }, user);
    const names = data.filter((f) => f.type === 'viz').map((f) => f.name);
    expect(names).toEqual(catalogVizFiles('org').map((f) => f.name));
    expect(names).toContain('bullet');   // built-in tier
    expect(names).toContain('funnel');   // shipped tier
  });

  it('shows the visualizations folder when browsing the mode root', async () => {
    const { data } = await FilesAPI.getFiles({ paths: ['/org'], depth: 1 }, user);
    expect(data.some((f) => f.type === 'folder' && f.path === '/org/visualizations')).toBe(true);
  });

  it('opens a catalog recipe by id with its content and read-only marker', async () => {
    const bullet = catalogVizFiles('org').find((f) => f.name === 'bullet')!;
    const { data } = await FilesAPI.loadFiles([bullet.id], user);
    expect(data).toHaveLength(1);
    expect(data[0].type).toBe('viz');
    expect((data[0].meta as { readOnly?: boolean }).readOnly).toBe(true);
    const content = data[0].content as unknown as VizRecipeContent;
    expect(content.bindings.map((b) => b.name)).toEqual(['category', 'value', 'target']);
    expect(content.template).toBeTruthy();
  });

  it('scopes catalog paths to the caller mode', async () => {
    const tutorialUser = { ...user, mode: 'tutorial' as const };
    const { data } = await FilesAPI.loadFiles([CATALOG_VIZ_ID_BASE], tutorialUser);
    expect(data[0].path).toBe('/tutorial/visualizations/bullet');
  });

  it('serves the catalog to viewers too (it is app vocabulary, not workspace data)', async () => {
    const { data } = await FilesAPI.getFiles({ paths: ['/org/visualizations'], depth: 1 }, viewer);
    expect(data.filter((f) => f.type === 'viz').length).toBeGreaterThan(0);
  });

  it('refuses every write: save, delete and move', async () => {
    const bullet = catalogVizFiles('org').find((f) => f.name === 'bullet')!;
    await expect(
      FilesAPI.saveFile(bullet.id, 'bullet', bullet.path, { description: 'hacked' } as never, [], user),
    ).rejects.toThrow(/read-only|built-in|catalog/i);
    await expect(FilesAPI.deleteFile(bullet.id, user)).rejects.toThrow(/read-only|built-in|catalog/i);
    await expect(
      FilesAPI.moveFile({ id: bullet.id, name: 'bullet', newPath: '/org/bullet' }, user),
    ).rejects.toThrow(/read-only|built-in|catalog/i);
  });

  it('a workspace recipe of the same name still shadows the built-in for resolution', async () => {
    // The catalog is a viewing surface only — it must not enter recipe resolution,
    // which still runs over real files + BUILTIN_VIZ_RECIPES.
    const mine = {
      description: 'my bullet', engine: 'vega-lite',
      bindings: [{ name: 'category', label: 'Category', accepts: ['nominal'] }, { name: 'value', label: 'Value', accepts: ['quantitative'] }],
      template: { mark: 'tick', encoding: { x: { field: '{{category}}', type: '{{category:kind}}' }, y: { field: '{{value}}', type: 'quantitative' } } },
    };
    const created = await FilesAPI.createFile({ name: 'bullet', path: '/org/bullet', type: 'viz', content: mine as never }, user);
    await FilesAPI.saveFile(created.data.id, 'bullet', '/org/bullet', mine as never, [], user); // publish
    expect(created.data.id).toBeLessThan(CATALOG_VIZ_ID_BASE);
    const { data } = await FilesAPI.getFiles({ paths: ['/org'], depth: 1, type: 'viz' }, user);
    // The real file lists at the root; the catalog copy stays under /visualizations.
    expect(data.some((f) => f.path === '/org/bullet')).toBe(true);
    expect(data.every((f) => f.id < CATALOG_VIZ_ID_BASE)).toBe(true);
  });
});
