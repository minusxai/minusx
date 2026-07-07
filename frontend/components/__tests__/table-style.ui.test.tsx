import React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/helpers/render-with-providers'
import { TableV2 } from '@/components/plotx/TableV2'
import { VizCssScope } from '@/components/plotx/VizCssScope'

// ─── TableV2 mocks (same as viz-components.ui.test.tsx) ──────────────────────

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        index: i,
        start: i * 41,
        end: (i + 1) * 41,
        size: 41,
      })),
    getTotalSize: () => count * 41,
  }),
}))

vi.mock('@/lib/database/duckdb', () => ({
  calculateColumnStats: vi.fn().mockResolvedValue({}),
  getColumnType: (t: string) => {
    if (['INTEGER', 'BIGINT', 'DOUBLE', 'FLOAT', 'DECIMAL'].some(n => t.toUpperCase().includes(n))) return 'number'
    if (['DATE', 'TIMESTAMP'].some(n => t.toUpperCase().includes(n))) return 'date'
    return 'text'
  },
  loadDataIntoTable: vi.fn().mockResolvedValue(undefined),
  generateRandomTableName: () => 'test_table',
}))

vi.mock('@/lib/chart/histogram', () => ({
  calculateHistogram: vi.fn().mockResolvedValue([]),
}))

const COLUMNS = ['name', 'age']
const TYPES = ['VARCHAR', 'INTEGER']
const ROWS = [
  { name: 'alice', age: 30 },
  { name: 'bob', age: 25 },
  { name: 'carol', age: 41 },
]

const tableRoot = () => screen.getByLabelText('Results table')
const headerCell = (label: string) =>
  screen.getByLabelText(`Column header ${label}`).closest('th') as HTMLTableCellElement
const bodyRows = () =>
  Array.from(tableRoot().querySelectorAll('tbody tr[data-row-idx]')) as HTMLTableRowElement[]

describe('TableV2 tableStyle', () => {
  it('applies header background and text color', () => {
    renderWithProviders(
      <TableV2 columns={COLUMNS} types={TYPES} rows={ROWS}
        tableStyle={{ headerBg: '#1a2b4a', headerTextColor: '#f7f0df' }} />
    )
    expect(headerCell('name').style.background).toBe('rgb(26, 43, 74)')
    expect(headerCell('name').style.color).toBe('rgb(247, 240, 223)')
  })

  it('leaves headers untouched when no tableStyle (regression)', () => {
    renderWithProviders(<TableV2 columns={COLUMNS} types={TYPES} rows={ROWS} />)
    expect(headerCell('name').style.background).toBe('')
    expect(headerCell('name').style.color).toBe('')
  })

  it('stripes alternate rows by default and honors a custom stripeBg', () => {
    renderWithProviders(
      <TableV2 columns={COLUMNS} types={TYPES} rows={ROWS}
        tableStyle={{ stripeBg: '#fdf6e3' }} />
    )
    const rows = bodyRows()
    expect(rows[0].style.background).toBe('')
    expect(rows[1].style.background).toBe('rgb(253, 246, 227)')
    expect(rows[2].style.background).toBe('')
  })

  it('disables striping with rowStripe=false', () => {
    renderWithProviders(
      <TableV2 columns={COLUMNS} types={TYPES} rows={ROWS}
        tableStyle={{ rowStripe: false }} />
    )
    for (const row of bodyRows()) expect(row.style.background).toBe('')
  })

  it('applies cell font size and border color to body cells', () => {
    renderWithProviders(
      <TableV2 columns={COLUMNS} types={TYPES} rows={ROWS}
        tableStyle={{ cellFontSize: 13, borderColor: '#334455' }} />
    )
    const firstCell = bodyRows()[0].querySelector('td') as HTMLTableCellElement
    expect(firstCell.style.fontSize).toBe('13px')
    expect(firstCell.style.borderRight).toContain('rgb(51, 68, 85)')
  })

  it('conditional-format cell colors win over striping (inline on td beats tr bg)', () => {
    renderWithProviders(
      <TableV2 columns={COLUMNS} types={TYPES} rows={ROWS}
        tableStyle={{ stripeBg: '#fdf6e3' }}
        conditionalFormats={[{ id: 'r1', column: 'age', operator: '<', value: '30', target: 'cell', bgColor: '#fde68a' }]} />
    )
    const striped = bodyRows()[1] // bob, age 25 — striped AND matching the rule
    const ageCell = striped.querySelectorAll('td')[1]
    expect(ageCell.style.backgroundColor).toBe('rgb(253, 230, 138)')
  })
})

describe('VizCssScope — the cssOverrides escape hatch for DOM renderers', () => {
  it('renders the raw CSS scoped to a unique class via native nesting', () => {
    const { container } = renderWithProviders(
      <VizCssScope css="thead th { letter-spacing: 0.08em; }" vizType="table">
        <div>viz</div>
      </VizCssScope>
    )
    const styleEl = container.querySelector('style')
    expect(styleEl).not.toBeNull()
    const cssText = styleEl!.textContent ?? ''
    expect(cssText).toContain('thead th { letter-spacing: 0.08em; }')
    // scoped: rules ride inside a `.mx-viz-scope-… { … }` nest, never global
    const scopeMatch = cssText.match(/^\.(mx-viz-scope-[\w-]+)\s*\{/)
    expect(scopeMatch).not.toBeNull()
    const wrapper = container.querySelector(`.${scopeMatch![1]}`) as HTMLElement
    expect(wrapper).not.toBeNull()
    expect(wrapper.className).toContain('mx-viz-table')
    expect(wrapper.style.display).toBe('contents') // layout-transparent
  })

  it('renders children directly with no wrapper when there is no css', () => {
    const { container } = renderWithProviders(
      <VizCssScope css={null} vizType="table"><div>viz</div></VizCssScope>
    )
    expect(container.querySelector('style')).toBeNull()
    expect(container.querySelector('.mx-viz')).toBeNull()
  })
})
