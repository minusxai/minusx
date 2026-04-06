import React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/helpers/render-with-providers'
import { ChartBuilder } from '@/components/plotx/ChartBuilder'

jest.mock('@/lib/hooks/useConfigs', () => ({
  useConfigs: () => ({
    config: {
      branding: {
        agentName: 'Agent',
      },
    },
    configs: [],
    loading: false,
    error: null,
    reloadConfigs: jest.fn(),
  }),
}))

describe('ChartBuilder axis selection', () => {
  const columns = ['created_at', 'revenue']
  const types = ['TIMESTAMP', 'DOUBLE']
  const rows = [
    { created_at: '2026-01-01', revenue: 100 },
    { created_at: '2026-01-02', revenue: 150 },
  ]

  it('preserves an explicitly empty X axis instead of auto-selecting a fallback column', () => {
    renderWithProviders(
      <ChartBuilder
        columns={columns}
        types={types}
        rows={rows}
        chartType="bar"
        initialXCols={[]}
        initialYCols={['revenue']}
      />
    )

    expect(screen.getByText('250.0')).toBeInTheDocument()
  })

  it('preserves an explicitly empty Y axis instead of auto-selecting a fallback column', () => {
    renderWithProviders(
      <ChartBuilder
        columns={columns}
        types={types}
        rows={rows}
        chartType="bar"
        initialXCols={['created_at']}
        initialYCols={[]}
      />
    )

    expect(screen.getByText('No data to display')).toBeInTheDocument()
    expect(screen.getByText('Drag at least one column to Y Axis to see aggregated values')).toBeInTheDocument()
  })
})

describe('ChartBuilder viz type constraints', () => {
  const columns = ['month', 'category', 'revenue', 'orders']
  const types = ['TIMESTAMP', 'VARCHAR', 'DOUBLE', 'BIGINT']
  const rows = [
    { month: '2026-01', category: 'A', revenue: 100, orders: 10 },
    { month: '2026-02', category: 'B', revenue: 200, orders: 20 },
  ]

  it('combo chart shows error when fewer than 2 Y-axis columns', () => {
    renderWithProviders(
      <ChartBuilder
        columns={columns}
        types={types}
        rows={rows}
        chartType="combo"
        initialXCols={['month']}
        initialYCols={['orders']}
      />
    )

    expect(screen.getByText(/combo charts require at least 2 Y-axis columns/i)).toBeInTheDocument()
  })

  it('combo chart does not show constraint error with 2+ Y-axis columns', () => {
    // ECharts init throws in JSDOM, but we only care that the constraint error is absent
    jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      renderWithProviders(
        <ChartBuilder
          columns={columns}
          types={types}
          rows={rows}
          chartType="combo"
          initialXCols={['month']}
          initialYCols={['revenue', 'orders']}
        />
      )
    } catch {
      // ECharts may throw in JSDOM — that's fine
    }

    expect(screen.queryByText(/combo charts require/i)).not.toBeInTheDocument()
    jest.restoreAllMocks()
  })

  it('waterfall chart shows error with multiple Y-axis columns', () => {
    renderWithProviders(
      <ChartBuilder
        columns={columns}
        types={types}
        rows={rows}
        chartType="waterfall"
        initialXCols={['month']}
        initialYCols={['revenue', 'orders']}
      />
    )

    expect(screen.getByText(/waterfall charts support only a single Y-axis column/i)).toBeInTheDocument()
  })

  it('waterfall chart shows error with multiple X-axis columns', () => {
    renderWithProviders(
      <ChartBuilder
        columns={columns}
        types={types}
        rows={rows}
        chartType="waterfall"
        initialXCols={['month', 'category']}
        initialYCols={['revenue']}
      />
    )

    expect(screen.getByText(/waterfall charts support only a single X-axis column/i)).toBeInTheDocument()
  })

  it('pie chart shows error with no X-axis columns', () => {
    renderWithProviders(
      <ChartBuilder
        columns={columns}
        types={types}
        rows={rows}
        chartType="pie"
        initialXCols={[]}
        initialYCols={['revenue']}
      />
    )

    expect(screen.getByText(/pie charts require at least 1 X-axis column/i)).toBeInTheDocument()
  })

  it('funnel chart shows error with no X-axis columns', () => {
    renderWithProviders(
      <ChartBuilder
        columns={columns}
        types={types}
        rows={rows}
        chartType="funnel"
        initialXCols={[]}
        initialYCols={['revenue']}
      />
    )

    expect(screen.getByText(/funnel charts require at least 1 X-axis column/i)).toBeInTheDocument()
  })
})
