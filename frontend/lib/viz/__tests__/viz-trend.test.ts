/**
 * minusx/trend@1 — the RFC §17 spike, recipe-first: KPI cards on the NATIVE VEGA
 * engine (like radar). One card per bound measure: big value, delta vs the
 * comparison period (computeTrendComparison semantics: 'last' = last vs
 * second-to-last, 'previous' = skip the partial current period), period labels,
 * and a sparkline. Fonts ride signals with param overrides (§17 acceptance:
 * independently adjustable value/delta/label/date sizes).
 */
import { describe, it, expect } from 'vitest';
import { getTemplate, materializeRecipe, VIZ_TEMPLATES } from '../viz-templates';
import { setEnvelopeVizType, getEnvelopeVizType, V2_SUPPORTED_VIZ_TYPES } from '../encoding-edit';
import { renderEnvelopeToSvg } from '../render-vega';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';

const COLUMNS = [
  { name: 'month', kind: 'temporal' as const },
  { name: 'revenue', kind: 'quantitative' as const },
  { name: 'orders', kind: 'quantitative' as const },
];

const trendSource = (over: Record<string, unknown> = {}) => ({
  recipe: 'minusx/trend@1',
  bindings: { date: 'month', value: ['revenue', 'orders'] },
  ...over,
});

const specJson = (source: Record<string, unknown>): string => {
  const result = materializeRecipe(source as never);
  expect(result.ok).toBe(true);
  return JSON.stringify((result as { spec: Record<string, unknown> }).spec);
};

describe('minusx/trend@1 registry', () => {
  it('is registered as a native-vega recipe implementing the trend type', () => {
    const t = getTemplate('minusx/trend@1');
    expect(t).not.toBeNull();
    expect(t!.engine).toBe('vega');
    expect(t!.vizType).toBe('trend');
    expect(Object.keys(VIZ_TEMPLATES)).toContain('minusx/trend@1');
  });

  it('binds a date/order column and MULTI measures (one KPI card each)', () => {
    const t = getTemplate('minusx/trend@1')!;
    const date = t.bindings.find(b => b.name === 'date');
    const value = t.bindings.find(b => b.name === 'value');
    expect(date?.accepts).toContain('temporal');
    expect(value?.multi).toBe(true);
    expect(value?.accepts).toEqual(['quantitative']);
  });
});

describe('minusx/trend@1 build', () => {
  it('materializes with folded measures and comparison via window lag', () => {
    const json = specJson(trendSource());
    expect(json).toContain('"fold"');           // wide measures → one card per column
    expect(json).toContain('"lag"');            // prev value = lag(1) on the base row
    expect(json).toContain('__mx_pct');         // percent change computed in-spec
  });

  it('sizes the KPI readability plate to the widest text so the date line never overflows it', () => {
    const json = specJson(trendSource());
    // The plate width is measured off the ACTUAL rendered text (value number + date line),
    // not a static slot fraction that a long "Nov 30, 2025 vs Oct 31, 2025" overshoots.
    expect(json).toContain('__mx_datelabel');               // date label is materialized as a field
    expect(json).toContain('length(datum.__mx_datelabel)'); // …and feeds the plate width
    expect(json).toContain('length(datum.__mx_valuetext)');  // as does the big value number
    expect(json).not.toContain("bandwidth('slot') * 0.28");  // the fixed-fraction plate is gone
  });

  it("compareMode 'last' bases on the final point; 'previous' skips the partial period (3+ points)", () => {
    const last = specJson(trendSource({ params: { compareMode: 'last' } }));
    const previous = specJson(trendSource({ params: { compareMode: 'previous' } }));
    expect(last).toContain('datum.__mx_idx === datum.__mx_n');
    // previous: base is n-1 when 3+ points exist, else n (the 2-point special case)
    expect(previous).toContain('datum.__mx_n >= 3 ? datum.__mx_n - 1 : datum.__mx_n');
    expect(last).not.toContain('datum.__mx_n >= 3');
  });

  it('sparkline renders by default and is removable via params', () => {
    const withSpark = specJson(trendSource());
    const without = specJson(trendSource({ params: { sparkline: false } }));
    expect(withSpark).toContain('__mx_spark');
    expect(without).not.toContain('__mx_spark');
  });

  it('uses the plot as a clean full-height visual field without y-axis guides', () => {
    const json = specJson(trendSource());
    expect(json).toContain('plotTop');
    expect(json).toContain('plotBottom');
    expect(json).not.toContain('__mx_scale_guides');
    expect(json).not.toContain('__mx_scale_guide_rules');
    expect(json).not.toContain('__mx_scale_guide_labels');
  });

  it('exposes the date, series, and formatted value on hover', () => {
    const json = specJson(trendSource());
    expect(json).toContain('tooltip');
    expect(json).toContain('__mx_date');
    expect(json).toContain('__mx_series');
    expect(json).toContain('__mx_value');
  });

  it('uses a crisp line, translucent area, and endpoint markers behind the KPI', () => {
    const json = specJson(trendSource());
    expect(json).not.toContain('__mx_spark_glow');
    expect(json).toContain('__mx_spark_area');
    expect(json).toContain('__mx_latest_point');
    expect(json).toContain('__mx_compare_point');
  });

  it('uses a compact surface plate to keep the centered KPI readable', () => {
    const json = specJson(trendSource());
    expect(json).toContain('__mx_kpi_plate');
    expect(json).toContain('mx-trend-focus');
    expect(json).toContain('"cornerRadius":{"value":10}');
    expect(json).toContain('"fillOpacity":{"value":0.86}');
    expect(json).not.toContain('__mx_kpi_aura');
    expect(json).not.toContain('__mx_value_glow');
    expect(json).not.toContain("gradient: 'radial'");
  });

  it('fades the area from the series color to zero-alpha series color, never transparent black', () => {
    const json = specJson(trendSource());
    expect(json).toContain('__mx_spark_area');
    expect(json).toContain('"fillOpacity":{"value":0.22}');
    expect(json).toContain("gradient: 'linear'");
    expect(json).toContain('rgba(');
    expect(json).not.toContain("color: 'transparent'");
  });

  it('uses directional arrow glyphs instead of geometric triangles', () => {
    const json = specJson(trendSource());
    expect(json).toContain('↗');
    expect(json).toContain('↘');
    expect(json).toContain('→');
    expect(json).not.toContain('▲');
    expect(json).not.toContain('▼');
  });

  it('value text uses the d3 format vocabulary from columnFormats', () => {
    const json = specJson(trendSource({
      bindings: { date: 'month', value: 'revenue' },
      columnFormats: { revenue: { format: '$,.0f' } },
    }));
    expect(json).toContain("format(datum.__mx_value, '$,.0f')");
  });

  it('font sizes are signals with param overrides (§17: independently adjustable)', () => {
    const json = specJson(trendSource({ params: { valueFontSize: 64, deltaFontSize: 18 } }));
    expect(json).toContain('64');
    expect(json).toContain('18');
    const defaults = specJson(trendSource());
    // responsive default when no override: derived from card bandwidth/height
    expect(defaults).toContain("bandwidth('slot')");
  });

  it('single measure binding works without fold', () => {
    const json = specJson(trendSource({ bindings: { date: 'month', value: 'revenue' } }));
    expect(json).not.toContain('"fold"');
    expect(json).toContain('__mx_value');
  });

  it('renders the full native-Vega composition headlessly', async () => {
    const envelope = {
      version: 2,
      source: {
        kind: 'recipe',
        recipe: 'minusx/trend@1',
        bindings: { date: 'month', value: ['revenue'] },
        params: null,
        columnFormats: { revenue: { alias: 'Revenue', format: '$,.0f' } },
      },
    } as unknown as VizEnvelope;
    const svg = await renderEnvelopeToSvg(envelope, [
      { month: '2025-10-01', revenue: 100 },
      { month: '2025-11-01', revenue: 160 },
      { month: '2025-12-01', revenue: 80 },
    ], 'dark', { width: 800, height: 560 });
    expect(svg).toContain('<svg');
    expect(svg).toContain('REVENUE');
    expect(svg).toContain('↘ 50.0%');
    expect(svg).toContain('mark-area');
    expect(svg).not.toContain('mark-rule');
  });
});

describe('trend as a V2 viz type', () => {
  it('is a supported V2 type (icon enabled)', () => {
    expect(V2_SUPPORTED_VIZ_TYPES).toContain('trend');
  });

  it('switching a table to trend produces the recipe reference with inferred bindings', () => {
    const table = {
      version: 2,
      source: { kind: 'table', columnFormats: null, conditionalFormats: null, css: null },
    } as unknown as VizEnvelope;
    const next = setEnvelopeVizType(table, 'trend', COLUMNS);
    const source = next.source as unknown as { kind: string; recipe: string; bindings: Record<string, unknown> };
    expect(source.kind).toBe('recipe');
    expect(source.recipe).toBe('minusx/trend@1');
    expect(source.bindings.date).toBe('month');
    expect(source.bindings.value).toBe('revenue');
    expect(getEnvelopeVizType(next)).toBe('trend');
  });
});
