/**
 * Every SERVER path that resolves a recipe must load the template registry
 * itself, rather than trusting that a boot task already filled it.
 *
 * `setBuiltinVizTemplates` writes MODULE-LEVEL state, and a Next server does not
 * guarantee that the module instance serving an API route is the one a boot task
 * (or the RSC layout) wrote to — the QA prod server logged no `[boot]` line at
 * all and rejected a save with `unknown viz recipe "heatmap" — available:
 * minusx/funnel@1, …`, the built-in set empty while the BROWSER had it from
 * SSR-hydrated Redux. Nothing threw; the recipe was simply absent one layer down.
 *
 * These tests reproduce that by emptying the registry — the state of a module
 * instance nobody booted — and asserting each server entry recovers on its own.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { validateAndStripVizRecipeRefs } from '@/lib/data/helpers/viz-recipe-refs.server';
import { vizRecipeLoader } from '@/lib/data/loaders/viz-recipe-loader.server';
import { setBuiltinVizTemplates, getBuiltinVizRecipes } from '@/lib/viz/builtin-recipes';
import { resetTemplateRegistryForTests } from '@/lib/templates/registry.server';
import type { DbFile } from '@/lib/types';

const question = (recipe: string) => ({
  query: 'select 1',
  viz: { version: 2, source: { kind: 'recipe', recipe, bindings: { x: 'day', y: 'hour', value: 'orders' } } },
});

// No workspace files anywhere: `heatmap` can only come from the built-in set.
const loaders = { listVizFiles: async () => [], loadVizContent: async () => null };

beforeEach(() => {
  // A module instance nobody booted: no memo, no installed set.
  resetTemplateRegistryForTests();
  setBuiltinVizTemplates({});
  expect(Object.keys(getBuiltinVizRecipes())).toEqual([]);
});

describe('server recipe paths load the template registry themselves', () => {
  it('the SAVE GATE accepts a built-in recipe reference', async () => {
    const res = await validateAndStripVizRecipeRefs('question', question('heatmap'), '/org', loaders);
    expect(res.ok, res.ok ? '' : res.error).toBe(true);
  });

  it('the save gate still rejects a genuinely unknown name, listing the built-ins', async () => {
    const res = await validateAndStripVizRecipeRefs('question', question('nope'), '/org', loaders);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    // The catalog in the message must be the real one — an empty built-in set
    // is exactly what made the QA failure's message misleading.
    expect(res.error).toContain('heatmap');
    expect(res.error).toContain('radar');
  });

  it('the READ LOADER materializes a built-in reference instead of falling back to a table', async () => {
    const file = {
      id: 1, type: 'question', path: '/org/q', name: 'q', content: question('heatmap'),
    } as unknown as DbFile;
    const loaded = await vizRecipeLoader(file, undefined as never, undefined) as { content: { viz: { source: Record<string, unknown> } } };
    const source = loaded.content.viz.source;
    expect(source.unresolved, 'an unresolved built-in renders as a silent table fallback').toBeUndefined();
    expect(source.spec).toBeDefined();
  });
});
