import React from 'react'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/helpers/render-with-providers'
import { VegaEncodingPanel } from '@/components/viz/VegaEncodingPanel'
import { VIZ_GRAMMAR_VEGA_LITE } from '@/lib/validation/atlas-schemas'
import type { VizEnvelope } from '@/lib/validation/atlas-schemas'

// A simple native unit spec: the gear appears on single-field native channels.
const envelope = {
  version: 2,
  source: {
    kind: 'vega-lite',
    grammar: VIZ_GRAMMAR_VEGA_LITE,
    spec: {
      mark: 'bar',
      encoding: {
        x: { field: 'month', type: 'temporal' },
        y: { field: 'revenue', type: 'quantitative' },
      },
    },
  },
} as VizEnvelope

const COLUMNS = ['month', 'revenue']
const TYPES = ['TIMESTAMP', 'DOUBLE']

function renderPanel(onVizChange = vi.fn()) {
  renderWithProviders(
    <VegaEncodingPanel envelope={envelope} columns={COLUMNS} types={TYPES} onVizChange={onVizChange} />
  )
  return onVizChange
}

describe('VizFieldPopover placement', () => {
  // ZoneChip's inner HStack has overflow:hidden (it ellipsizes long column names), so a
  // panel positioned inside the chip is CLIPPED INVISIBLE even though it's in the DOM.
  // The panel must therefore portal out of the chip entirely.
  it('renders the settings panel outside the overflow-clipped chip', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByLabelText('Field settings for y'))

    const panel = await screen.findByLabelText('Field settings panel for y')
    const zones = screen.getByLabelText('Vega encoding drop zones')
    expect(zones.contains(panel)).toBe(false)
  })

  it('commits an alias typed into the portaled panel as the channel title', async () => {
    const user = userEvent.setup()
    const onVizChange = renderPanel()

    await user.click(screen.getByLabelText('Field settings for y'))
    await user.type(await screen.findByLabelText('Alias for y'), 'Revenue ($){Enter}')

    expect(onVizChange).toHaveBeenCalled()
    const next = onVizChange.mock.calls.at(-1)![0] as VizEnvelope
    const spec = (next.source as { spec: Record<string, any> }).spec
    expect(spec.encoding.y.title).toBe('Revenue ($)')
  })

  it('stays open while interacting inside the portaled panel', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByLabelText('Field settings for y'))
    // Clicking inside the panel (the alias input) must not trigger close-on-outside-click.
    await user.click(await screen.findByLabelText('Alias for y'))

    expect(screen.getByLabelText('Field settings panel for y')).toBeInTheDocument()
  })

  it('closes on a click outside the panel and trigger', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByLabelText('Field settings for y'))
    await screen.findByLabelText('Field settings panel for y')
    await user.click(document.body)

    expect(screen.queryByLabelText('Field settings panel for y')).not.toBeInTheDocument()
  })

  it('a non-preset format shows as the raw d3 pattern in the custom input', async () => {
    const user = userEvent.setup()
    const customEnvelope = JSON.parse(JSON.stringify(envelope)) as VizEnvelope
    ;(customEnvelope.source as unknown as { spec: Record<string, any> }).spec.encoding.y.axis = { format: '.4~s' }
    renderWithProviders(
      <VegaEncodingPanel envelope={customEnvelope} columns={COLUMNS} types={TYPES} onVizChange={vi.fn()} />
    )

    await user.click(screen.getByLabelText('Field settings for y'))

    const custom = await screen.findByLabelText('Custom d3 format for y')
    expect((custom as HTMLInputElement).value).toBe('.4~s')
  })

  it('typing a custom d3 pattern commits it to the channel format', async () => {
    const user = userEvent.setup()
    const onVizChange = renderPanel()

    await user.click(screen.getByLabelText('Field settings for y'))
    const custom = await screen.findByLabelText('Custom d3 format for y')
    await user.type(custom, '.2%{Enter}')

    const next = onVizChange.mock.calls.at(-1)![0] as VizEnvelope
    const spec = (next.source as { spec: Record<string, any> }).spec
    expect(spec.encoding.y.axis.format).toBe('.2%')
  })
})
