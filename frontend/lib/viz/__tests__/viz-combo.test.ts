/**
 * minusx/combo@1 — a restrained bar + line composition with independent Y scales.
 */
import { describe, expect, it } from 'vitest';
import {
  getEnvelopeVizType, getEnvelopeZones, removeZoneField, setEnvelopeVizType,
  setZoneField, V2_SUPPORTED_VIZ_TYPES,
} from '../encoding-edit';
import { renderEnvelopeToSvg } from '../render-vega';
import { getTemplate, materializeRecipe } from '../viz-templates';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';

const source = (over: Record<string, unknown> = {}) => ({
  recipe: 'minusx/combo@1',
  bindings: { x: 'month', bar: 'revenue', line: 'margin' },
  ...over,
});

interface ComboSpec {
  layer: [
    {
      mark: { type: string; opacity: number };
      encoding: { color: Record<string, unknown>; tooltip: Array<Record<string, unknown>> };
    },
    {
      mark: { type: string; strokeWidth: number; point: false | { filled: boolean; size: number } };
      encoding: {
        y: { axis: { orient: string; grid: boolean } };
        color: Record<string, unknown>;
        tooltip: Array<Record<string, unknown>>;
      };
    },
  ];
  resolve: { scale: { y: string } };
}

const materialized = (over: Record<string, unknown> = {}): ComboSpec => {
  const result = materializeRecipe(source(over) as never);
  expect(result.ok).toBe(true);
  return (result as { spec: Record<string, unknown> }).spec as unknown as ComboSpec;
};

describe('minusx/combo@1 registry', () => {
  it('is a Vega-Lite combo recipe with editable category, measures, and optional split binding', () => {
    const template = getTemplate('minusx/combo@1');
    expect(template).not.toBeNull();
    expect(template!.engine).toBe('vega-lite');
    expect(template!.vizType).toBe('combo');
    expect(template!.bindings.map(b => b.name)).toEqual(['x', 'bar', 'line', 'series']);
    expect(template!.bindings.find(b => b.name === 'bar')?.accepts).toEqual(['quantitative']);
    expect(template!.bindings.find(b => b.name === 'line')?.accepts).toEqual(['quantitative']);
    expect(template!.bindings.find(b => b.name === 'series')).toMatchObject({
      label: 'Color / Split', accepts: ['nominal'], optional: true,
    });
  });
});

describe('minusx/combo@1 build', () => {
  it('materializes a bar foundation and emphasized line with independent Y scales', () => {
    const spec = materialized();
    expect(spec.layer).toHaveLength(2);
    expect(spec.layer[0].mark.type).toBe('bar');
    expect(spec.layer[1].mark.type).toBe('line');
    expect(spec.layer[1].mark.strokeWidth).toBe(3);
    expect(spec.layer[1].mark.point).toEqual({ filled: true, size: 64 });
    expect(spec.layer[1].encoding.y.axis.orient).toBe('right');
    expect(spec.layer[1].encoding.y.axis.grid).toBe(false);
    expect(spec.resolve).toEqual({ scale: { y: 'independent' } });
  });

  it('uses column aliases and d3 formats on axes, legends, and tooltips', () => {
    const json = JSON.stringify(materialized({
      columnFormats: {
        month: { alias: 'Month' },
        revenue: { alias: 'Revenue', format: '$,.0f' },
        margin: { alias: 'Margin', format: '.1%' },
      },
    }));
    expect(json).toContain('Revenue');
    expect(json).toContain('Margin');
    expect(json).toContain('$,.0f');
    expect(json).toContain('.1%');
    expect(json).toContain('tooltip');
  });

  it('supports restrained visual params without changing the chart structure', () => {
    const spec = materialized({ params: { linePoints: false, lineWidth: 5, barOpacity: 0.5 } });
    expect(spec.layer[0].mark.opacity).toBe(0.5);
    expect(spec.layer[1].mark.strokeWidth).toBe(5);
    expect(spec.layer[1].mark.point).toBe(false);
  });

  it('uses one optional split field to color and group both layers', () => {
    const spec = materialized({
      bindings: { x: 'month', bar: 'revenue', line: 'margin', series: 'region' },
      columnFormats: { region: { alias: 'Region' } },
    });
    expect(spec.layer[0].encoding.color).toMatchObject({ field: 'region', type: 'nominal', title: 'Region' });
    expect(spec.layer[1].encoding.color).toMatchObject({ field: 'region', type: 'nominal', title: 'Region' });
    expect(spec.layer[0].encoding.tooltip).toContainEqual({ field: 'region', type: 'nominal', title: 'Region' });
    expect(spec.layer[1].encoding.tooltip).toContainEqual({ field: 'region', type: 'nominal', title: 'Region' });
  });

  it('renders both layers headlessly', async () => {
    const envelope = {
      version: 2,
      source: {
        kind: 'recipe',
        recipe: 'minusx/combo@1',
        bindings: { x: 'month', bar: 'revenue', line: 'margin' },
        params: null,
        columnFormats: {
          revenue: { alias: 'Revenue', format: '$,.0f' },
          margin: { alias: 'Margin', format: '.1%' },
        },
      },
    } as unknown as VizEnvelope;
    const svg = await renderEnvelopeToSvg(envelope, [
      { month: 'Jan', revenue: 120000, margin: 0.18 },
      { month: 'Feb', revenue: 155000, margin: 0.23 },
      { month: 'Mar', revenue: 148000, margin: 0.21 },
    ], 'dark', { width: 640, height: 360 });
    expect(svg).toContain('mark-rect');
    expect(svg).toContain('mark-line');
    expect(svg).toContain('mark-symbol');
    expect(svg).toContain('Revenue');
    expect(svg).toContain('Margin');
  });

  it('renders an ordinal date axis after choosing a d3 time format', async () => {
    const envelope = {
      version: 2,
      source: {
        kind: 'recipe', recipe: 'minusx/combo@1',
        bindings: { x: 'week_start', bar: 'revenue', line: 'orders' },
        params: null,
        columnFormats: { week_start: { format: '%b %Y' } },
      },
    } as unknown as VizEnvelope;
    const svg = await renderEnvelopeToSvg(envelope, [
      { week_start: '2025-01-01T00:00:00.000Z', revenue: 100, orders: 12 },
      { week_start: '2025-02-01T00:00:00.000Z', revenue: 140, orders: 18 },
    ], 'light', { width: 640, height: 360 });
    expect(svg).toContain('mark-rect');
    expect(svg).toContain('mark-line');
    expect(svg).toContain('Jan 2025');
    expect(svg).toContain('Feb 2025');
  });

  it('renders split-series legends and grouped lines headlessly', async () => {
    const envelope = {
      version: 2,
      source: {
        kind: 'recipe', recipe: 'minusx/combo@1',
        bindings: { x: 'month', bar: 'revenue', line: 'margin', series: 'region' },
        params: null, columnFormats: { region: { alias: 'Region' } },
      },
    } as unknown as VizEnvelope;
    const svg = await renderEnvelopeToSvg(envelope, [
      { month: 'Jan', region: 'East', revenue: 80, margin: 0.22 },
      { month: 'Jan', region: 'West', revenue: 60, margin: 0.18 },
      { month: 'Feb', region: 'East', revenue: 90, margin: 0.25 },
      { month: 'Feb', region: 'West', revenue: 70, margin: 0.2 },
    ], 'dark', { width: 640, height: 360 });
    expect(svg).toContain('mark-rect');
    expect(svg).toContain('mark-line');
    expect(svg).toContain('East');
    expect(svg).toContain('West');
  });
});

describe('combo as a V2 viz type', () => {
  const columns = [
    { name: 'month', kind: 'temporal' as const },
    { name: 'revenue', kind: 'quantitative' as const },
    { name: 'margin', kind: 'quantitative' as const },
  ];

  it('is supported and table switching infers distinct bar and line measures', () => {
    expect(V2_SUPPORTED_VIZ_TYPES).toContain('combo');
    const table = {
      version: 2,
      source: { kind: 'table', columnFormats: null, conditionalFormats: null, css: null },
    } as unknown as VizEnvelope;
    const next = setEnvelopeVizType(table, 'combo' as never, columns);
    const nextSource = next.source as unknown as {
      kind: string;
      recipe: string;
      bindings: Record<string, unknown>;
    };
    expect(nextSource.kind).toBe('recipe');
    expect(nextSource.recipe).toBe('minusx/combo@1');
    expect(nextSource.bindings).toEqual({ x: 'month', bar: 'revenue', line: 'margin' });
    expect(getEnvelopeVizType(next)).toBe('combo');
  });

  it('switching combo back to bar keeps its category and primary bar measure', () => {
    const combo = {
      version: 2,
      source: {
        kind: 'recipe', recipe: 'minusx/combo@1',
        bindings: { x: 'month', bar: 'revenue', line: 'margin' }, params: null,
      },
    } as unknown as VizEnvelope;
    const next = setEnvelopeVizType(combo, 'bar', columns);
    const spec = (next.source as unknown as {
      spec: { encoding: { x: { field: string }; y: { field: string } } };
    }).spec;
    expect(spec.encoding.x.field).toBe('month');
    expect(spec.encoding.y.field).toBe('revenue');
  });

  it('exposes Color / Split as an optional field zone that can be bound and removed', () => {
    const combo = {
      version: 2,
      source: {
        kind: 'recipe', recipe: 'minusx/combo@1',
        bindings: { x: 'month', bar: 'revenue', line: 'margin' }, params: null,
      },
    } as unknown as VizEnvelope;
    expect(getEnvelopeZones(combo)).toContainEqual({ channel: 'series', label: 'Color / Split' });

    const bound = setZoneField(combo, 'series', { name: 'region', kind: 'nominal' });
    expect((bound.source as unknown as { bindings: Record<string, string> }).bindings.series).toBe('region');

    const removed = removeZoneField(bound, 'series', 'region');
    expect((removed.source as unknown as { bindings: Record<string, string> }).bindings.series).toBeUndefined();
  });
});
