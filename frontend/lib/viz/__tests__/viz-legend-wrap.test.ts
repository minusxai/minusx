/**
 * Legend wrap planning: a top legend is one centered row of entries, so in a
 * narrow container (dashboard tile) it clips on BOTH edges and
 * hides trailing entries entirely. A signal-driven `columns` proved unreliable —
 * Vega bakes the legend layout against an unsettled width and never re-flows
 * (probed: the width signal read 232 regardless of the real container).
 *
 * Instead, `computeLegendPlan` decides the wrap in plain JS at build time — the
 * renderer knows the true container width, the actual entry labels come from
 * the data, and the house font is mono so label widths are EXACT. The plan caps
 * at three rows: beyond that it truncates to the first columns×3 entries and
 * surfaces the rest as a "+N more" list entry (the chart keeps all series).
 * `compileVegaLite` then injects the CONSTANTS onto discrete top legends, so
 * the fit-autosize pass sees the final legend height (no post-layout clipping).
 */
import { describe, it, expect } from 'vitest';
import { compileVegaLite, computeLegendPlan, createVegaView, setMainData } from '@/lib/viz/render-vega';

type CompiledLegend = { columns?: unknown; orient?: string; values?: unknown[]; title?: string };
const legendsOf = (vegaSpec: object): CompiledLegend[] =>
  ((vegaSpec as { legends?: CompiledLegend[] }).legends ?? []);

const BASE = {
  mark: 'bar',
  encoding: {
    x: { field: 'month', type: 'temporal' },
    y: { field: 'revenue', type: 'quantitative' },
    color: { field: 'region', type: 'nominal' },
  },
};

const CATEGORIES = ['Appetizers', 'Beverages', 'Desserts', 'Main Course', 'Sides'];
const ROWS = CATEGORIES.flatMap((region, i) => [
  { month: '2025-01-01', revenue: 10 + i, region },
  { month: '2025-02-01', revenue: 20 + i, region },
]);

describe('computeLegendPlan', () => {
  it('returns null when the single centered row fits (wide container)', () => {
    expect(computeLegendPlan(BASE, ROWS, 1200)).toBeNull();
  });

  it('wraps into a column grid when the container is narrow', () => {
    const plan = computeLegendPlan(BASE, ROWS, 400);
    expect(plan).not.toBeNull();
    expect(plan!.columns).toBeGreaterThanOrEqual(1);
    expect(plan!.columns).toBeLessThan(CATEGORIES.length);
  });

  it('uses the freed title width for MORE columns (394px dashboard tile: 3 cols, all 5 entries)', () => {
    const plan = computeLegendPlan(BASE, ROWS, 394);
    expect(plan).not.toBeNull();
    // widest entry 'Main Course' ≈109px; 394px holds 3 columns (4×109 overflows).
    expect(plan!.columns).toBe(3);
    expect(plan!.values).toBeUndefined(); // 3×2 grid holds all 5 — no "+N more"
  });

  it('reserves no axis gutter for axis-less charts (pie fits a single row in a 288px tile)', () => {
    const pie = {
      mark: 'arc',
      encoding: {
        theta: { field: 'revenue', type: 'quantitative' },
        color: { field: 'platform', type: 'nominal' },
      },
    };
    const rows = ['android', 'ios', 'web'].map(platform => ({ platform, revenue: 1 }));
    expect(computeLegendPlan(pie, rows, 288)).toBeNull();
  });

  it('a narrower container yields fewer (or equal) columns', () => {
    const at500 = computeLegendPlan(BASE, ROWS, 500)?.columns ?? CATEGORIES.length;
    const at300 = computeLegendPlan(BASE, ROWS, 300)?.columns ?? CATEGORIES.length;
    expect(at300).toBeLessThanOrEqual(at500);
  });

  it('does not truncate when the wrap fits within three rows', () => {
    const plan = computeLegendPlan(BASE, ROWS, 400);
    expect(plan).not.toBeNull();
    expect(plan!.values).toBeUndefined();
    expect(plan!.moreCount).toBeUndefined();
  });

  it('caps the wrap at three rows, reserving one slot for the "+N more" entry', () => {
    const many = Array.from({ length: 20 }, (_, i) => `Category ${String.fromCharCode(65 + i)}`);
    const rows = many.map(region => ({ month: '2025-01-01', revenue: 1, region }));
    const plan = computeLegendPlan(BASE, rows, 400);
    expect(plan).not.toBeNull();
    const { columns, values, moreCount } = plan!;
    // The sentinel occupies the grid's last slot, so real entries fill the rest.
    expect(values).toHaveLength(columns * 3 - 1);
    expect(moreCount).toBe(20 - (columns * 3 - 1));
    // Truncation shows the FIRST entries in display (ascending) order.
    expect(values![0]).toBe('Category A');
  });

  it('reads fold-transform keys as the legend labels (multi-Y fold)', () => {
    const spec = {
      mark: 'line',
      transform: [{ fold: ['revenue_actual', 'revenue_forecast'], as: ['__mx_key', '__mx_value'] }],
      encoding: {
        x: { field: 'month', type: 'temporal' },
        y: { field: '__mx_value', type: 'quantitative' },
        color: { field: '__mx_key', type: 'nominal' },
      },
    };
    // Rows do NOT contain the fold key — labels must come from the transform.
    const columns = computeLegendPlan(spec, [{ month: '2025-01-01', revenue_actual: 1, revenue_forecast: 2 }], 260);
    expect(columns).not.toBeNull();
  });

  it('returns null for authored legend columns, non-top orient, gradients, and missing color', () => {
    const authored = { ...BASE, encoding: { ...BASE.encoding, color: { ...BASE.encoding.color, legend: { columns: 2 } } } };
    expect(computeLegendPlan(authored, ROWS, 300)).toBeNull();
    const right = { ...BASE, encoding: { ...BASE.encoding, color: { ...BASE.encoding.color, legend: { orient: 'right' } } } };
    expect(computeLegendPlan(right, ROWS, 300)).toBeNull();
    const gradient = { ...BASE, encoding: { ...BASE.encoding, color: { field: 'revenue', type: 'quantitative' } } };
    expect(computeLegendPlan(gradient, ROWS, 300)).toBeNull();
    const plain = { mark: 'bar', encoding: { x: BASE.encoding.x, y: BASE.encoding.y } };
    expect(computeLegendPlan(plain, ROWS, 300)).toBeNull();
  });

  it('finds the color channel inside layered specs', () => {
    const spec = {
      layer: [
        { mark: 'bar', encoding: BASE.encoding },
        { mark: 'line', encoding: { x: BASE.encoding.x, y: { field: 'margin', type: 'quantitative' } } },
      ],
    };
    expect(computeLegendPlan(spec, ROWS, 300)).not.toBeNull();
  });
});

describe('compileVegaLite legend plan injection', () => {
  it('injects the planned constant onto the discrete top legend', () => {
    const vegaSpec = compileVegaLite(BASE as Record<string, unknown>, 'dark', { legendPlan: { columns: 2 } });
    expect(legendsOf(vegaSpec)[0]?.columns).toBe(2);
  });

  it('leaves legends untouched when no plan is given', () => {
    const vegaSpec = compileVegaLite(BASE as Record<string, unknown>, 'dark');
    expect(legendsOf(vegaSpec)[0]?.columns).toBeUndefined();
  });

  it('injects capped values plus a "+N more" LIST ENTRY when truncating', () => {
    const plan = { columns: 2, values: ['Appetizers', 'Beverages', 'Desserts', 'Main Course', 'Sides'], moreCount: 15 };
    const legend = legendsOf(compileVegaLite(BASE as Record<string, unknown>, 'dark', { legendPlan: plan }))[0];
    expect(legend?.columns).toBe(2);
    expect(legend?.values).toEqual([...plan.values, '+15 more']);
  });

  it('suppresses the default field-name legend title', () => {
    const legend = legendsOf(compileVegaLite(BASE as Record<string, unknown>, 'dark'))[0];
    expect(legend?.title).toBeUndefined();
  });

  it('suppresses explicitly authored legend titles and channel aliases', () => {
    const explicit = { ...BASE, encoding: { ...BASE.encoding, color: { ...BASE.encoding.color, legend: { title: 'Menu Section' } } } };
    expect(legendsOf(compileVegaLite(explicit as Record<string, unknown>, 'dark'))[0]?.title).toBeUndefined();
    const aliased = { ...BASE, encoding: { ...BASE.encoding, color: { ...BASE.encoding.color, title: 'Product Category' } } };
    expect(legendsOf(compileVegaLite(aliased as Record<string, unknown>, 'dark'))[0]?.title).toBeUndefined();
  });

  it('suppresses default legend titles inside layered specs too', () => {
    const spec = {
      layer: [
        { mark: 'bar', encoding: BASE.encoding },
        { mark: 'line', encoding: { x: BASE.encoding.x, y: { field: 'margin', type: 'quantitative' } } },
      ],
    };
    expect(legendsOf(compileVegaLite(spec as Record<string, unknown>, 'dark'))[0]?.title).toBeUndefined();
  });

  it('renders the "+N more" entry in the SVG output and drops hidden entries', async () => {
    const vegaSpec = compileVegaLite(BASE as Record<string, unknown>, 'dark', {
      legendPlan: { columns: 2, values: ['Appetizers', 'Beverages', 'Desserts'], moreCount: 2 },
    });
    const view = createVegaView(vegaSpec, [], { renderer: 'none', width: 400, height: 300 });
    setMainData(view, ROWS);
    await view.runAsync();
    const svg = await view.toSVG();
    view.finalize();
    // Legend labels are <text> CONTENT; the series itself stays in the chart
    // (its marks still carry "Sides" in aria attributes — only the legend elides).
    expect(svg).toContain('>+2 more</text>');
    expect(svg).toContain('>Desserts</text>');
    expect(svg).not.toContain('>Sides</text>');
  });

  it('never overrides author-declared columns', () => {
    const spec = { ...BASE, encoding: { ...BASE.encoding, color: { ...BASE.encoding.color, legend: { columns: 4 } } } };
    const vegaSpec = compileVegaLite(spec as Record<string, unknown>, 'dark', { legendPlan: { columns: 2 } });
    expect(legendsOf(vegaSpec)[0]?.columns).toBe(4);
  });

  it('never touches gradient (continuous) legends', () => {
    const spec = { ...BASE, encoding: { ...BASE.encoding, color: { field: 'revenue', type: 'quantitative' } } };
    const vegaSpec = compileVegaLite(spec as Record<string, unknown>, 'dark', { legendPlan: { columns: 2 } });
    expect(legendsOf(vegaSpec)[0]?.columns).toBeUndefined();
  });

  it('the injected plan survives a headless Vega runtime evaluation', async () => {
    const vegaSpec = compileVegaLite(BASE as Record<string, unknown>, 'dark', {
      legendPlan: { columns: 2, values: ['Appetizers', 'Beverages', 'Desserts', 'Main Course'], moreCount: 1 },
    });
    const view = createVegaView(vegaSpec, [], { renderer: 'none', width: 300, height: 300 });
    setMainData(view, ROWS);
    await expect(view.runAsync()).resolves.toBeDefined();
    view.finalize();
  });
});
