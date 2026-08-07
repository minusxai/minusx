/**
 * Applying a workspace recipe whose slots don't fit the result columns must
 * FAIL VISIBLY (a toast naming the problem), never silently no-op — a clicked
 * tile that does nothing reads as broken. Shipped exactly that way once:
 * radar clicked on a single-number question (no nominal column) did nothing.
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
  description: 'Radar-like: needs a nominal metric + quantitative values',
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

describe('workspace recipe apply feedback', () => {
  beforeEach(() => toastSpy.mockClear())

  it('a recipe that cannot auto-bind toasts the reason and changes nothing', async () => {
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
    await user.click(screen.getByLabelText('Recipe radar'))
    expect(onVizChange).not.toHaveBeenCalled()
    expect(toastSpy).toHaveBeenCalledTimes(1)
    const toast = toastSpy.mock.calls[0][0]
    expect(String(toast.title) + String(toast.description)).toMatch(/metric/i)
    expect(toast.type).toBe('error')
  })

  it('with NO result columns the toast says to run the query first', async () => {
    const user = userEvent.setup()
    const onVizChange = vi.fn()
    renderWithProviders(
      <VegaVizPanel envelope={tableViz} columns={[]} types={[]} onVizChange={onVizChange} />,
    )
    await user.click(screen.getByLabelText('Recipe radar'))
    expect(onVizChange).not.toHaveBeenCalled()
    expect(toastSpy).toHaveBeenCalledTimes(1)
    expect(String(toastSpy.mock.calls[0][0].description)).toMatch(/run the query/i)
  })

  it('a recipe that fits applies without any toast', async () => {
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
    await user.click(screen.getByLabelText('Recipe radar'))
    expect(onVizChange).toHaveBeenCalledTimes(1)
    expect(toastSpy).not.toHaveBeenCalled()
  })
})
