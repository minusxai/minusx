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

const singleValueViz = (params: Record<string, unknown> | null = null): VizEnvelope => ({
  version: 2,
  source: {
    kind: 'recipe',
    recipe: 'minusx/single-value@1',
    bindings: { value: 'revenue' },
    params,
    columnFormats: null,
  },
}) as unknown as VizEnvelope;

function renderPanel(viz: VizEnvelope, onVizChange = vi.fn()) {
  renderWithProviders(
    <VegaVizPanel
      envelope={viz}
      columns={['revenue']}
      types={['DOUBLE']}
      onVizChange={onVizChange}
    />,
  );
  return onVizChange;
}

describe('VegaVizPanel — single-value recipe settings', () => {
  it('Show label toggle writes showLabel: false', async () => {
    const user = userEvent.setup();
    const onVizChange = renderPanel(singleValueViz());
    await user.click(screen.getByLabelText('Settings tab'));
    await user.click(screen.getByLabelText('Show label'));

    const next = onVizChange.mock.calls.at(-1)![0] as VizEnvelope;
    const source = next.source as unknown as { params: Record<string, unknown> };
    expect(source.params.showLabel).toBe(false);
  });

  it('turning the label back on removes the default param', async () => {
    const user = userEvent.setup();
    const onVizChange = renderPanel(singleValueViz({ showLabel: false }));
    await user.click(screen.getByLabelText('Settings tab'));
    await user.click(screen.getByLabelText('Show label'));

    const next = onVizChange.mock.calls.at(-1)![0] as VizEnvelope;
    const source = next.source as unknown as { params: Record<string, unknown> | null };
    expect(source.params?.showLabel).toBeUndefined();
  });
});
