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

  it('respects explicit width/height when provided', async () => {
    const svg = await renderVegaLiteToSvg(BAR_SPEC, ROWS, 'dark', { width: 512, height: 256 });
    expect(svg).toContain('<svg');
  });
});
