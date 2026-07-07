import React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/helpers/render-with-providers'
import { PivotTable } from '@/components/plotx/PivotTable'
import type { PivotData } from '@/lib/chart/pivot-utils'

const PIVOT_DATA: PivotData = {
  rowHeaders: [['North'], ['South']],
  columnHeaders: [['2023'], ['2024']],
  cells: [
    [100, 200],
    [150, 250],
  ],
  cellPresent: [
    [true, true],
    [true, true],
  ],
  rowTotals: [300, 400],
  columnTotals: [250, 450],
  grandTotal: 700,
  valueLabels: ['SUM(revenue)'],
}

const pivotRoot = () => screen.getByLabelText('Pivot table')

describe('PivotTable tableStyle', () => {
  it('exposes an aria-labeled root and applies header colors', () => {
    renderWithProviders(
      <PivotTable pivotData={PIVOT_DATA} rowDimNames={['region']} colDimNames={['year']}
        tableStyle={{ headerBg: '#1a2b4a', headerTextColor: '#f7f0df' }} />
    )
    const headerCells = Array.from(pivotRoot().querySelectorAll('thead th')) as HTMLElement[]
    expect(headerCells.length).toBeGreaterThan(0)
    for (const th of headerCells) {
      expect(th.style.background).toBe('rgb(26, 43, 74)')
      expect(th.style.color).toBe('rgb(247, 240, 223)')
    }
  })

  it('applies cell font size to body cells', () => {
    renderWithProviders(
      <PivotTable pivotData={PIVOT_DATA} rowDimNames={['region']} colDimNames={['year']}
        tableStyle={{ cellFontSize: 13 }} />
    )
    const dataCells = Array.from(pivotRoot().querySelectorAll('tbody td')) as HTMLElement[]
    expect(dataCells.length).toBeGreaterThan(0)
    for (const td of dataCells) expect(td.style.fontSize).toBe('13px')
  })

  it('renders unchanged without tableStyle (regression)', () => {
    renderWithProviders(
      <PivotTable pivotData={PIVOT_DATA} rowDimNames={['region']} colDimNames={['year']} />
    )
    const headerCells = Array.from(pivotRoot().querySelectorAll('thead th')) as HTMLElement[]
    for (const th of headerCells) {
      expect(th.style.background).toBe('')
      expect(th.style.color).toBe('')
    }
  })
})
