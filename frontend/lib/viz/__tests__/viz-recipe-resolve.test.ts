/**
 * Recipe resolution + shadowing across the folder tree. The full required
 * matrix: root recipes inherited everywhere; child-folder recipes scoped to
 * their subtree; child overrides shadowing an ancestor's same-name recipe;
 * sibling isolation; workspace files shadowing built-ins; mode isolation.
 */
import { describe, it, expect } from 'vitest';
import { resolveVizRecipes, resolveVizRecipe, type VizRecipeFileMeta } from '@/lib/viz/recipe-resolve';
import { getBuiltinVizRecipes } from '@/lib/viz/builtin-recipes';
import { materializeFileRecipe, synthesizeDummyBindings } from '@/lib/viz/recipe-file';
import { validateVizEnvelope } from '@/lib/viz/validate';
import { VIZ_GRAMMAR_VEGA, VIZ_GRAMMAR_VEGA_LITE } from '@/lib/validation/atlas-schemas';

const f = (id: number, path: string): VizRecipeFileMeta => ({
  id,
  name: path.slice(path.lastIndexOf('/') + 1),
  path,
});

// The workspace tree under test:
//   /org/funnel-pro                 root recipe, inherited everywhere under /org
//   /org/finance/quota-chart        finance-only recipe
//   /org/finance/funnel-pro         finance's OVERRIDE of the root funnel-pro
//   /org/marketing/campaign-viz     marketing-only recipe
//   /org/bullet                     workspace file shadowing the BUILT-IN 'bullet'
//   /tutorial/tut-only              a different mode's tree
const FILES: VizRecipeFileMeta[] = [
  f(1, '/org/funnel-pro'),
  f(2, '/org/finance/quota-chart'),
  f(3, '/org/finance/funnel-pro'),
  f(4, '/org/marketing/campaign-viz'),
  f(5, '/org/bullet'),
  f(6, '/tutorial/tut-only'),
];

describe('resolveVizRecipes: the shadowing matrix', () => {
  it('a root recipe is inherited by every descendant folder', () => {
    for (const folder of ['/org', '/org/marketing', '/org/marketing/q3/deep']) {
      const r = resolveVizRecipes(FILES, folder).get('funnel-pro');
      expect(r).toBeDefined();
      if (folder === '/org' || folder.startsWith('/org/marketing')) {
        expect(r).toMatchObject({ source: 'file', fileId: 1, path: '/org/funnel-pro' });
      }
    }
  });

  it('a child-folder recipe is visible in its subtree only', () => {
    expect(resolveVizRecipes(FILES, '/org/finance').get('quota-chart')).toMatchObject({ fileId: 2 });
    expect(resolveVizRecipes(FILES, '/org/finance/reports').get('quota-chart')).toMatchObject({ fileId: 2 });
    expect(resolveVizRecipes(FILES, '/org').get('quota-chart')).toBeUndefined();
    expect(resolveVizRecipes(FILES, '/org/marketing').get('quota-chart')).toBeUndefined();
  });

  it("a child override shadows the root's same-name recipe in that subtree", () => {
    expect(resolveVizRecipes(FILES, '/org/finance').get('funnel-pro')).toMatchObject({ fileId: 3 });
    expect(resolveVizRecipes(FILES, '/org/finance/reports').get('funnel-pro')).toMatchObject({ fileId: 3 });
    // outside the subtree the root's file still wins
    expect(resolveVizRecipes(FILES, '/org').get('funnel-pro')).toMatchObject({ fileId: 1 });
    expect(resolveVizRecipes(FILES, '/org/marketing').get('funnel-pro')).toMatchObject({ fileId: 1 });
  });

  it("sibling folders don't see each other's recipes", () => {
    expect(resolveVizRecipes(FILES, '/org/finance').get('campaign-viz')).toBeUndefined();
    expect(resolveVizRecipes(FILES, '/org/marketing').get('campaign-viz')).toMatchObject({ fileId: 4 });
  });

  it('built-in defaults are present everywhere', () => {
    for (const name of Object.keys(getBuiltinVizRecipes())) {
      const r = resolveVizRecipes(FILES, '/org/finance/deep/nested').get(name);
      expect(r).toBeDefined();
    }
    expect(resolveVizRecipes(FILES, '/org/marketing').get('lollipop')).toMatchObject({ source: 'builtin' });
  });

  it('a workspace file shadows a built-in of the same name', () => {
    expect(resolveVizRecipes(FILES, '/org').get('bullet')).toMatchObject({ source: 'file', fileId: 5 });
    expect(resolveVizRecipes(FILES, '/org/finance').get('bullet')).toMatchObject({ source: 'file', fileId: 5 });
    // a different mode's tree still gets the built-in
    expect(resolveVizRecipes(FILES, '/tutorial').get('bullet')).toMatchObject({ source: 'builtin' });
  });

  it('modes are isolated: /tutorial never sees /org files and vice versa', () => {
    expect(resolveVizRecipes(FILES, '/tutorial').get('funnel-pro')).toBeUndefined();
    expect(resolveVizRecipes(FILES, '/tutorial/lessons').get('tut-only')).toMatchObject({ fileId: 6 });
    expect(resolveVizRecipes(FILES, '/org').get('tut-only')).toBeUndefined();
  });

  it('a recipe in the folder itself wins over every ancestor', () => {
    const withLocal = [...FILES, f(7, '/org/finance/reports/funnel-pro')];
    expect(resolveVizRecipes(withLocal, '/org/finance/reports').get('funnel-pro')).toMatchObject({ fileId: 7 });
    expect(resolveVizRecipes(withLocal, '/org/finance').get('funnel-pro')).toMatchObject({ fileId: 3 });
  });

  it('a trailing slash on the folder does not change resolution', () => {
    expect(resolveVizRecipes(FILES, '/org/finance/').get('funnel-pro')).toMatchObject({ fileId: 3 });
  });

  it('resolveVizRecipe resolves one name with the same rules', () => {
    expect(resolveVizRecipe(FILES, '/org/finance', 'funnel-pro')).toMatchObject({ fileId: 3 });
    expect(resolveVizRecipe(FILES, '/org/finance', 'nope')).toBeUndefined();
  });
});

describe('built-in recipes are valid', () => {
  for (const [name, recipe] of Object.entries(getBuiltinVizRecipes())) {
    it(`'${name}' materializes with dummy bindings and passes envelope validation`, () => {
      const dummy = synthesizeDummyBindings(recipe);
      const materialized = materializeFileRecipe(recipe, dummy.bindings, null, dummy.columns);
      expect(materialized.ok).toBe(true);
      if (!materialized.ok) return;
      const source = materialized.engine === 'vega'
        ? { kind: 'vega', grammar: VIZ_GRAMMAR_VEGA, spec: materialized.spec, assets: null, detachedFrom: null }
        : { kind: 'vega-lite', grammar: VIZ_GRAMMAR_VEGA_LITE, spec: materialized.spec, detachedFrom: null };
      const validated = validateVizEnvelope({ version: 2, source }, dummy.columns);
      expect(validated.issues.filter(i => i.severity === 'error')).toEqual([]);
      expect(validated.ok).toBe(true);
    });
  }
});
