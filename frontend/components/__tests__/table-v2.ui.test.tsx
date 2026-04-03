import React from 'react'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/helpers/render-with-providers'
import { TableV2 } from '@/components/plotx/TableV2'

// Mock @tanstack/react-virtual — JSDOM has no layout so virtualizer renders 0 rows.
// Replace with a pass-through that renders all items.
jest.mock('@tanstack/react-virtual', () => ({
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

// Mock DuckDB WASM (not available in JSDOM)
jest.mock('@/lib/database/duckdb', () => ({
  calculateColumnStats: jest.fn().mockResolvedValue({}),
  getColumnType: (t: string) => {
    if (['INTEGER', 'BIGINT', 'DOUBLE', 'FLOAT', 'DECIMAL'].some(n => t.toUpperCase().includes(n))) return 'number'
    if (['DATE', 'TIMESTAMP'].some(n => t.toUpperCase().includes(n))) return 'date'
    return 'text'
  },
  loadDataIntoTable: jest.fn().mockResolvedValue(undefined),
  generateRandomTableName: () => 'test_table',
}))

jest.mock('@/lib/chart/histogram', () => ({
  calculateHistogram: jest.fn().mockResolvedValue([]),
}))

jest.mock('@/lib/hooks/useConfigs', () => ({
  useConfigs: () => ({
    config: { branding: { agentName: 'Agent' } },
    configs: [],
    loading: false,
    error: null,
    reloadConfigs: jest.fn(),
  }),
}))

const TEST_COLUMNS = ['name', 'age', 'city']
const TEST_TYPES = ['VARCHAR', 'INTEGER', 'VARCHAR']
const TEST_ROWS = [
  { name: 'Alice', age: 30, city: 'NYC' },
  { name: 'Bob', age: 25, city: 'LA' },
  { name: 'Charlie', age: 35, city: 'NYC' },
  { name: 'Diana', age: 28, city: 'Chicago' },
  { name: 'Eve', age: 22, city: 'LA' },
]

describe('TableV2', () => {
  it('renders all rows and columns', () => {
    renderWithProviders(
      <TableV2 columns={TEST_COLUMNS} types={TEST_TYPES} rows={TEST_ROWS} />
    )

    // All column headers rendered
    expect(screen.getByText('name')).toBeInTheDocument()
    expect(screen.getByText('age')).toBeInTheDocument()
    expect(screen.getByText('city')).toBeInTheDocument()

    // All row data rendered
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('Charlie')).toBeInTheDocument()

    // Row count in footer
    expect(screen.getByText('5 rows')).toBeInTheDocument()
  })

  it('sorts rows when clicking a column header', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <TableV2 columns={TEST_COLUMNS} types={TEST_TYPES} rows={TEST_ROWS} />
    )

    // Click "name" header text to sort ascending
    await user.click(screen.getByText('name'))

    // After ascending sort, first row should be Alice (A < B < C...)
    const cells = screen.getAllByText(/Alice|Bob|Charlie|Diana|Eve/)
    expect(cells[0]).toHaveTextContent('Alice')

    // Click again for descending
    await user.click(screen.getByText('name'))

    const cellsDesc = screen.getAllByText(/Alice|Bob|Charlie|Diana|Eve/)
    expect(cellsDesc[0]).toHaveTextContent('Eve')
  })

  it('filters rows when typing in column filter', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <TableV2 columns={TEST_COLUMNS} types={TEST_TYPES} rows={TEST_ROWS} />
    )

    // Find the city column header th, then find the filter button (2nd <button> child)
    const cityHeader = screen.getByText('city').closest('th')!
    const buttons = cityHeader.querySelectorAll('button')
    // buttons[0] = sort, buttons[1] = filter
    await user.click(buttons[1])

    // Filter input should appear
    const filterInput = screen.getByPlaceholderText('Filter...')
    await user.type(filterInput, 'NYC')

    // Should show only NYC rows (Alice and Charlie)
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Charlie')).toBeInTheDocument()
    expect(screen.queryByText('Bob')).not.toBeInTheDocument()
    expect(screen.queryByText('Diana')).not.toBeInTheDocument()

    // Footer should show filtered count
    expect(screen.getByText('2 filtered of 5 rows')).toBeInTheDocument()
  })

  it('hides columns via the Columns menu', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <TableV2 columns={TEST_COLUMNS} types={TEST_TYPES} rows={TEST_ROWS} />
    )

    // Open columns menu
    await user.click(screen.getByText('3/3 Columns'))

    // Click "age" menu item to hide it — use getAllByText since "age" appears in header + cells too
    const ageItems = screen.getAllByText('age')
    // The menu item is the last one (after header text and cell values)
    await user.click(ageItems[ageItems.length - 1])

    // Check that column count updated
    expect(screen.getByText('2/3 Columns')).toBeInTheDocument()
  })

  it('shows empty state when no data', () => {
    renderWithProviders(
      <TableV2 columns={TEST_COLUMNS} types={TEST_TYPES} rows={[]} />
    )
    expect(screen.getByText('Uh-oh, no data in results!')).toBeInTheDocument()
  })
})
