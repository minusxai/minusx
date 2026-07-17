/**
 * Adaptive x-axis label angle (house default). Vega-Lite's built-in default for
 * discrete x axes is labelAngle -90 — every category chart got vertical labels.
 * The renderer plans a nicer default from the ACTUAL labels and container width
 * (same compile-time-constant approach as the legend wrap plan):
 *   horizontal (0) when labels fit their band · slanted (-45) when crowded ·
 *   Vega-Lite's vertical default only for ultra-dense axes (heatmap weeks).
 * An author-set labelAngle (or axis: null) is never overridden.
 */
import { describe, it, expect } from 'vitest';
import { computeXLabelAngle, compileVegaLite } from '@/lib/viz/render-vega';

const rowsFor = (labels: string[]) => labels.map(l => ({ cat: l, revenue: 10 }));

const barSpec = (extraX: Record<string, unknown> = {}): Record<string, unknown> => ({
  mark: { type: 'bar' },
  encoding: {
    x: { field: 'cat', type: 'nominal', ...extraX },
    y: { field: 'revenue', type: 'quantitative', aggregate: 'sum' },
  },
});

describe('computeXLabelAngle', () => {
  it('few short labels in a wide container → horizontal (0)', () => {
    expect(computeXLabelAngle(barSpec(), rowsFor(['Jan', 'Feb', 'Mar']), 800)).toBe(0);
  });

  it('long labels in a narrow container → slanted (-45)', () => {
    const labels = Array.from({ length: 12 }, (_, i) => `Category name ${i + 1}`);
    expect(computeXLabelAngle(barSpec(), rowsFor(labels), 480)).toBe(-45);
  });

  it('ultra-dense axis → null (leaves Vega-Lite vertical default)', () => {
    const labels = Array.from({ length: 120 }, (_, i) => `2024-W${i}`);
    expect(computeXLabelAngle(barSpec(), rowsFor(labels), 480)).toBe(null);
  });

  it('an authored labelAngle is never overridden', () => {
    expect(computeXLabelAngle(barSpec({ axis: { labelAngle: 30 } }), rowsFor(['Jan', 'Feb']), 800)).toBe(null);
  });

  it('temporal / quantitative x → null (already horizontal by default)', () => {
    expect(computeXLabelAngle(barSpec({ type: 'temporal' }), rowsFor(['2024-01-01']), 800)).toBe(null);
    expect(computeXLabelAngle(barSpec({ type: 'quantitative' }), rowsFor(['1']), 800)).toBe(null);
  });
});

describe('compileVegaLite xLabelAngle option', () => {
  const xAxisOf = (vega: Record<string, unknown>) =>
    (vega.axes as Array<Record<string, unknown>>).find(a => a.scale === 'x')!;

  it('bakes the planned angle onto the compiled x axis', () => {
    const vega = compileVegaLite(barSpec(), 'dark', { xLabelAngle: 0 }) as unknown as Record<string, unknown>;
    expect(xAxisOf(vega).labelAngle).toBe(0);
  });

  it('omitting the option keeps Vega-Lite defaults (no injected angle)', () => {
    const vega = compileVegaLite(barSpec(), 'dark') as unknown as Record<string, unknown>;
    // VL's own discrete default (-90) comes through the axis config/encode — the
    // planner simply doesn't interfere.
    expect(xAxisOf(vega).labelAngle ?? 270).not.toBe(0);
  });
});
