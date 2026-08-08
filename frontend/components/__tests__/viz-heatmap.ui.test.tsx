/**
 * Heatmap in the selector: NOT a static tile on any surface — it ships as a
 * workspace recipe FILE (seeded by the workspace template) and surfaces as a
 * Workspace tile instead. Saved rect-spec heatmaps keep rendering and keep
 * their settings behavior; only the built-in offering is gone.
 */
import React from 'react'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/helpers/render-with-providers'
import { VizTypeSelector } from '@/components/question/VizTypeSelector'
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

const pivotViz: VizEnvelope = {
  version: 2,
  source: {
    kind: 'pivot',
    config: { rows: ['region'], columns: ['month'], values: [{ column: 'revenue', aggFunction: 'SUM' }] },
    columnFormats: null,
    css: null,
  },
} as unknown as VizEnvelope

describe('VizTypeSelector — heatmap and radar are workspace recipes, not tiles', () => {
  it('no surface renders a Heatmap or Radar tile, with or without includeV2Only', () => {
    renderWithProviders(
      <VizTypeSelector value="bar" onChange={vi.fn()} orientation="grouped" />
    )
    expect(screen.queryByLabelText('Heatmap')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Radar')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Bar')).toBeInTheDocument()

    renderWithProviders(
      <VizTypeSelector value="bar" onChange={vi.fn()} orientation="grouped" includeV2Only />
    )
    expect(screen.queryByLabelText('Heatmap')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Radar')).not.toBeInTheDocument()
  })

  it('the Vega panel offers no Heatmap tile for a pivot envelope', () => {
    renderWithProviders(
      <VegaVizPanel
        envelope={pivotViz}
        columns={['region', 'month', 'revenue']}
        types={['VARCHAR', 'VARCHAR', 'DOUBLE']}
        onVizChange={vi.fn()}
      />
    )
    expect(screen.queryByLabelText('Heatmap')).not.toBeInTheDocument()
  })
})

describe('VegaVizPanel — heatmap settings hide cartesian-only toggles', () => {
  it('no Stacked / Log scale switches for a rect heatmap spec', async () => {
    const user = userEvent.setup()
    const heatmapViz = {
      version: 2,
      source: {
        kind: 'vega-lite',
        grammar: 'vega-lite@6',
        spec: {
          mark: { type: 'rect' },
          encoding: {
            x: { field: 'month', type: 'nominal' },
            y: { field: 'region', type: 'nominal' },
            color: { field: 'revenue', aggregate: 'sum', type: 'quantitative' },
          },
        },
      },
    } as unknown as VizEnvelope
    renderWithProviders(
      <VegaVizPanel envelope={heatmapViz} columns={['region', 'month', 'revenue']} types={['VARCHAR', 'VARCHAR', 'DOUBLE']} onVizChange={vi.fn()} />
    )
    await user.click(screen.getByLabelText('Settings tab'))
    expect(screen.queryByLabelText('Toggle stacked')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Toggle log scale')).not.toBeInTheDocument()
  })
})
