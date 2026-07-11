/**
 * Heatmap viz-type icon — V2-only entry in the selector: classic surfaces never
 * see it (no ECharts renderer); the Vega panel offers it and clicking converts
 * the envelope to a native rect spec.
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

describe('VizTypeSelector — v2-only heatmap entry', () => {
  it('classic surfaces (no includeV2Only) never render the Heatmap entry', () => {
    renderWithProviders(
      <VizTypeSelector value="bar" onChange={vi.fn()} orientation="grouped" />
    )
    expect(screen.queryByLabelText('Heatmap')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Bar')).toBeInTheDocument()
  })

  it('includeV2Only surfaces the Heatmap entry and reports clicks', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderWithProviders(
      <VizTypeSelector value="bar" onChange={onChange} orientation="grouped" includeV2Only />
    )
    await user.click(screen.getByLabelText('Heatmap'))
    expect(onChange).toHaveBeenCalledWith('heatmap')
  })
})

describe('VegaVizPanel — pivot to heatmap via the icon', () => {
  it('clicking Heatmap converts the pivot envelope into a native rect spec', async () => {
    const user = userEvent.setup()
    const onVizChange = vi.fn()
    renderWithProviders(
      <VegaVizPanel
        envelope={pivotViz}
        columns={['region', 'month', 'revenue']}
        types={['VARCHAR', 'VARCHAR', 'DOUBLE']}
        onVizChange={onVizChange}
      />
    )
    await user.click(screen.getByLabelText('Heatmap'))

    const next = onVizChange.mock.calls.at(-1)![0] as VizEnvelope
    const source = next.source as unknown as { kind: string; spec: Record<string, unknown> }
    expect(source.kind).toBe('vega-lite')
    expect((source.spec.mark as { type: string }).type).toBe('rect')
    const enc = source.spec.encoding as Record<string, Record<string, unknown>>
    expect(enc.x.field).toBe('month')
    expect(enc.y.field).toBe('region')
    expect(enc.color).toMatchObject({ field: 'revenue', aggregate: 'sum' })
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
