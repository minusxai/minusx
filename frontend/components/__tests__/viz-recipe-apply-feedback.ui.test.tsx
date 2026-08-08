/**
 * A recipe that cannot bind to the current result must be visibly UNAVAILABLE:
 * its tile greys out with a plain-words reason on hover, and clicking it does
 * nothing. Shipped without this once: a radar click on a single-number question
 * silently no-op'd and read as broken. The toast path stays as a backstop for
 * a fit that fails between render and click.
 */
import React from 'react'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/helpers/render-with-providers'
import { VegaVizPanel } from '@/components/viz/VegaVizPanel'
import type { VizEnvelope, VizRecipeContent } from '@/lib/validation/atlas-schemas'

vi.mock('@/lib/hooks/useConfigs', () => ({
  useConfigs: () => ({
    config: { branding: { agentName: 'Agent' } },
    configs: [], loading: false, error: null, reloadConfigs: vi.fn(),
  }),
}))

const { toastSpy } = vi.hoisted(() => ({ toastSpy: vi.fn() }))
vi.mock('@/components/ui/toaster', () => ({ toaster: { create: toastSpy } }))

const RADARISH: VizRecipeContent = {
  description: 'Radar-like: needs a text metric + number values',
  engine: 'vega-lite',
  bindings: [
    { name: 'metric', label: 'Metrics', accepts: ['nominal'] },
    { name: 'values', label: 'Values', accepts: ['quantitative'], multi: true },
  ],
  template: { mark: 'bar', encoding: { x: { field: '{{metric}}', type: 'nominal' } } },
}

vi.mock('@/lib/hooks/use-viz-recipes', () => ({
  useVizRecipes: () => ({
    available: [{ name: 'radar', description: 'Radar-like', address: '/tutorial/radar' }],
    contentFor: (address: string) => (address === '/tutorial/radar' ? RADARISH : undefined),
  }),
}))

const tableViz: VizEnvelope = {
  version: 2,
  source: { kind: 'table', columnFormats: null, conditionalFormats: null, css: null },
} as unknown as VizEnvelope

describe('workspace recipe applicability', () => {
  beforeEach(() => toastSpy.mockClear())

  it('a recipe that cannot bind is greyed out with a plain-words hover reason, and clicks do nothing', async () => {
    const user = userEvent.setup()
    const onVizChange = vi.fn()
    renderWithProviders(
      <VegaVizPanel
        envelope={tableViz}
        columns={['avg_order_value']}
        types={['DOUBLE']}
        onVizChange={onVizChange}
      />,
    )
    const tile = screen.getByLabelText('Recipe radar')
    expect(tile.getAttribute('aria-disabled')).toBe('true')
    expect(tile.getAttribute('title')).toMatch(/text column/i)
    expect(tile.getAttribute('title')).toContain('Metrics')
    expect(tile.getAttribute('title')).toMatch(/has none/i)

    await user.click(tile)
    expect(onVizChange).not.toHaveBeenCalled()
    expect(toastSpy).not.toHaveBeenCalled() // disabled — nothing to report
  })

  it('with NO result yet the tile is greyed out with a run-the-query hint', () => {
    renderWithProviders(
      <VegaVizPanel envelope={tableViz} columns={[]} types={[]} onVizChange={vi.fn()} />,
    )
    const tile = screen.getByLabelText('Recipe radar')
    expect(tile.getAttribute('aria-disabled')).toBe('true')
    expect(tile.getAttribute('title')).toMatch(/run the query/i)
  })

  it('a recipe that fits is enabled and applies without any toast', async () => {
    const user = userEvent.setup()
    const onVizChange = vi.fn()
    renderWithProviders(
      <VegaVizPanel
        envelope={tableViz}
        columns={['platform', 'revenue']}
        types={['VARCHAR', 'DOUBLE']}
        onVizChange={onVizChange}
      />,
    )
    const tile = screen.getByLabelText('Recipe radar')
    expect(tile.getAttribute('aria-disabled')).toBe('false')
    await user.click(tile)
    expect(onVizChange).toHaveBeenCalledTimes(1)
    expect(toastSpy).not.toHaveBeenCalled()
  })
})
