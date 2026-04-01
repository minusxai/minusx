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
