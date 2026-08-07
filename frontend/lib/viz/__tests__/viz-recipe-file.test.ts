/**
 * File-based viz recipes: the inert-data template contract. A `.viz` file's
 * content is a static spec with {{slot}} tokens; materialization is pure
 * substitution, and use always FREEZES the substituted spec with the file path
 * as provenance (`detachedFrom.recipe`). No code ever ships in a recipe file.
 */
import { describe, it, expect } from 'vitest';
import {
  isFileRecipePath,
  materializeFileRecipe,
  freezeFileRecipe,
  synthesizeDummyBindings,
  type VizRecipeContent,
} from '@/lib/viz/recipe-file';
import { validateVizEnvelope } from '@/lib/viz/validate';
import { VIZ_GRAMMAR_VEGA, VIZ_GRAMMAR_VEGA_LITE } from '@/lib/validation/atlas-schemas';
import type { VizResultColumn } from '@/lib/viz/types';

const COLUMNS: VizResultColumn[] = [
  { name: 'team', kind: 'nominal' },
  { name: 'month', kind: 'temporal' },
  { name: 'revenue', kind: 'quantitative' },
  { name: 'quota', kind: 'quantitative' },
  { name: 'active', kind: 'boolean' },
];

/** A realistic sellable recipe: a bullet chart — bar + target tick per category. */
const bullet: VizRecipeContent = {
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
          x: { field: '{{value}}', type: 'quantitative', title: null },
          y: { field: '{{category}}', type: '{{category.kind}}', title: null },
        },
      },
      {
        mark: { type: 'tick', color: '{{tickColor}}', thickness: 2, size: 28 },
        encoding: {
          x: { field: '{{target}}', type: 'quantitative' },
          y: { field: '{{category}}', type: '{{category.kind}}' },
          tooltip: [
            { field: '{{category}}', type: '{{category.kind}}' },
            { field: '{{value}}', type: 'quantitative' },
            { field: '{{target}}', type: 'quantitative' },
          ],
        },
      },
    ],
  },
};

/** A multi-slot recipe: fold N value columns — array binding as a whole-value token. */
const folded: VizRecipeContent = {
  description: 'Folded multi-series bar',
  engine: 'vega-lite',
  bindings: [
    { name: 'x', label: 'X axis', accepts: ['nominal', 'temporal'] },
    { name: 'values', label: 'Values', accepts: ['quantitative'], multi: true },
  ],
  template: {
    transform: [{ fold: '{{values}}', as: ['series', 'value'] }],
    mark: 'bar',
    encoding: {
      x: { field: '{{x}}', type: '{{x.kind}}' },
      y: { field: 'value', type: 'quantitative' },
      color: { field: 'series', type: 'nominal' },
    },
  },
};

describe('isFileRecipePath', () => {
  it('discriminates workspace paths from shipped registry ids', () => {
    expect(isFileRecipePath('/org/funnel-pro')).toBe(true);
    expect(isFileRecipePath('/tutorial/viz/bullet')).toBe(true);
    expect(isFileRecipePath('minusx/funnel@1')).toBe(false);
    expect(isFileRecipePath('minusx/point-map@1')).toBe(false);
  });
});

describe('materializeFileRecipe: substitution', () => {
  it('substitutes bindings, params, and {{slot.kind}} from real columns', () => {
    const res = materializeFileRecipe(
      bullet,
      { category: 'month', value: 'revenue', target: 'quota' },
      { tickColor: '#000000' },
      COLUMNS,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const layers = res.spec.layer as Array<Record<string, any>>;
    expect(layers[0].encoding.x.field).toBe('revenue');
    expect(layers[0].encoding.y.field).toBe('month');
    expect(layers[0].encoding.y.type).toBe('temporal'); // {{category.kind}} resolved
    expect(layers[1].mark.color).toBe('#000000');
  });

  it('applies a param default when the param is omitted', () => {
    const res = materializeFileRecipe(bullet, { category: 'team', value: 'revenue', target: 'quota' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect((res.spec.layer as any)[1].mark.color).toBe('#e11d48');
  });

  it('falls back to the first accepts kind for {{slot.kind}} without columns', () => {
    const res = materializeFileRecipe(bullet, { category: 'team', value: 'revenue', target: 'quota' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect((res.spec.layer as any)[0].encoding.y.type).toBe('nominal');
  });

  it('resolves boolean/unknown column kinds to nominal', () => {
    const res = materializeFileRecipe(bullet, { category: 'active', value: 'revenue', target: 'quota' }, null, COLUMNS);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect((res.spec.layer as any)[0].encoding.y.type).toBe('nominal');
  });

  it('substitutes a multi binding as a whole-value array', () => {
    const res = materializeFileRecipe(folded, { x: 'team', values: ['revenue', 'quota'] }, null, COLUMNS);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect((res.spec.transform as any)[0].fold).toEqual(['revenue', 'quota']);
  });

  it('normalizes a single column bound to a multi slot into an array', () => {
    const res = materializeFileRecipe(folded, { x: 'team', values: 'revenue' }, null, COLUMNS);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect((res.spec.transform as any)[0].fold).toEqual(['revenue']);
  });

  it('never mutates the input template', () => {
    const before = JSON.stringify(bullet.template);
    materializeFileRecipe(bullet, { category: 'team', value: 'revenue', target: 'quota' }, null, COLUMNS);
    expect(JSON.stringify(bullet.template)).toBe(before);
  });

  it('materialized output validates through the real envelope pipeline', () => {
    const res = materializeFileRecipe(bullet, { category: 'team', value: 'revenue', target: 'quota' }, null, COLUMNS);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const validated = validateVizEnvelope(
      { version: 2, source: { kind: 'vega-lite', grammar: VIZ_GRAMMAR_VEGA_LITE, spec: res.spec, detachedFrom: null } },
      COLUMNS,
    );
    expect(validated.ok).toBe(true);
  });

  it('a typo in a binding is caught downstream by the field check', () => {
    const res = materializeFileRecipe(bullet, { category: 'team', value: 'revenu', target: 'quota' });
    expect(res.ok).toBe(true); // substitution itself cannot know the columns
    if (!res.ok) return;
    const validated = validateVizEnvelope(
      { version: 2, source: { kind: 'vega-lite', grammar: VIZ_GRAMMAR_VEGA_LITE, spec: res.spec, detachedFrom: null } },
      COLUMNS,
    );
    expect(validated.ok).toBe(false);
    expect(validated.issues.some(i => i.code === 'E_FIELD_NOT_FOUND')).toBe(true);
  });
});

describe('materializeFileRecipe: errors', () => {
  it('names every missing binding', () => {
    const res = materializeFileRecipe(bullet, { category: 'team' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain('value');
    expect(res.error).toContain('target');
  });

  it('treats empty string and empty array as missing', () => {
    const res = materializeFileRecipe(folded, { x: '', values: [] });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain('x');
    expect(res.error).toContain('values');
  });

  it('rejects an array bound to a single slot', () => {
    const res = materializeFileRecipe(bullet, { category: ['team', 'month'], value: 'revenue', target: 'quota' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain('category');
  });

  it('rejects an unknown param by name', () => {
    const res = materializeFileRecipe(bullet, { category: 'team', value: 'revenue', target: 'quota' }, { nope: 1 });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain('nope');
  });

  it('rejects a template token with no matching slot or param, naming it', () => {
    const broken: VizRecipeContent = {
      ...bullet,
      template: { mark: 'bar', encoding: { x: { field: '{{ghost}}' } } },
    };
    const res = materializeFileRecipe(broken, { category: 'team', value: 'revenue', target: 'quota' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain('ghost');
  });

  it('rejects an array slot embedded inside a longer string', () => {
    const broken: VizRecipeContent = {
      ...folded,
      template: { title: 'Folded: {{values}}', mark: 'bar' },
    };
    const res = materializeFileRecipe(broken, { x: 'team', values: ['revenue', 'quota'] });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain('values');
  });

  it('rejects duplicate names across bindings and params', () => {
    const broken: VizRecipeContent = {
      ...bullet,
      params: [{ name: 'category', label: 'Collides', default: 1 }],
    };
    const res = materializeFileRecipe(broken, { category: 'team', value: 'revenue', target: 'quota' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain('category');
  });
});

describe('freezeFileRecipe', () => {
  it('freezes a vega-lite recipe with full provenance', () => {
    const res = freezeFileRecipe(
      bullet,
      { path: '/org/bullet', bindings: { category: 'team', value: 'revenue', target: 'quota' } },
      COLUMNS,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.source.kind).toBe('vega-lite');
    expect(res.source.grammar).toBe(VIZ_GRAMMAR_VEGA_LITE);
    expect((res.source.spec.layer as any)[0].encoding.x.field).toBe('revenue');
    expect(res.source.detachedFrom).toEqual({
      kind: 'recipe',
      recipe: '/org/bullet',
      bindings: { category: 'team', value: 'revenue', target: 'quota' },
      params: null,
      columnFormats: null,
    });
  });

  it('freezes a vega-engine recipe to kind vega with null assets', () => {
    const vegaRecipe: VizRecipeContent = {
      description: 'Native vega single mark',
      engine: 'vega',
      bindings: [{ name: 'value', label: 'Value', accepts: ['quantitative'] }],
      template: {
        data: [{ name: 'main' }],
        marks: [{ type: 'text', from: { data: 'main' }, encode: { update: { text: { field: '{{value}}' } } } }],
      },
    };
    const res = freezeFileRecipe(vegaRecipe, { path: '/org/kpi', bindings: { value: 'revenue' } }, COLUMNS);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.source.kind).toBe('vega');
    expect(res.source.grammar).toBe(VIZ_GRAMMAR_VEGA);
    if (res.source.kind === 'vega') expect(res.source.assets).toBeNull();
    expect(res.source.detachedFrom?.recipe).toBe('/org/kpi');
  });

  it('propagates materialization failures', () => {
    const res = freezeFileRecipe(bullet, { path: '/org/bullet', bindings: {} }, COLUMNS);
    expect(res.ok).toBe(false);
  });
});

describe('synthesizeDummyBindings', () => {
  it('produces one binding per slot with kind-matched dummy columns', () => {
    const { bindings, columns } = synthesizeDummyBindings(bullet);
    expect(Object.keys(bindings).sort()).toEqual(['category', 'target', 'value']);
    for (const b of bullet.bindings) {
      const bound = bindings[b.name];
      expect(typeof bound).toBe('string');
      const col = columns.find(c => c.name === bound);
      expect(col).toBeDefined();
      expect(b.accepts).toContain(col!.kind);
    }
  });

  it('produces arrays for multi slots', () => {
    const { bindings } = synthesizeDummyBindings(folded);
    expect(Array.isArray(bindings.values)).toBe(true);
    expect((bindings.values as string[]).length).toBeGreaterThan(1);
  });

  it('dummy materialization passes the structural validation stages', () => {
    const { bindings, columns } = synthesizeDummyBindings(bullet);
    const res = materializeFileRecipe(bullet, bindings, null, columns);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const validated = validateVizEnvelope(
      { version: 2, source: { kind: 'vega-lite', grammar: VIZ_GRAMMAR_VEGA_LITE, spec: res.spec, detachedFrom: null } },
      columns,
    );
    expect(validated.ok).toBe(true);
  });
});
