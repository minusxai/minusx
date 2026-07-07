/**
 * VizOverridesPanel — the human-visible (and editable) surface for the agent escape
 * hatches persisted in a question's styleConfig: `echartsOverrides` (JSON, ECharts
 * types) and `cssOverrides` (scoped raw CSS, DOM/Leaflet types). Without this panel
 * those keys are invisible hidden state a human could never inspect or clear.
 *
 * Monaco is mocked to a <textarea> in vitest.setup.ui.ts (labeled from options.ariaLabel).
 */
import React from 'react'
import { screen, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '@/test/helpers/render-with-providers'
import { VizOverridesPanel } from '@/components/plotx/VizOverridesPanel'
import { VizConfigPanel } from '@/components/plotx/VizConfigPanel'
import type { VisualizationStyleConfig } from '@/lib/types'

vi.mock('@/lib/hooks/useConfigs', () => ({
  useConfigs: () => ({ config: {}, configs: [], loading: false, error: null, reloadConfigs: vi.fn() }),
}))

const expand = () => fireEvent.click(screen.getByLabelText('Toggle advanced overrides'))
const getEditor = () => screen.getByLabelText('Style overrides editor') as HTMLTextAreaElement

describe('VizOverridesPanel — collapse/expand', () => {
  it('is collapsed by default and expands via the toggle', () => {
    renderWithProviders(<VizOverridesPanel chartType="bar" onChange={vi.fn()} />)
    expect(screen.queryByLabelText('Style overrides editor')).toBeNull()
    expand()
    expect(getEditor()).toBeTruthy()
  })

  it('shows an active indicator when overrides are set, none otherwise', () => {
    const { unmount } = renderWithProviders(
      <VizOverridesPanel chartType="bar" styleConfig={{ echartsOverrides: { grid: { top: 8 } } }} onChange={vi.fn()} />,
    )
    expect(screen.getByLabelText('Overrides active')).toBeTruthy()
    unmount()
    renderWithProviders(<VizOverridesPanel chartType="bar" onChange={vi.fn()} />)
    expect(screen.queryByLabelText('Overrides active')).toBeNull()
  })
})

describe('VizOverridesPanel — echartsOverrides (JSON, ECharts types)', () => {
  it('emits parsed JSON under echartsOverrides, preserving unrelated styleConfig keys', () => {
    const onChange = vi.fn()
    renderWithProviders(
      <VizOverridesPanel chartType="line" styleConfig={{ background: '#000000' }} onChange={onChange} />,
    )
    expand()
    fireEvent.change(getEditor(), { target: { value: '{"grid": {"top": 8}}' } })
    expect(onChange).toHaveBeenCalledWith({
      background: '#000000',
      echartsOverrides: { grid: { top: 8 } },
    } satisfies VisualizationStyleConfig)
  })

  it('shows a parse error and does not emit for malformed JSON', () => {
    const onChange = vi.fn()
    renderWithProviders(<VizOverridesPanel chartType="bar" onChange={onChange} />)
    expand()
    fireEvent.change(getEditor(), { target: { value: '{ nope' } })
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Style overrides error')).toBeTruthy()
  })

  it('rejects valid JSON that is not a plain object (array)', () => {
    const onChange = vi.fn()
    renderWithProviders(<VizOverridesPanel chartType="bar" onChange={onChange} />)
    expand()
    fireEvent.change(getEditor(), { target: { value: '[1, 2]' } })
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Style overrides error')).toBeTruthy()
  })

  it('clears a previous error once the JSON becomes valid again', () => {
    const onChange = vi.fn()
    renderWithProviders(<VizOverridesPanel chartType="bar" onChange={onChange} />)
    expand()
    fireEvent.change(getEditor(), { target: { value: '{ nope' } })
    fireEvent.change(getEditor(), { target: { value: '{"legend": {"show": false}}' } })
    expect(screen.queryByLabelText('Style overrides error')).toBeNull()
    expect(onChange).toHaveBeenCalledWith({ echartsOverrides: { legend: { show: false } } })
  })

  it('an emptied editor removes the echartsOverrides key, keeping the rest', () => {
    const onChange = vi.fn()
    renderWithProviders(
      <VizOverridesPanel
        chartType="bar"
        styleConfig={{ background: '#000000', echartsOverrides: { grid: { top: 8 } } }}
        onChange={onChange}
      />,
    )
    expand()
    fireEvent.change(getEditor(), { target: { value: '  ' } })
    expect(onChange).toHaveBeenCalledWith({ background: '#000000' })
  })
})

describe('VizOverridesPanel — cssOverrides (raw CSS, DOM/Leaflet types)', () => {
  it('emits the raw CSS under cssOverrides, preserving the table group', () => {
    const onChange = vi.fn()
    renderWithProviders(
      <VizOverridesPanel chartType="table" styleConfig={{ table: { headerBg: '#ffffff' } }} onChange={onChange} />,
    )
    expand()
    fireEvent.change(getEditor(), { target: { value: 'thead th { color: red; }' } })
    expect(onChange).toHaveBeenCalledWith({
      table: { headerBg: '#ffffff' },
      cssOverrides: 'thead th { color: red; }',
    } satisfies VisualizationStyleConfig)
  })

  it('an emptied editor removes cssOverrides', () => {
    const onChange = vi.fn()
    renderWithProviders(
      <VizOverridesPanel
        chartType="pivot"
        styleConfig={{ cssOverrides: 'tbody td { color: blue; }', table: { rowStripe: false } }}
        onChange={onChange}
      />,
    )
    expand()
    fireEvent.change(getEditor(), { target: { value: '   ' } })
    expect(onChange).toHaveBeenCalledWith({ table: { rowStripe: false } })
  })

  it('lists the stable css hooks from the capability registry', () => {
    renderWithProviders(<VizOverridesPanel chartType="table" onChange={vi.fn()} />)
    expand()
    const hooks = screen.getByLabelText('Style override hooks')
    expect(hooks.textContent).toContain('thead th')
    expect(hooks.textContent).toContain('tbody td')
  })

  it('never shows a JSON error for CSS input', () => {
    const onChange = vi.fn()
    renderWithProviders(<VizOverridesPanel chartType="geo" onChange={onChange} />)
    expand()
    fireEvent.change(getEditor(), { target: { value: '.leaflet-container { filter: grayscale(1); }' } })
    expect(screen.queryByLabelText('Style overrides error')).toBeNull()
    expect(onChange).toHaveBeenCalledWith({ cssOverrides: '.leaflet-container { filter: grayscale(1); }' })
  })
})

describe('VizOverridesPanel — clear affordance', () => {
  it('the clear pill removes the override key', () => {
    const onChange = vi.fn()
    renderWithProviders(
      <VizOverridesPanel
        chartType="table"
        styleConfig={{ cssOverrides: 'table { border: none; }', table: { headerBg: '#fafafa' } }}
        onChange={onChange}
      />,
    )
    expand()
    fireEvent.click(screen.getByLabelText('Clear style overrides'))
    expect(onChange).toHaveBeenCalledWith({ table: { headerBg: '#fafafa' } })
  })

  it('no clear pill when nothing is set', () => {
    renderWithProviders(<VizOverridesPanel chartType="table" onChange={vi.fn()} />)
    expand()
    expect(screen.queryByLabelText('Clear style overrides')).toBeNull()
  })
})

describe('VizConfigPanel mounts the overrides panel for every branch', () => {
  const base = {
    columns: ['month', 'revenue'],
    types: ['DATE', 'DOUBLE'],
    onStyleConfigChange: vi.fn(),
  }

  it.each(['line', 'pivot', 'trend', 'single_value', 'geo'] as const)('%s branch shows the toggle', (chartType) => {
    renderWithProviders(<VizConfigPanel {...base} chartType={chartType} />)
    expect(screen.getByLabelText('Toggle advanced overrides')).toBeTruthy()
  })

  it('is absent when onStyleConfigChange is not provided (read-only surfaces)', () => {
    renderWithProviders(<VizConfigPanel columns={base.columns} types={base.types} chartType="line" />)
    expect(screen.queryByLabelText('Toggle advanced overrides')).toBeNull()
  })
})
