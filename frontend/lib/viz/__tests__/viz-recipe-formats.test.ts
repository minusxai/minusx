/**
 * Column alias/format for RECIPE sources: `columnFormats` on the recipe source is
 * applied at materialization — aliases rename the display strings that come from
 * COLUMN NAMES (waterfall y title, radar series names), and number configs
 * (decimalPoints/prefix/suffix) reshape the value labels recipes render.
 */
import { describe, it, expect } from 'vitest';
import { materializeRecipe } from '@/lib/viz/viz-templates';
import {
  getVizColumnFormats, setVizColumnFormats, mergeVizColumnFormat,
} from '@/lib/viz/encoding-edit';
import { validateVizEnvelope } from '@/lib/viz/validate';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';
import type { VizResultColumn } from '@/lib/viz/types';

const FMT = { revenue: { alias: 'Revenue ($)', decimalPoints: 0, prefix: '$' } };

const recipeEnvelope = (recipe: string, bindings: Record<string, string | string[]>, extra: Record<string, unknown> = {}): VizEnvelope => ({
  version: 2,
  source: { kind: 'recipe', recipe, bindings, params: null, columnFormats: null, ...extra },
}) as unknown as VizEnvelope;

describe('waterfall formats', () => {
  it('alias renames the y-axis title on every layer', () => {
    const result = materializeRecipe({
      recipe: 'minusx/waterfall@1',
      bindings: { category: 'step', value: 'revenue' },
      columnFormats: FMT,
    });
    expect(result.ok).toBe(true);
    const json = JSON.stringify((result as { spec: Record<string, unknown> }).spec);
    expect(json).toContain('"title":"Revenue ($)"');
    expect(json).not.toContain('"title":"revenue"');
  });

  it('decimalPoints + prefix reshape the bar labels', () => {
    const result = materializeRecipe({
      recipe: 'minusx/waterfall@1',
      bindings: { category: 'step', value: 'revenue' },
      columnFormats: FMT,
    });
    const json = JSON.stringify((result as { spec: Record<string, unknown> }).spec);
    expect(json).toContain(',.0f');
    expect(json).toContain('\\"$\\" + format');
  });

  it('without formats the defaults are unchanged (SI labels, column-name title)', () => {
    const result = materializeRecipe({
      recipe: 'minusx/waterfall@1',
      bindings: { category: 'step', value: 'revenue' },
    });
    const json = JSON.stringify((result as { spec: Record<string, unknown> }).spec);
    expect(json).toContain('"title":"revenue"');
    expect(json).toContain('.3~s');
  });
});

describe('funnel formats', () => {
  it('value label uses the configured number format', () => {
    const result = materializeRecipe({
      recipe: 'minusx/funnel@1',
      bindings: { stage: 'stage', value: 'revenue' },
      columnFormats: FMT,
    });
    const json = JSON.stringify((result as { spec: Record<string, unknown> }).spec);
    expect(json).toContain(',.0f');
    expect(json).toContain('\\"$\\" + format');
  });
});

describe('radar formats', () => {
  it('wide data: aliases rename the folded series names', () => {
    const result = materializeRecipe({
      recipe: 'minusx/radar@1',
      bindings: { metric: 'metric', value: ['revenue', 'cost'] },
      columnFormats: { revenue: { alias: 'Revenue ($)' } },
    });
    expect(result.ok).toBe(true);
    const json = JSON.stringify((result as { spec: Record<string, unknown> }).spec);
    expect(json).toContain('Revenue ($)');
  });

  it('single value without series: the legend entry uses the alias', () => {
    const result = materializeRecipe({
      recipe: 'minusx/radar@1',
      bindings: { metric: 'metric', value: 'revenue' },
      columnFormats: { revenue: { alias: 'Revenue ($)' } },
    });
    const json = JSON.stringify((result as { spec: Record<string, unknown> }).spec);
    expect(json).toContain('Revenue ($)');
  });
});

describe('recipe columnFormats envelope helpers', () => {
  it('get/setVizColumnFormats work on recipe sources', () => {
    const env = recipeEnvelope('minusx/funnel@1', { stage: 'stage', value: 'revenue' });
    const next = setVizColumnFormats(env, FMT);
    expect(getVizColumnFormats(next)).toEqual(FMT);
  });

  it('mergeVizColumnFormat adds a column config and removes it when emptied', () => {
    const env = recipeEnvelope('minusx/funnel@1', { stage: 'stage', value: 'revenue' });
    const withOne = mergeVizColumnFormat(env, 'revenue', { alias: 'Rev' });
    expect(getVizColumnFormats(withOne)).toEqual({ revenue: { alias: 'Rev' } });
    const cleared = mergeVizColumnFormat(withOne, 'revenue', {});
    expect(getVizColumnFormats(cleared)).toEqual({});
  });
});

describe('validateVizEnvelope — recipe columnFormats', () => {
  const COLS: VizResultColumn[] = [
    { name: 'stage', kind: 'nominal' },
    { name: 'revenue', kind: 'quantitative' },
  ];

  it('accepts formats keyed by real columns', () => {
    const env = recipeEnvelope('minusx/funnel@1', { stage: 'stage', value: 'revenue' }, { columnFormats: FMT });
    expect(validateVizEnvelope(env, COLS).ok).toBe(true);
  });

  it('flags a formats key not in the query result', () => {
    const env = recipeEnvelope('minusx/funnel@1', { stage: 'stage', value: 'revenue' },
      { columnFormats: { revenu: { alias: 'typo' } } });
    const result = validateVizEnvelope(env, COLS);
    expect(result.ok).toBe(false);
    expect(result.issues[0].code).toBe('E_FIELD_NOT_FOUND');
    expect(result.issues[0].path).toBe('/source/columnFormats/revenu');
  });
});
