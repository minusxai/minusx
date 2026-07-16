/**
 * Trend recipe panel — Settings hosts the two recipe params users actually need
 * live: "Skip partial period" (compareMode: previous — the -66% partial-week
 * trap) and the sparkline toggle. Params write into the envelope's recipe source.
 */
import React from 'react'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/helpers/render-with-providers'
import { VegaVizPanel } from '@/components/viz/VegaVizPanel'
import type { VizEnvelope } from '@/lib/validation/atlas-schemas'

vi.mock('@/lib/hooks/useConfigs', () => ({
  useConfigs: () => ({
    config: { branding: { agentName: 'Agent' } },
    configs: [],
    loading: false,
    error: null,
    reloadConfigs: vi.fn(),
  }),
}))

const trendViz = (params: Record<string, unknown> | null = null): VizEnvelope => ({
  version: 2,
  source: {
    kind: 'recipe',
    recipe: 'minusx/trend@1',
    bindings: { date: 'week_start', value: ['revenue'] },
    params,
    columnFormats: null,
  },
}) as unknown as VizEnvelope

function renderPanel(viz: VizEnvelope, onVizChange = vi.fn()) {
  renderWithProviders(
    <VegaVizPanel
      envelope={viz}
      columns={['week_start', 'revenue']}
      types={['DATE', 'DOUBLE']}
      onVizChange={onVizChange}
    />
  )
  return onVizChange
}

describe('VegaVizPanel — trend recipe settings', () => {
  it('Skip partial period toggle writes compareMode: previous', async () => {
    const user = userEvent.setup()
    const onVizChange = renderPanel(trendViz())
    await user.click(screen.getByLabelText('Settings tab'))
    await user.click(screen.getByLabelText('Skip partial period'))

    const next = onVizChange.mock.calls.at(-1)![0] as VizEnvelope
    const source = next.source as unknown as { params: Record<string, unknown> }
    expect(source.params.compareMode).toBe('previous')
  })

  it('toggling back to last-period removes the param (defaults stay clean)', async () => {
    const user = userEvent.setup()
    const onVizChange = renderPanel(trendViz({ compareMode: 'previous' }))
    await user.click(screen.getByLabelText('Settings tab'))
    await user.click(screen.getByLabelText('Skip partial period'))

    const next = onVizChange.mock.calls.at(-1)![0] as VizEnvelope
    const source = next.source as unknown as { params: Record<string, unknown> | null }
    expect(source.params?.compareMode).toBeUndefined()
  })

  it('Sparkline toggle writes sparkline: false', async () => {
    const user = userEvent.setup()
    const onVizChange = renderPanel(trendViz())
    await user.click(screen.getByLabelText('Settings tab'))
    await user.click(screen.getByLabelText('Toggle sparkline'))

    const next = onVizChange.mock.calls.at(-1)![0] as VizEnvelope
    const source = next.source as unknown as { params: Record<string, unknown> }
    expect(source.params.sparkline).toBe(false)
  })

  it('non-trend recipes keep the plain hint (no trend toggles)', async () => {
    const user = userEvent.setup()
    const waterfall = {
      version: 2,
      source: { kind: 'recipe', recipe: 'minusx/waterfall@1', bindings: { category: 'week_start', value: 'revenue' }, params: null, columnFormats: null },
    } as unknown as VizEnvelope
    renderPanel(waterfall)
    await user.click(screen.getByLabelText('Settings tab'))
    expect(screen.queryByLabelText('Skip partial period')).not.toBeInTheDocument()
  })
})
