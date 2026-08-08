/**
 * Panel-side editing of FROZEN file-recipe charts. A frozen source carries the
 * full reference in `detachedFrom`, so with the recipe definition injected the
 * zone helpers stay bindable: zones come from the declared slots, a zone drop
 * re-substitutes and re-freezes, and selection auto-binds from result columns.
 */
import { describe, it, expect } from 'vitest';
import {
  getFileRecipeRef,
  rebindFileRecipe,
  applyFileRecipeSelection,
  explainRecipeFit,
} from '@/lib/viz/recipe-rebind';
import { freezeFileRecipe, type VizRecipeContent } from '@/lib/viz/recipe-file';
import {
  isEnvelopeEditable, getEnvelopeZones, getZoneField, getZoneFields,
  isMultiZone, addZoneField, removeZoneField, setZoneField,
} from '@/lib/viz/encoding-edit';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';
import type { VizResultColumn } from '@/lib/viz/types';

const COLUMNS: VizResultColumn[] = [
  { name: 'team', kind: 'nominal' },
  { name: 'month', kind: 'temporal' },
  { name: 'revenue', kind: 'quantitative' },
  { name: 'quota', kind: 'quantitative' },
];

const RECIPE: VizRecipeContent = {
  description: 'Bullet-ish',
  engine: 'vega-lite',
  bindings: [
    { name: 'category', label: 'Category', accepts: ['nominal', 'temporal'] },
    { name: 'value', label: 'Value', accepts: ['quantitative'] },
  ],
  template: {
    layer: [{
      mark: 'bar',
      encoding: {
        x: { field: '{{value}}', type: 'quantitative' },
        y: { field: '{{category}}', type: '{{category:kind}}' },
      },
    }],
  },
};

const MULTI_RECIPE: VizRecipeContent = {
  description: 'Folded',
  engine: 'vega-lite',
  bindings: [
    { name: 'x', label: 'X', accepts: ['nominal', 'temporal'] },
    { name: 'values', label: 'Values', accepts: ['quantitative'], multi: true },
  ],
  template: {
    transform: [{ fold: '{{values}}', as: ['series', 'value'] }],
    mark: 'bar',
    encoding: {
      x: { field: '{{x}}', type: '{{x:kind}}' },
      y: { field: 'value', type: 'quantitative' },
      color: { field: 'series', type: 'nominal' },
    },
  },
};

function frozen(content: VizRecipeContent, bindings: Record<string, string | string[]>): VizEnvelope {
  const res = freezeFileRecipe(content, { path: '/org/r', bindings }, COLUMNS);
  if (!res.ok) throw new Error(res.error);
  return { version: 2, source: res.source } as unknown as VizEnvelope;
}

describe('getFileRecipeRef', () => {
  it('returns the reference for a frozen file recipe', () => {
    const env = frozen(RECIPE, { category: 'team', value: 'revenue' });
    expect(getFileRecipeRef(env)).toMatchObject({ recipe: '/org/r', bindings: { category: 'team' } });
  });

  it('returns null for shipped-recipe detachments and plain specs', () => {
    const detachedShipped = {
      version: 2,
      source: {
        kind: 'vega-lite', grammar: 'vega-lite@6', spec: { mark: 'bar' },
        detachedFrom: { kind: 'recipe', recipe: 'minusx/funnel@1', bindings: {}, params: null, columnFormats: null },
      },
    } as unknown as VizEnvelope;
    expect(getFileRecipeRef(detachedShipped)).toBeNull();
    const plain = {
      version: 2,
      source: { kind: 'vega-lite', grammar: 'vega-lite@6', spec: { mark: 'bar' }, detachedFrom: null },
    } as unknown as VizEnvelope;
    expect(getFileRecipeRef(plain)).toBeNull();
  });
});

describe('rebindFileRecipe', () => {
  it('re-substitutes the spec and updates provenance', () => {
    const env = frozen(RECIPE, { category: 'team', value: 'revenue' });
    const next = rebindFileRecipe(env, RECIPE, { category: 'month', value: 'quota' }, COLUMNS);
    const spec = (next.source as { spec: Record<string, any> }).spec;
    expect(spec.layer[0].encoding.y.field).toBe('month');
    expect(spec.layer[0].encoding.y.type).toBe('temporal'); // :kind re-resolved
    expect(spec.layer[0].encoding.x.field).toBe('quota');
    expect(getFileRecipeRef(next)).toMatchObject({ bindings: { category: 'month', value: 'quota' } });
  });

  it('preserves recipe params through a rebind (re-substituted, not dropped)', () => {
    const PARAM_RECIPE: VizRecipeContent = {
      ...RECIPE,
      params: [{ name: 'barColor', label: 'Bar color', default: '#111111' }],
      template: {
        layer: [{
          mark: { type: 'bar', color: '{{barColor}}' },
          encoding: {
            x: { field: '{{value}}', type: 'quantitative' },
            y: { field: '{{category}}', type: '{{category:kind}}' },
          },
        }],
      },
    };
    const res = freezeFileRecipe(PARAM_RECIPE, {
      path: '/org/r', bindings: { category: 'team', value: 'revenue' }, params: { barColor: '#e11d48' },
    }, COLUMNS);
    if (!res.ok) throw new Error(res.error);
    const env = { version: 2, source: res.source } as unknown as VizEnvelope;

    const next = rebindFileRecipe(env, PARAM_RECIPE, { category: 'month', value: 'quota' }, COLUMNS);
    const spec = (next.source as { spec: Record<string, any> }).spec;
    expect(spec.layer[0].mark.color).toBe('#e11d48');            // the CHOSEN param survives, not the default
    expect(getFileRecipeRef(next)!.params).toEqual({ barColor: '#e11d48' }); // and stays in provenance
  });

  it('keeps the previous spec when a slot is emptied (stale until complete)', () => {
    const env = frozen(RECIPE, { category: 'team', value: 'revenue' });
    const next = rebindFileRecipe(env, RECIPE, { category: 'team', value: '' }, COLUMNS);
    const spec = (next.source as { spec: Record<string, any> }).spec;
    expect(spec.layer[0].encoding.x.field).toBe('revenue'); // unchanged
    expect(getFileRecipeRef(next)!.bindings).toEqual({ category: 'team', value: '' });
  });
});

describe('applyFileRecipeSelection', () => {
  it('auto-binds by accepts kinds and freezes', () => {
    const res = applyFileRecipeSelection(RECIPE, '/org/r', COLUMNS);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const spec = (res.envelope.source as { spec: Record<string, any> }).spec;
    expect(spec.layer[0].encoding.y.field).toBe('team');    // first nominal/temporal
    expect(spec.layer[0].encoding.x.field).toBe('revenue'); // first quantitative
  });

  it('binds all remaining matching columns to a multi slot', () => {
    const res = applyFileRecipeSelection(MULTI_RECIPE, '/org/m', COLUMNS);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ref = getFileRecipeRef(res.envelope)!;
    expect(ref.bindings.values).toEqual(['revenue', 'quota']);
  });

  it('fails with the slot LABEL named when no column fits', () => {
    const res = applyFileRecipeSelection(RECIPE, '/org/r', [{ name: 'team', kind: 'nominal' }]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain('Value');
    expect(res.error).toMatch(/number column/i);
  });
});

describe('encoding-edit zone helpers with an injected file recipe', () => {
  const ctx = { content: RECIPE, columns: COLUMNS };
  const env = frozen(RECIPE, { category: 'team', value: 'revenue' });

  it('a frozen layered file recipe is editable (would not be as a bare composed spec)', () => {
    expect(isEnvelopeEditable(env)).toBe(false);          // composed spec, no lens
    expect(isEnvelopeEditable(env, ctx)).toBe(true);      // bindable via the recipe
  });

  it('zones come from the declared slots', () => {
    expect(getEnvelopeZones(env, ctx)).toEqual([
      { channel: 'category', label: 'Category' },
      { channel: 'value', label: 'Value' },
    ]);
  });

  it('zone reads come from provenance bindings', () => {
    expect(getZoneField(env, 'category', ctx)).toBe('team');
    expect(getZoneFields(env, 'value', ctx)).toEqual(['revenue']);
  });

  it('setZoneField re-freezes through the recipe', () => {
    const next = setZoneField(env, 'category', { name: 'month', kind: 'temporal' }, ctx);
    const spec = (next.source as { spec: Record<string, any> }).spec;
    expect(spec.layer[0].encoding.y.field).toBe('month');
    expect(spec.layer[0].encoding.y.type).toBe('temporal');
  });

  it('multi zones append and remove through the recipe', () => {
    const mEnv = frozen(MULTI_RECIPE, { x: 'team', values: ['revenue'] });
    const mCtx = { content: MULTI_RECIPE, columns: COLUMNS };
    expect(isMultiZone(mEnv, 'values', mCtx)).toBe(true);
    const added = addZoneField(mEnv, 'values', { name: 'quota', kind: 'quantitative' }, mCtx);
    expect(getZoneFields(added, 'values', mCtx)).toEqual(['revenue', 'quota']);
    expect(((added.source as { spec: any }).spec.transform)[0].fold).toEqual(['revenue', 'quota']);
    const removed = removeZoneField(added, 'values', 'revenue', mCtx);
    expect(getZoneFields(removed, 'values', mCtx)).toEqual(['quota']);
  });
});

describe('explainRecipeFit — human-readable applicability', () => {
  it('returns null when the recipe fits', () => {
    expect(explainRecipeFit(RECIPE, COLUMNS)).toBeNull();
  });

  it('says to run the query first when there is no result yet', () => {
    expect(explainRecipeFit(RECIPE, [])).toMatch(/run the query/i);
  });

  it('names the slot in plain words when the result has no matching column', () => {
    // Only numbers — nothing text-like for Category.
    const reason = explainRecipeFit(RECIPE, [
      { name: 'revenue', kind: 'quantitative' },
      { name: 'quota', kind: 'quantitative' },
    ]);
    expect(reason).toMatch(/text or date column/i);
    expect(reason).toContain('Category');
    expect(reason).toMatch(/has none/i);
  });

  it('distinguishes "all matching columns already assigned" from "has none"', () => {
    // month fits Category, revenue fits Value — nothing LEFT for a second
    // quantitative slot (the range-bar confusion from the field).
    const rangeBarish: VizRecipeContent = {
      ...RECIPE,
      bindings: [
        { name: 'category', label: 'Category', accepts: ['nominal', 'temporal'] },
        { name: 'start', label: 'Start', accepts: ['quantitative', 'temporal'] },
        { name: 'end', label: 'End', accepts: ['quantitative', 'temporal'] },
      ],
    };
    const reason = explainRecipeFit(rangeBarish, [
      { name: 'month', kind: 'temporal' },
      { name: 'orders', kind: 'quantitative' },
    ]);
    expect(reason).toContain('End');
    expect(reason).toMatch(/already assigned|already used/i);
    expect(reason).not.toMatch(/has none/i);
  });

  it('applyFileRecipeSelection uses the same human phrasing on failure', () => {
    const res = applyFileRecipeSelection(RECIPE, '/org/r', [{ name: 'revenue', kind: 'quantitative' }]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/text or date column/i);
  });
});
