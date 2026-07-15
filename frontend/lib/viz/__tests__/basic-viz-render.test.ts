/**
 * Basic cartesian viz types must render their marks headlessly (regression: a plain bar —
 * nominal x, SUM y — came up BLANK in the UI after switching viz type). One category + one
 * measure, the minimal shape the icon selector produces.
 */
import { describe, it, expect } from 'vitest';
import { renderEnvelopeToSvg, compileVegaLite, createVegaView } from '@/lib/viz/render-vega';
import { injectGuideMark } from '@/lib/viz/guide-mark';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';

const ROWS = [
  { platform: 'android', revenue: 1050000 },
  { platform: 'ios', revenue: 1360000 },
  { platform: 'web', revenue: 606000 },
];

const env = (spec: Record<string, unknown>): VizEnvelope =>
  ({ version: 2, source: { kind: 'vega-lite', grammar: 'vega-lite@6', spec } }) as unknown as VizEnvelope;

const render = (spec: Record<string, unknown>) =>
  renderEnvelopeToSvg(env(spec), ROWS, 'dark', { width: 400, height: 300 });

describe('basic viz types render marks', () => {
  it('bar (nominal x, SUM y) draws rect marks', async () => {
    const svg = await render({ mark: { type: 'bar' }, encoding: { x: { field: 'platform', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative', aggregate: 'sum' } } });
    expect(svg).toContain('mark-rect');
    expect(svg).toContain('android');
  });

  it('line (nominal x, single series) draws a line path', async () => {
    const svg = await render({ mark: { type: 'line' }, encoding: { x: { field: 'platform', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative', aggregate: 'sum' } } });
    expect(svg).toContain('mark-line');
  });

  it('bar coloured by the same field as x still draws bars', async () => {
    const svg = await render({ mark: { type: 'bar' }, encoding: { x: { field: 'platform', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative', aggregate: 'sum' }, color: { field: 'platform', type: 'nominal' } } });
    expect(svg).toContain('mark-rect');
  });

  // The shared-tooltip guide rule, injected into the compiled spec, must not affect
  // what renders — same marks with or without it.
  it('the guide-mark injection does not blank the bar', async () => {
    const vegaSpec = compileVegaLite(
      { mark: { type: 'bar' }, encoding: { x: { field: 'platform', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative', aggregate: 'sum' } } },
      'dark',
    ) as unknown as Record<string, unknown>;
    injectGuideMark(vegaSpec);
    const view = createVegaView(vegaSpec as never, ROWS, { renderer: 'none', width: 400, height: 300 });
    await view.runAsync();
    const svg = await view.toSVG();
    view.finalize();
    expect(svg).toContain('mark-rect'); // bars still there
  });
});
