/**
 * Headless render pipeline: VL spec + rows + theme → SVG (RFC §3 headless sibling).
 * This exercises the full chain the browser component uses: prepare → theme config →
 * vega-lite compile → vega parse (ast + interpreter) → named data injection → SVG.
 */
import { describe, it, expect } from 'vitest';
import { renderVegaLiteToSvg } from '@/lib/viz/render-vega';

const BAR_SPEC = {
  mark: 'bar',
  encoding: {
    x: { field: 'region', type: 'nominal' },
    y: { field: 'revenue', type: 'quantitative' },
  },
};

const ROWS = [
  { region: 'AlphaRegion', revenue: 100 },
  { region: 'BetaRegion', revenue: 250 },
  { region: 'GammaRegion', revenue: 175 },
];

describe('renderVegaLiteToSvg', () => {
  it('renders a bar chart to SVG with rect marks and the injected data', async () => {
    const svg = await renderVegaLiteToSvg(BAR_SPEC, ROWS, 'dark');
    expect(svg).toContain('<svg');
    expect(svg).toContain('mark-rect'); // vega tags bar marks with role class
    expect(svg).toContain('AlphaRegion'); // axis labels come from the injected rows
    expect(svg).toContain('BetaRegion');
  });

  it('applies the MinusX theme (JetBrains Mono)', async () => {
    const svg = await renderVegaLiteToSvg(BAR_SPEC, ROWS, 'dark');
    expect(svg).toContain('JetBrains Mono');
  });

  it('light and dark modes produce different axis label colors', async () => {
    const light = await renderVegaLiteToSvg(BAR_SPEC, ROWS, 'light');
    const dark = await renderVegaLiteToSvg(BAR_SPEC, ROWS, 'dark');
    expect(light).toContain('#57606A'); // LIGHT_THEME.fgMuted
    expect(dark).toContain('#8B949E');  // DARK_THEME.fgMuted
    expect(light).not.toEqual(dark);
  });

  it('renders a layered dual-axis spec (the combo case)', async () => {
    const spec = {
      layer: [
        { mark: 'bar', encoding: { x: { field: 'region', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative' } } },
        { mark: 'line', encoding: { x: { field: 'region', type: 'nominal' }, y: { field: 'margin', type: 'quantitative' } } },
      ],
      resolve: { scale: { y: 'independent' } },
    };
    const rows = ROWS.map((r, i) => ({ ...r, margin: 10 + i }));
    const svg = await renderVegaLiteToSvg(spec, rows, 'dark');
    expect(svg).toContain('mark-rect');
    expect(svg).toContain('mark-line');
  });

  it('renders deep-frozen spec AND rows (Redux immer-freezes state; vega/vega-lite mutate their inputs)', async () => {
    const deepFreeze = <T,>(o: T): T => {
      if (o && typeof o === 'object') { Object.values(o).forEach(deepFreeze); Object.freeze(o); }
      return o;
    };
    const spec = deepFreeze(JSON.parse(JSON.stringify({ ...BAR_SPEC, mark: { type: 'bar' } })));
    const rows = deepFreeze(ROWS.map(r => ({ ...r })));
    const svg = await renderVegaLiteToSvg(spec, rows as unknown as Record<string, unknown>[], 'dark');
    expect(svg).toContain('mark-rect');
    expect(svg).toContain('AlphaRegion');
  });

  it('discrete-axis charts fill the container (width: container defeats step-sizing)', async () => {
    // A 3-category bar without explicit width would be step-sized (~60px) — the
    // compiled spec must carry container sizing so few categories still fill.
    const { compileVegaLite } = await import('@/lib/viz/render-vega');
    const vegaSpec = compileVegaLite({
      mark: 'bar',
      encoding: { x: { field: 'region', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative' } },
    }, 'dark');
    expect(JSON.stringify(vegaSpec)).toContain('container');
  });

  it('respects explicit spec width (author opt-out of container fill)', async () => {
    const { compileVegaLite } = await import('@/lib/viz/render-vega');
    const vegaSpec = compileVegaLite({
      width: 200,
      mark: 'bar',
      encoding: { x: { field: 'region', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative' } },
    }, 'dark');
    expect(JSON.stringify(vegaSpec)).not.toContain('"container"');
  });

  it('respects explicit width/height when provided', async () => {
    const svg = await renderVegaLiteToSvg(BAR_SPEC, ROWS, 'dark', { width: 512, height: 256 });
    expect(svg).toContain('<svg');
  });

  // A bare `mark: arc` (what an agent naturally authors) must render as the house
  // donut — the styling lives in config.arc, not in every saved spec.
  it('a minimal arc mark compiles with the themed responsive donut hole', async () => {
    const { compileVegaLite } = await import('@/lib/viz/render-vega');
    const vegaSpec = compileVegaLite({
      mark: { type: 'arc' },
      encoding: {
        theta: { field: 'revenue', type: 'quantitative', aggregate: 'sum' },
        color: { field: 'region', type: 'nominal' },
      },
    }, 'dark') as unknown as {
      marks: Array<{ style: string[]; encode: { update: Record<string, unknown> } }>;
      config: { style: { arc: Record<string, unknown> } };
    };
    // The expr compiles into the mark encode as a signal; the static props ride
    // the output's style config (the mark carries style: ['arc']) and vega applies
    // them at render.
    expect(vegaSpec.marks[0].encode.update.innerRadius).toEqual({ signal: 'min(width,height)/2 * 0.45' });
    expect(vegaSpec.marks[0].style).toContain('arc');
    expect(vegaSpec.config.style.arc.cornerRadius).toBe(6);
    expect(vegaSpec.config.style.arc.padAngle).toBe(0.015);
  });

  it('an explicit spec innerRadius overrides the theme donut (solid pie opt-out)', async () => {
    const { compileVegaLite } = await import('@/lib/viz/render-vega');
    const vegaSpec = compileVegaLite({
      mark: { type: 'arc', innerRadius: 0 },
      encoding: {
        theta: { field: 'revenue', type: 'quantitative', aggregate: 'sum' },
        color: { field: 'region', type: 'nominal' },
      },
    }, 'dark') as unknown as { marks: Array<{ encode: { update: Record<string, unknown> } }> };
    expect(vegaSpec.marks[0].encode.update.innerRadius).toEqual({ value: 0 });
  });
});
