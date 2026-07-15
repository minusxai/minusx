import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { VegaVizPanel } from '@/components/viz/VegaVizPanel';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';

vi.mock('@/lib/hooks/useConfigs', () => ({
  useConfigs: () => ({
    config: { branding: { agentName: 'Agent' } },
    configs: [], loading: false, error: null, reloadConfigs: vi.fn(),
  }),
}));

const envelope = (spec: Record<string, unknown>): VizEnvelope => ({
  version: 2,
  source: { kind: 'vega-lite', grammar: 'vega-lite@6', spec },
}) as unknown as VizEnvelope;

// GENUINELY custom: the overlay layer FIELD-encodes a second measure, so it is NOT the
// recognized base+annotation shape — a datum-only rule layer now folds in as "Area with
// a reference line" and keeps the full panel (see viz-annotated-unit.test.ts).
const CUSTOM = envelope({
  layer: [
    { mark: 'area', encoding: { x: { field: 'week_start', type: 'temporal' }, y: { field: 'revenue', type: 'quantitative' } } },
    { mark: 'rule', encoding: { y: { field: 'revenue2', type: 'quantitative', aggregate: 'mean' } } },
  ],
});

const RAW_COMBO = envelope({
  layer: [
    { mark: 'bar', encoding: { x: { field: 'week_start', type: 'temporal' }, y: { field: 'revenue', type: 'quantitative' } } },
    { mark: 'line', encoding: { x: { field: 'week_start', type: 'temporal' }, y: { field: 'revenue2', type: 'quantitative' } } },
  ],
  resolve: { scale: { y: 'independent' } },
});

const BAR = envelope({
  mark: { type: 'bar' },
  encoding: {
    x: { field: 'week_start', type: 'temporal' },
    y: { field: 'revenue', type: 'quantitative' },
  },
});

function renderPanel(viz: VizEnvelope, onVizChange = vi.fn()) {
  renderWithProviders(
    <VegaVizPanel
      envelope={viz}
      columns={['week_start', 'revenue', 'revenue2']}
      types={['DATE', 'DOUBLE', 'DOUBLE']}
      onVizChange={onVizChange}
    />,
  );
  return onVizChange;
}

describe('VegaVizPanel — Custom state', () => {
  it('keeps the icon grid, selects Custom, and exposes no drop zones', () => {
    renderPanel(CUSTOM);
    expect(screen.getByLabelText('Bar')).toBeInTheDocument();
    expect(screen.getByLabelText('Combo')).toBeInTheDocument();
    expect(screen.getByLabelText('Custom')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Custom')).toHaveAttribute('data-informational-state', 'active');
    expect(screen.getByText('week_start')).toBeInTheDocument();
    expect(screen.getByText('revenue')).toBeInTheDocument();
    expect(screen.getByText('revenue2')).toBeInTheDocument();
    expect(screen.queryByLabelText('Vega encoding drop zones')).not.toBeInTheDocument();
    expect(screen.getByText(/no editable drop zones/i)).toBeInTheDocument();
  });

  it('shows Custom with an explanatory tooltip while a known family is selected', () => {
    renderPanel(BAR);
    const custom = screen.getByLabelText('Custom');
    expect(screen.getByLabelText('Bar')).toHaveAttribute('aria-pressed', 'true');
    expect(custom).toHaveAttribute('data-informational-state', 'inactive');
    expect(custom).toHaveAttribute(
      'title',
      'Custom is selected automatically for agent-authored or unsupported specs. Ask the agent to customize.',
    );
  });

  it('clicking Custom selects a UI-only preview without touching the envelope', async () => {
    const user = userEvent.setup();
    const onVizChange = renderPanel(BAR);
    const custom = screen.getByLabelText('Custom');

    await user.click(custom);
    // Selection moves to Custom, but the spec is never modified — custom is
    // derived, not a conversion target.
    expect(onVizChange).not.toHaveBeenCalled();
    expect(custom).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Bar')).toHaveAttribute('aria-pressed', 'false');
    // Fields swaps to the informational state: no drop zones, "ask the agent" copy.
    expect(screen.queryByLabelText('Vega encoding drop zones')).not.toBeInTheDocument();
    expect(screen.getByText(/ask the agent/i)).toBeInTheDocument();

    // Clicking the current family exits the preview without converting.
    await user.click(screen.getByLabelText('Bar'));
    expect(onVizChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Bar')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Vega encoding drop zones')).toBeInTheDocument();
  });

  it('Settings shows the custom info during the preview, not the previous type toggles', async () => {
    const user = userEvent.setup();
    renderPanel(BAR);
    await user.click(screen.getByLabelText('Custom'));
    await user.click(screen.getByLabelText('Settings tab'));

    expect(screen.queryByLabelText('Toggle stacked')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Toggle log scale')).not.toBeInTheDocument();
    expect(screen.getByText(/ask the agent/i)).toBeInTheDocument();

    // Exiting the preview restores the real type's settings.
    await user.click(screen.getByLabelText('Bar'));
    expect(screen.getByLabelText('Toggle stacked')).toBeInTheDocument();
  });

  it('converting to a different family from the Custom preview still works', async () => {
    const user = userEvent.setup();
    const onVizChange = renderPanel(BAR);
    await user.click(screen.getByLabelText('Custom'));
    await user.click(screen.getByLabelText('Line'));

    const next = onVizChange.mock.calls.at(-1)![0] as VizEnvelope;
    const spec = (next.source as unknown as { spec: Record<string, unknown> }).spec;
    expect(spec.mark).toMatchObject({ type: 'line' });
  });

  it('selects Combo—not Custom—for a canonical authored bar+line composition', () => {
    renderPanel(RAW_COMBO);
    expect(screen.getByLabelText('Combo')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Custom')).toHaveAttribute('aria-pressed', 'false');
  });

  it('switching Custom to Bar reconstructs a safe unit spec from result columns', async () => {
    const user = userEvent.setup();
    const onVizChange = renderPanel(CUSTOM);
    await user.click(screen.getByLabelText('Bar'));

    const next = onVizChange.mock.calls.at(-1)![0] as VizEnvelope;
    const spec = (next.source as unknown as { spec: Record<string, unknown> }).spec;
    expect(spec.mark).toEqual({ type: 'bar' });
    expect(spec).not.toHaveProperty('layer');
    expect(spec.encoding).toEqual({
      x: { field: 'week_start', type: 'temporal' },
      y: { field: 'revenue', type: 'quantitative', aggregate: 'sum' },
    });
  });
});
