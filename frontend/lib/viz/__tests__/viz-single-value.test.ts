/**
 * minusx/single-value@1 — one measure, rendered as a cardless data poster.
 * Query order owns semantics: the first result row is the displayed value.
 */
import { describe, expect, it } from 'vitest';
import { getEnvelopeVizType, setEnvelopeVizType, V2_SUPPORTED_VIZ_TYPES } from '../encoding-edit';
import { renderEnvelopeToSvg } from '../render-vega';
import { getTemplate, materializeRecipe } from '../viz-templates';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';

const source = (over: Record<string, unknown> = {}) => ({
  recipe: 'minusx/single-value@1',
  bindings: { value: 'revenue' },
  ...over,
});

const specJson = (over: Record<string, unknown> = {}): string => {
  const result = materializeRecipe(source(over) as never);
  expect(result.ok).toBe(true);
  return JSON.stringify((result as { spec: Record<string, unknown> }).spec);
};

describe('minusx/single-value@1 registry', () => {
  it('is a native-Vega single-value recipe with one non-multi quantitative binding', () => {
    const template = getTemplate('minusx/single-value@1');
    expect(template).not.toBeNull();
    expect(template!.engine).toBe('vega');
    expect(template!.vizType).toBe('single_value');
    expect(template!.bindings).toEqual([
      { name: 'value', label: 'Value', accepts: ['quantitative'] },
    ]);
  });
});

describe('minusx/single-value@1 build', () => {
  it('selects the first query row without axes, aggregation, or decorative card chrome', () => {
    const json = specJson();
    expect(json).toContain('row_number');
    expect(json).toContain('datum.__mx_idx === 1');
    expect(json).not.toContain('aggregate');
    expect(json).not.toContain('axes');
    expect(json).not.toContain('rect');
  });

  it('uses the field alias and d3 number format in both the display and tooltip', () => {
    const json = specJson({
      columnFormats: { revenue: { alias: 'Net revenue', format: '$,.0f' } },
    });
    expect(json).toContain('NET REVENUE');
    expect(json).toContain("format(datum.__mx_value, '$,.0f')");
    expect(json).toContain('tooltip');
    expect(json).toContain("'Metric'");
    expect(json).toContain("'Value'");
  });

  it('supports a hidden label and independently adjustable typography', () => {
    const hidden = specJson({ params: { showLabel: false, valueFontSize: 72 } });
    expect(hidden).not.toContain('__mx_label');
    expect(hidden).toContain('72');

    const defaults = specJson();
    expect(defaults).toContain('clamp(');
    expect(defaults).toContain('valueSize');
    expect(defaults).toContain('labelSize');
  });

  it('renders only the first row with the configured alias and format', async () => {
    const envelope = {
      version: 2,
      source: {
        kind: 'recipe',
        recipe: 'minusx/single-value@1',
        bindings: { value: 'revenue' },
        params: null,
        columnFormats: { revenue: { alias: 'Net revenue', format: '$,.0f' } },
      },
    } as unknown as VizEnvelope;

    const svg = await renderEnvelopeToSvg(envelope, [
      { revenue: 12345 },
      { revenue: 98765 },
    ], 'dark', { width: 520, height: 320 });

    expect(svg).toContain('NET REVENUE');
    expect(svg).toContain('$12,345');
    expect(svg).not.toContain('$98,765');
  });
});

describe('single value as a V2 viz type', () => {
  it('is supported and table switching infers the first quantitative column', () => {
    expect(V2_SUPPORTED_VIZ_TYPES).toContain('single_value');
    const table = {
      version: 2,
      source: { kind: 'table', columnFormats: null, conditionalFormats: null, css: null },
    } as unknown as VizEnvelope;
    const next = setEnvelopeVizType(table, 'single_value' as never, [
      { name: 'region', kind: 'nominal' },
      { name: 'revenue', kind: 'quantitative' },
      { name: 'orders', kind: 'quantitative' },
    ]);
    const nextSource = next.source as unknown as {
      kind: string;
      recipe: string;
      bindings: Record<string, unknown>;
    };
    expect(nextSource.kind).toBe('recipe');
    expect(nextSource.recipe).toBe('minusx/single-value@1');
    expect(nextSource.bindings).toEqual({ value: 'revenue' });
    expect(getEnvelopeVizType(next)).toBe('single_value');
  });
});
