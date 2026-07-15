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

const comboViz = (params: Record<string, unknown> | null = null): VizEnvelope => ({
  version: 2,
  source: {
    kind: 'recipe', recipe: 'minusx/combo@1',
    bindings: { x: 'month', bar: 'revenue', line: 'margin' },
    params, columnFormats: null,
  },
}) as unknown as VizEnvelope;

function renderPanel(viz: VizEnvelope, onVizChange = vi.fn()) {
  renderWithProviders(
    <VegaVizPanel
      envelope={viz}
      columns={['month', 'revenue', 'margin']}
      types={['DATE', 'DOUBLE', 'DOUBLE']}
      onVizChange={onVizChange}
    />,
  );
  return onVizChange;
}

describe('VegaVizPanel — combo recipe settings', () => {
  it('Show line points toggle writes linePoints: false', async () => {
    const user = userEvent.setup();
    const onVizChange = renderPanel(comboViz());
    await user.click(screen.getByLabelText('Settings tab'));
    await user.click(screen.getByLabelText('Show line points'));

    const next = onVizChange.mock.calls.at(-1)![0] as VizEnvelope;
    const source = next.source as unknown as { params: Record<string, unknown> };
    expect(source.params.linePoints).toBe(false);
  });

  it('turning points back on removes the default param', async () => {
    const user = userEvent.setup();
    const onVizChange = renderPanel(comboViz({ linePoints: false }));
    await user.click(screen.getByLabelText('Settings tab'));
    await user.click(screen.getByLabelText('Show line points'));

    const next = onVizChange.mock.calls.at(-1)![0] as VizEnvelope;
    const source = next.source as unknown as { params: Record<string, unknown> | null };
    expect(source.params?.linePoints).toBeUndefined();
  });
});
