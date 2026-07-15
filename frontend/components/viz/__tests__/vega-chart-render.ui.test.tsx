/**
 * <VegaChart> must leave visible marks in the DOM after mounting — the whole chart, not
 * just a valid dataflow.
 *
 * Regression: charts WITH a shared-tooltip plan (bar/line/area/combo) rendered, then went
 * BLANK with no error: vega's `View.tooltip()` re-initializes the renderer (synchronously
 * clears the SVG), and we called it AFTER the first runAsync with no re-run after — the
 * fully-computed scenegraph never made it back into the DOM until some later interaction
 * happened to re-run the view. The suppression must happen BEFORE the first run.
 * Charts without a plan (pie) never call it, which is why only cartesian types blanked.
 */
import { waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import VegaChart from '@/components/viz/VegaChart';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';

const ROWS = [
  { platform: 'android', revenue: 1050000 },
  { platform: 'ios', revenue: 1360000 },
  { platform: 'web', revenue: 606000 },
];

const envelope = (spec: Record<string, unknown>): VizEnvelope =>
  ({ version: 2, source: { kind: 'vega-lite', grammar: 'vega-lite@6', spec } }) as unknown as VizEnvelope;

// Bar with nominal x + quantitative y → HAS a shared-tooltip plan (the regression path).
const barEnvelope = envelope({
  mark: { type: 'bar' },
  encoding: {
    x: { field: 'platform', type: 'nominal' },
    y: { field: 'revenue', type: 'quantitative', aggregate: 'sum' },
  },
});

// Pie → NO tooltip plan (control: this path never blanked).
const pieEnvelope = envelope({
  mark: { type: 'arc' },
  encoding: {
    color: { field: 'platform', type: 'nominal' },
    theta: { field: 'revenue', type: 'quantitative' },
  },
});

const marksIn = (container: HTMLElement) =>
  container.querySelectorAll('svg g[class*="mark-"]');

describe('VegaChart renders marks into the DOM', () => {
  it('a shared-tooltip chart (bar) keeps its marks after the build settles', async () => {
    const { container } = renderWithProviders(
      <VegaChart envelope={barEnvelope} rows={ROWS} colorMode="dark" />,
    );
    // The build is async (fonts, compile, runAsync) — wait for marks to appear...
    await waitFor(() => expect(marksIn(container).length).toBeGreaterThan(0), { timeout: 5000 });
    // ...then assert they SURVIVE the rest of the build (the tooltip-suppression call
    // used to wipe the SVG right after the first successful render).
    await new Promise(r => setTimeout(r, 50));
    expect(marksIn(container).length).toBeGreaterThan(0);
  });

  it('a non-tooltip chart (pie) renders marks (control)', async () => {
    const { container } = renderWithProviders(
      <VegaChart envelope={pieEnvelope} rows={ROWS} colorMode="dark" />,
    );
    await waitFor(() => expect(marksIn(container).length).toBeGreaterThan(0), { timeout: 5000 });
  });

  it('vega dataflow errors (logged, not thrown) surface as the error card — never a silent blank', async () => {
    // Vega LOGS dataflow errors (runAsync still resolves) and leaves the renderer broken.
    // Regression: an invalid d3 format on an ordinal axis blanked the chart with no error.
    const badFormat = envelope({
      mark: { type: 'rect' },
      encoding: {
        // '%b %Y' is a date pattern; on an ordinal axis it reaches d3-format → throws in-flow.
        x: { field: 'platform', type: 'ordinal', axis: { format: '%b %Y' } },
        y: { field: 'platform', type: 'nominal' },
        color: { field: 'revenue', type: 'quantitative', aggregate: 'sum' },
      },
    });
    const { findByLabelText } = renderWithProviders(
      <VegaChart envelope={badFormat} rows={ROWS} colorMode="dark" />,
    );
    const overlay = await findByLabelText('Vega chart error');
    expect(overlay.textContent).toContain('Chart configuration error');
    expect(overlay.textContent?.toLowerCase()).toContain('format');
  });

  it('render failures show the friendly ChartError card, not raw error text', async () => {
    // A recipe reference missing a required binding — materialization fails.
    const broken = { version: 2, source: { kind: 'recipe', recipe: 'minusx/point-map@1', bindings: { lat: 'a' } } } as unknown as VizEnvelope;
    const { findByLabelText } = renderWithProviders(
      <VegaChart envelope={broken} rows={ROWS} colorMode="dark" />,
    );
    const overlay = await findByLabelText('Vega chart error');
    // The V1-style card: a friendly title plus the specific message — not a bare dump.
    expect(overlay.textContent).toContain('Chart configuration error');
    expect(overlay.textContent).toContain('missing binding');
  });
});
