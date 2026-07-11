/**
 * Histogram viz-type icon — V2-only entry in the selector: classic surfaces never
 * see it (no ECharts renderer); the Vega panel offers it and clicking transforms
 * the spec into a distribution plot (measure binned on x, count on y, optional
 * discrete colour split).
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
        x: { field: 'month', type: 'temporal' },
        y: { field: 'revenue', type: 'quantitative', aggregate: 'sum' },
        color: { field: 'region', type: 'nominal' },
      },
    },
  },
} as unknown as VizEnvelope

describe('VizTypeSelector — v2-only histogram entry', () => {
  it('classic surfaces (no includeV2Only) never render the Histogram entry', () => {
    renderWithProviders(
      <VizTypeSelector value="bar" onChange={vi.fn()} orientation="grouped" />
    )
    expect(screen.queryByLabelText('Histogram')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Bar')).toBeInTheDocument()
  })

  it('includeV2Only surfaces the Histogram entry and reports clicks', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderWithProviders(
      <VizTypeSelector value="bar" onChange={onChange} orientation="grouped" includeV2Only />
    )
    await user.click(screen.getByLabelText('Histogram'))
    expect(onChange).toHaveBeenCalledWith('histogram')
  })
})

describe('VegaVizPanel — bar to histogram via the icon', () => {
  it('clicking Histogram bins the measure on x, counts on y, keeps the colour split', async () => {
    const user = userEvent.setup()
    const onVizChange = vi.fn()
    renderWithProviders(
      <VegaVizPanel
        envelope={barViz}
        columns={['month', 'region', 'revenue']}
        types={['DATE', 'VARCHAR', 'DOUBLE']}
        onVizChange={onVizChange}
      />
    )
    await user.click(screen.getByLabelText('Histogram'))

    const next = onVizChange.mock.calls.at(-1)![0] as VizEnvelope
    const source = next.source as unknown as { kind: string; spec: Record<string, unknown> }
    expect(source.kind).toBe('vega-lite')
    const enc = source.spec.encoding as Record<string, Record<string, unknown>>
    expect(enc.x.field).toBe('revenue')
    expect(enc.x.bin).toBe(true)
    expect(enc.y).toEqual({ aggregate: 'count', type: 'quantitative' })
    expect(enc.color).toEqual({ field: 'region', type: 'nominal' })
  })

  it('a histogram envelope shows Values and Color / Split zones (no CUSTOM badge)', () => {
    const histViz = {
      version: 2,
      source: {
        kind: 'vega-lite',
        grammar: 'vega-lite@6',
        spec: {
          mark: { type: 'bar' },
          encoding: {
            x: { field: 'revenue', bin: true, type: 'quantitative' },
            y: { aggregate: 'count', type: 'quantitative' },
          },
        },
      },
    } as unknown as VizEnvelope
    renderWithProviders(
      <VegaVizPanel envelope={histViz} columns={['region', 'revenue']} types={['VARCHAR', 'DOUBLE']} onVizChange={vi.fn()} />
    )
    expect(screen.queryByLabelText('Custom spec indicator')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Values drop zone')).toBeInTheDocument()
    expect(screen.getByLabelText('Color / Split drop zone')).toBeInTheDocument()
  })
})
