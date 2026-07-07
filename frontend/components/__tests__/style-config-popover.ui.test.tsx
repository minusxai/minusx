import React from 'react'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fireEvent } from '@testing-library/react'
import { renderWithProviders } from '@/test/helpers/render-with-providers'
import { StyleConfigPopover } from '@/components/plotx/StyleConfigPopover'
import { TableStylePanel } from '@/components/plotx/TableStylePanel'
import type { VisualizationStyleConfig } from '@/lib/types'

vi.mock('@/lib/hooks/useConfigs', () => ({
  useConfigs: () => ({
    config: { branding: { agentName: 'Agent' } },
    configs: [],
    loading: false,
    error: null,
    reloadConfigs: vi.fn(),
  }),
}))

describe('StyleConfigPopover — curated levers', () => {
  const renderPopover = (chartType: 'line' | 'bar', styleConfig?: VisualizationStyleConfig) => {
    const onChange = vi.fn()
    renderWithProviders(
      <StyleConfigPopover chartType={chartType} styleConfig={styleConfig} numSeries={2}
        onChange={onChange} displayMode="inline" />
    )
    return onChange
  }

  it('legend visibility pills emit legend.show', async () => {
    const user = userEvent.setup()
    const onChange = renderPopover('bar')
    await user.click(screen.getByLabelText('Legend off'))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ legend: { show: false } }))
  })

  it('legend position pills emit legend.position and keep show', async () => {
    const user = userEvent.setup()
    const onChange = renderPopover('bar', { legend: { show: true } })
    await user.click(screen.getByLabelText('Legend position bottom'))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ legend: { show: true, position: 'bottom' } }))
  })

  it('background color commit emits background', async () => {
    const onChange = renderPopover('bar')
    fireEvent.change(screen.getByLabelText('Chart background color input'), { target: { value: '#101822' } })
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ background: '#101822' })))
  })

  it('background auto pill clears background', async () => {
    const user = userEvent.setup()
    const onChange = renderPopover('bar', { background: '#101822' })
    await user.click(screen.getByLabelText('Chart background auto'))
    const emitted = onChange.mock.calls[0][0] as VisualizationStyleConfig
    expect(emitted.background).toBeUndefined()
  })

  it('text color commit emits textColor', async () => {
    const onChange = renderPopover('bar')
    fireEvent.change(screen.getByLabelText('Chart text color input'), { target: { value: '#f7f0df' } })
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ textColor: '#f7f0df' })))
  })

  it('smoothing pills only exist for line-type charts and emit smooth', async () => {
    const user = userEvent.setup()
    const onChange = renderPopover('line')
    await user.click(screen.getByLabelText('Line smoothing off'))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ smooth: false }))
  })

  it('bar charts have no smoothing section (capability-gated)', () => {
    renderPopover('bar')
    expect(screen.queryByLabelText('Line smoothing off')).toBeNull()
  })

  it('NEVER wipes fields it does not edit — echartsOverrides and table survive an unrelated change', async () => {
    const user = userEvent.setup()
    const onChange = renderPopover('bar', {
      colors: { '0': 'danger' },
      echartsOverrides: { grid: { left: 8 } },
      table: { headerBg: '#1a2b4a' },
      cssOverrides: 'td { color: red; }',
    })
    await user.click(screen.getByLabelText('Legend off'))
    const emitted = onChange.mock.calls[0][0] as VisualizationStyleConfig
    expect(emitted.echartsOverrides).toEqual({ grid: { left: 8 } })
    expect(emitted.table).toEqual({ headerBg: '#1a2b4a' })
    expect(emitted.cssOverrides).toBe('td { color: red; }')
    expect(emitted.colors).toEqual({ '0': 'danger' })
  })
})

describe('TableStylePanel', () => {
  const renderPanel = (styleConfig?: VisualizationStyleConfig) => {
    const onChange = vi.fn()
    renderWithProviders(<TableStylePanel styleConfig={styleConfig} onChange={onChange} />)
    return onChange
  }

  it('header background commit emits styleConfig.table.headerBg', async () => {
    const onChange = renderPanel()
    fireEvent.change(screen.getByLabelText('Table header background color input'), { target: { value: '#1a2b4a' } })
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ table: expect.objectContaining({ headerBg: '#1a2b4a' }) })
    ))
  })

  it('striping pills emit rowStripe and preserve other table keys', async () => {
    const user = userEvent.setup()
    const onChange = renderPanel({ table: { headerBg: '#1a2b4a' } })
    await user.click(screen.getByLabelText('Row striping off'))
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ table: expect.objectContaining({ headerBg: '#1a2b4a', rowStripe: false }) })
    )
  })

  it('font size pills emit cellFontSize', async () => {
    const user = userEvent.setup()
    const onChange = renderPanel()
    await user.click(screen.getByLabelText('Table cell font size 16'))
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ table: expect.objectContaining({ cellFontSize: 16 }) })
    )
  })

  it('clearing the last table lever drops the table key but keeps the rest of styleConfig', async () => {
    const user = userEvent.setup()
    const onChange = renderPanel({ table: { rowStripe: false }, cssOverrides: 'td { color: red; }' })
    await user.click(screen.getByLabelText('Row striping on'))
    const emitted = onChange.mock.calls[0][0] as VisualizationStyleConfig
    expect(emitted.table).toBeUndefined()
    expect(emitted.cssOverrides).toBe('td { color: red; }')
  })
})
