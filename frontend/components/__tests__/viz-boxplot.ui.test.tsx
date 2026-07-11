/**
 * Boxplot viz-type icon — V2-only entry in the selector: classic surfaces never
 * see it (no ECharts renderer); the Vega panel offers it and clicking swaps the
 * mark to VL's composite boxplot (which aggregates internally, so any y
 * aggregate is stripped).
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

const barViz: VizEnvelope = {
  version: 2,
  source: {
    kind: 'vega-lite',
    grammar: 'vega-lite@6',
    spec: {
      mark: { type: 'bar' },
      encoding: {
        x: { field: 'region', type: 'nominal' },
        y: { field: 'revenue', type: 'quantitative', aggregate: 'sum' },
      },
    },
  },
} as unknown as VizEnvelope

describe('VizTypeSelector — v2-only boxplot entry', () => {
  it('classic surfaces (no includeV2Only) never render the Boxplot entry', () => {
    renderWithProviders(
      <VizTypeSelector value="bar" onChange={vi.fn()} orientation="grouped" />
    )
    expect(screen.queryByLabelText('Boxplot')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Bar')).toBeInTheDocument()
  })

  it('includeV2Only surfaces the Boxplot entry and reports clicks', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderWithProviders(
      <VizTypeSelector value="bar" onChange={onChange} orientation="grouped" includeV2Only />
    )
    await user.click(screen.getByLabelText('Boxplot'))
    expect(onChange).toHaveBeenCalledWith('boxplot')
  })
})

describe('VegaVizPanel — bar to boxplot via the icon', () => {
  it('clicking Boxplot swaps the mark and strips the y aggregate', async () => {
    const user = userEvent.setup()
    const onVizChange = vi.fn()
    renderWithProviders(
      <VegaVizPanel
        envelope={barViz}
        columns={['region', 'revenue']}
        types={['VARCHAR', 'DOUBLE']}
        onVizChange={onVizChange}
      />
    )
    await user.click(screen.getByLabelText('Boxplot'))

    const next = onVizChange.mock.calls.at(-1)![0] as VizEnvelope
    const source = next.source as unknown as { kind: string; spec: Record<string, unknown> }
    expect(source.kind).toBe('vega-lite')
    expect((source.spec.mark as { type: string }).type).toBe('boxplot')
    const enc = source.spec.encoding as Record<string, Record<string, unknown>>
    expect(enc.x).toEqual({ field: 'region', type: 'nominal' })
    expect(enc.y.field).toBe('revenue')
    expect(enc.y.aggregate).toBeUndefined()
  })

  it('a boxplot envelope is recognized by the grid (no CUSTOM badge)', () => {
    const boxViz = {
      version: 2,
      source: {
        kind: 'vega-lite',
        grammar: 'vega-lite@6',
        spec: { mark: { type: 'boxplot' }, encoding: (barViz.source as unknown as { spec: { encoding: unknown } }).spec.encoding },
      },
    } as unknown as VizEnvelope
    renderWithProviders(
      <VegaVizPanel envelope={boxViz} columns={['region', 'revenue']} types={['VARCHAR', 'DOUBLE']} onVizChange={vi.fn()} />
    )
    expect(screen.queryByLabelText('Custom spec indicator')).not.toBeInTheDocument()
  })
})
