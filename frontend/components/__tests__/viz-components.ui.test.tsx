import React from 'react'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/helpers/render-with-providers'
import { TableV2 } from '@/components/plotx/TableV2'
import { ChartBuilder } from '@/components/plotx/ChartBuilder'
import { VizConfigPanel } from '@/components/plotx/VizConfigPanel'
import type { GeoConfig, ColumnFormatConfig } from '@/lib/types'

// ─── Shared mocks ────────────────────────────────────────────────────────────

vi.mock('@/components/plotx/EChart', () => ({
  EChart: () => <div data-testid="mock-echart" />,
}))

vi.mock('@/lib/hooks/useConfigs', () => ({
  useConfigs: () => ({
    config: { branding: { agentName: 'Agent' } },
    configs: [],
    loading: false,
    error: null,
    reloadConfigs: vi.fn(),
  }),
}))

// ─── TableV2 mocks ───────────────────────────────────────────────────────────

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

// ─── Geo-plot mocks ──────────────────────────────────────────────────────────

const mockSetView = vi.fn()
const mockRemove = vi.fn()
const mockFitBounds = vi.fn()
const mockInvalidateSize = vi.fn()
const mockAddLayer = vi.fn()

const mockLayerGroup = {
  addTo: vi.fn().mockReturnThis(),
  addLayer: vi.fn(),
  clearLayers: vi.fn(),
}

const mockGeoJsonLayer = {
  addTo: vi.fn().mockReturnThis(),
  getBounds: vi.fn().mockReturnValue({ isValid: () => true }),
  eachLayer: vi.fn(),
}

vi.mock('leaflet', () => {
  const leafletMock = {
    map: vi.fn(() => ({
      setView: mockSetView,
      remove: mockRemove,
      fitBounds: mockFitBounds,
      invalidateSize: mockInvalidateSize,
      addLayer: mockAddLayer,
    })),
  tileLayer: vi.fn(() => ({ addTo: vi.fn().mockReturnThis(), remove: vi.fn() })),
  circleMarker: vi.fn(() => ({
    addTo: vi.fn().mockReturnThis(),
    getLatLng: vi.fn().mockReturnValue({ lat: 0, lng: 0 }),
    bindTooltip: vi.fn().mockReturnThis(),
  })),
  geoJSON: vi.fn(() => mockGeoJsonLayer),
  polyline: vi.fn(() => ({
    addTo: vi.fn().mockReturnThis(),
    getLatLngs: vi.fn().mockReturnValue([{ lat: 0, lng: 0 }]),
    bindTooltip: vi.fn().mockReturnThis(),
  })),
  layerGroup: vi.fn(() => mockLayerGroup),
  latLngBounds: vi.fn().mockReturnValue({
    isValid: () => true,
    extend: vi.fn().mockReturnThis(),
  }),
    heatLayer: vi.fn(() => ({ addTo: vi.fn().mockReturnThis() })),
  };
  return { ...leafletMock, default: leafletMock };
})

vi.mock('leaflet.heat', () => ({}))
vi.mock('leaflet/dist/leaflet.css', () => ({}))

vi.mock('@/lib/chart/geo-data', () => ({
  loadGeoJSON: vi.fn().mockResolvedValue({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { name: 'Maharashtra' }, geometry: { type: 'Polygon', coordinates: [[[72, 19], [73, 19], [73, 20], [72, 19]]] } },
      { type: 'Feature', properties: { name: 'Karnataka' }, geometry: { type: 'Polygon', coordinates: [[[75, 14], [76, 14], [76, 15], [75, 14]]] } },
    ],
  }),
  MAP_OPTIONS: [
    { value: 'world', label: 'World (Countries)' },
    { value: 'us-states', label: 'US (States)' },
    { value: 'india-states', label: 'India (States)' },
  ],
  MAP_DEFAULTS: {
    'world': { center: [20, 0], zoom: 2 },
    'us-states': { center: [37.8, -96], zoom: 4 },
    'india-states': { center: [22.5, 82], zoom: 5 },
  },
}))

// ─── TableV2 ─────────────────────────────────────────────────────────────────

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

    expect(screen.getByText('name')).toBeInTheDocument()
    expect(screen.getByText('age')).toBeInTheDocument()
    expect(screen.getByText('city')).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('Charlie')).toBeInTheDocument()
    expect(screen.getByText('5 rows')).toBeInTheDocument()
  })

  it('sorts rows when clicking a column header', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <TableV2 columns={TEST_COLUMNS} types={TEST_TYPES} rows={TEST_ROWS} />
    )

    await user.click(screen.getByText('name'))
    const cells = screen.getAllByText(/Alice|Bob|Charlie|Diana|Eve/)
    expect(cells[0]).toHaveTextContent('Alice')

    await user.click(screen.getByText('name'))
    const cellsDesc = screen.getAllByText(/Alice|Bob|Charlie|Diana|Eve/)
    expect(cellsDesc[0]).toHaveTextContent('Eve')
  })

  it('filters rows when typing in column filter', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <TableV2 columns={TEST_COLUMNS} types={TEST_TYPES} rows={TEST_ROWS} />
    )

    const cityHeader = screen.getByText('city').closest('th')!
    const buttons = cityHeader.querySelectorAll('button')
    await user.click(buttons[1])

    const filterInput = screen.getByPlaceholderText('Search values...')
    await user.type(filterInput, 'NYC')

    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Charlie')).toBeInTheDocument()
    expect(screen.queryByText('Bob')).not.toBeInTheDocument()
    expect(screen.queryByText('Diana')).not.toBeInTheDocument()
    expect(screen.getByText('2 filtered of 5 rows')).toBeInTheDocument()
  })

  it('hides columns via the Columns menu', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <TableV2 columns={TEST_COLUMNS} types={TEST_TYPES} rows={TEST_ROWS} />
    )

    await user.click(screen.getByText('3/3 Columns'))
    const ageItems = screen.getAllByText('age')
    await user.click(ageItems[ageItems.length - 1])
    expect(screen.getByText('2/3 Columns')).toBeInTheDocument()
  })

  it('shows empty state when no data', () => {
    renderWithProviders(
      <TableV2 columns={TEST_COLUMNS} types={TEST_TYPES} rows={[]} />
    )
    expect(screen.getByText('Uh-oh, no data in results!')).toBeInTheDocument()
  })

  it('displays the column alias from columnFormats in the header', () => {
    renderWithProviders(
      <TableV2
        columns={TEST_COLUMNS}
        types={TEST_TYPES}
        rows={TEST_ROWS}
        columnFormats={{ age: { alias: 'Years Old' } }}
      />
    )
    expect(screen.getByLabelText('Column header Years Old')).toBeInTheDocument()
  })

  it('renames a column via the header format popover', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [cf, setCf] = React.useState<Record<string, ColumnFormatConfig>>({})
      return (
        <TableV2
          columns={TEST_COLUMNS}
          types={TEST_TYPES}
          rows={TEST_ROWS}
          columnFormats={cf}
          onColumnFormatsChange={setCf}
        />
      )
    }
    renderWithProviders(<Harness />)

    await user.click(screen.getByLabelText('Format column age'))
    await user.type(screen.getByLabelText('Alias for age'), 'Years')

    expect(await screen.findByLabelText('Column header Years')).toBeInTheDocument()
  })

  it('does not render the format editor when onColumnFormatsChange is absent', () => {
    renderWithProviders(
      <TableV2 columns={TEST_COLUMNS} types={TEST_TYPES} rows={TEST_ROWS} />
    )
    expect(screen.queryByLabelText('Format column age')).not.toBeInTheDocument()
  })
})

// ─── ChartBuilder axis selection ─────────────────────────────────────────────

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

    // Bar charts require at least 1 X-axis column — constraint error shown instead of rendering
    expect(screen.getByText(/Bar charts require at least 1 X-axis column/i)).toBeInTheDocument()
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

// ─── ChartBuilder onSeriesCountChange ────────────────────────────────────────

describe('ChartBuilder onSeriesCountChange', () => {
  it('reports one count per Y column for a line chart', () => {
    const onSeriesCountChange = vi.fn()
    renderWithProviders(
      <ChartBuilder
        columns={['day', 'last_month', 'this_month']}
        types={['BIGINT', 'DOUBLE', 'DOUBLE']}
        rows={[
          { day: 1, last_month: 100, this_month: 120 },
          { day: 2, last_month: 110, this_month: 90 },
        ]}
        chartType="line"
        initialXCols={['day']}
        initialYCols={['last_month', 'this_month']}
        onSeriesCountChange={onSeriesCountChange}
      />
    )

    expect(onSeriesCountChange).toHaveBeenLastCalledWith(2)
  })

  it('reports one count per slice (category) for a pie chart', () => {
    const onSeriesCountChange = vi.fn()
    renderWithProviders(
      <ChartBuilder
        columns={['vessel_type', 'share']}
        types={['VARCHAR', 'DOUBLE']}
        rows={[
          { vessel_type: 'Tanker', share: 36 },
          { vessel_type: 'Cargo', share: 32 },
          { vessel_type: 'Dry Bulk', share: 13 },
          { vessel_type: 'Container', share: 12 },
          { vessel_type: 'General Cargo', share: 5 },
          { vessel_type: 'RoRo', share: 2 },
        ]}
        chartType="pie"
        initialXCols={['vessel_type']}
        initialYCols={['share']}
        onSeriesCountChange={onSeriesCountChange}
      />
    )

    // 6 slices → 6 colors, not 1 (the single value series)
    expect(onSeriesCountChange).toHaveBeenLastCalledWith(6)
  })
})

// ─── ChartBuilder viz type constraints ───────────────────────────────────────

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

    expect(screen.queryByText(/combo charts require/i)).not.toBeInTheDocument()
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

  it('radar chart shows error with no X-axis columns', () => {
    renderWithProviders(
      <ChartBuilder
        columns={columns}
        types={types}
        rows={rows}
        chartType="radar"
        initialXCols={[]}
        initialYCols={['revenue']}
      />
    )

    expect(screen.getByText(/radar charts require at least 1 X-axis column/i)).toBeInTheDocument()
  })

  it('radar chart shows error with multiple X and multiple Y columns', () => {
    renderWithProviders(
      <ChartBuilder
        columns={columns}
        types={types}
        rows={rows}
        chartType="radar"
        initialXCols={['month', 'category']}
        initialYCols={['revenue', 'orders']}
      />
    )

    expect(screen.getByText(/radar charts support either multiple X columns/i)).toBeInTheDocument()
  })

  it('radar chart allows 2 X columns with 1 Y column (split-by)', () => {
    const radarRows = [
      { month: '2026-01', category: 'A', revenue: 100, orders: 10 },
      { month: '2026-02', category: 'A', revenue: 200, orders: 20 },
      { month: '2026-03', category: 'B', revenue: 150, orders: 15 },
    ]
    renderWithProviders(
      <ChartBuilder
        columns={columns}
        types={types}
        rows={radarRows}
        chartType="radar"
        initialXCols={['month', 'category']}
        initialYCols={['revenue']}
      />
    )

    expect(screen.queryByText(/radar charts require/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/radar charts support either/i)).not.toBeInTheDocument()
  })

  it('radar chart allows 1 X column with multiple Y columns', () => {
    const radarRows = [
      { month: '2026-01', category: 'A', revenue: 100, orders: 10 },
      { month: '2026-02', category: 'A', revenue: 200, orders: 20 },
      { month: '2026-03', category: 'B', revenue: 150, orders: 15 },
    ]
    renderWithProviders(
      <ChartBuilder
        columns={columns}
        types={types}
        rows={radarRows}
        chartType="radar"
        initialXCols={['month']}
        initialYCols={['revenue', 'orders']}
      />
    )

    expect(screen.queryByText(/radar charts require/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/radar charts support either/i)).not.toBeInTheDocument()
  })
})

// ─── VizConfigPanel dual axis ────────────────────────────────────────────────

describe('VizConfigPanel dual axis', () => {
  const columns = ['month', 'category', 'revenue', 'orders']
  const types = ['TIMESTAMP', 'VARCHAR', 'DOUBLE', 'BIGINT']

  it('shows single Y Axis zone when dualAxis is off', () => {
    renderWithProviders(
      <VizConfigPanel
        columns={columns}
        types={types}
        chartType="line"
        initialXCols={['month']}
        initialYCols={['revenue', 'orders']}
        axisConfig={{}}
        onAxisConfigChange={vi.fn()}
      />
    )

    expect(screen.getByText('Y Axis')).toBeInTheDocument()
    expect(screen.queryByText('Y Left')).not.toBeInTheDocument()
    expect(screen.queryByText('Y Right')).not.toBeInTheDocument()
  })

  it('shows Y Left and Y Right zones when dualAxis is on', () => {
    renderWithProviders(
      <VizConfigPanel
        columns={columns}
        types={types}
        chartType="line"
        initialXCols={['month']}
        initialYCols={['revenue']}
        initialYRightCols={['orders']}
        axisConfig={{ dualAxis: true }}
        onAxisConfigChange={vi.fn()}
      />
    )

    expect(screen.queryByText('Y Axis')).not.toBeInTheDocument()
    expect(screen.getByText('Y Left')).toBeInTheDocument()
    expect(screen.getByText('Y Right')).toBeInTheDocument()
  })

  it('shows dual axis toggle in settings panel', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <VizConfigPanel
        columns={columns}
        types={types}
        chartType="line"
        initialXCols={['month']}
        initialYCols={['revenue', 'orders']}
        axisConfig={{}}
        onAxisConfigChange={vi.fn()}
      />
    )

    const settingsTab = screen.getByText('Settings')
    await user.click(settingsTab)

    expect(screen.getByLabelText('Dual Y-axis toggle')).toBeInTheDocument()
  })

  it('renders one color swatch per Y-axis series in the style panel', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <VizConfigPanel
        columns={columns}
        types={types}
        chartType="line"
        initialXCols={['month']}
        initialYCols={['revenue', 'orders']}
        styleConfig={{}}
        onStyleConfigChange={vi.fn()}
        axisConfig={{}}
        onAxisConfigChange={vi.fn()}
      />
    )

    const settingsTab = screen.getByText('Settings')
    await user.click(settingsTab)

    // Two Y columns → two series → two color swatches (not a single one)
    expect(screen.getByLabelText('Series 1 color')).toBeInTheDocument()
    expect(screen.getByLabelText('Series 2 color')).toBeInTheDocument()
    expect(screen.queryByLabelText('Series 3 color')).not.toBeInTheDocument()
  })

  it('honors an explicit seriesCount from the chart over the column-derived count', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <VizConfigPanel
        columns={columns}
        types={types}
        chartType="line"
        initialXCols={['month', 'category']}
        initialYCols={['revenue']}
        // One Y column, but the chart split it by `category` into 3 real series
        seriesCount={3}
        styleConfig={{}}
        onStyleConfigChange={vi.fn()}
        axisConfig={{}}
        onAxisConfigChange={vi.fn()}
      />
    )

    const settingsTab = screen.getByText('Settings')
    await user.click(settingsTab)

    expect(screen.getByLabelText('Series 1 color')).toBeInTheDocument()
    expect(screen.getByLabelText('Series 2 color')).toBeInTheDocument()
    expect(screen.getByLabelText('Series 3 color')).toBeInTheDocument()
  })

  it('counts dual-axis right columns as additional series in the style panel', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <VizConfigPanel
        columns={columns}
        types={types}
        chartType="line"
        initialXCols={['month']}
        initialYCols={['revenue']}
        initialYRightCols={['orders']}
        styleConfig={{}}
        onStyleConfigChange={vi.fn()}
        axisConfig={{ dualAxis: true }}
        onAxisConfigChange={vi.fn()}
      />
    )

    const settingsTab = screen.getByText('Settings')
    await user.click(settingsTab)

    expect(screen.getByLabelText('Series 1 color')).toBeInTheDocument()
    expect(screen.getByLabelText('Series 2 color')).toBeInTheDocument()
  })
})

// ─── VizConfigPanel geo type (axis builder UI) ──────────────────────────────

const geoColumns = ['state', 'revenue', 'lat', 'lng', 'lat2', 'lng2']
const geoTypes = ['VARCHAR', 'DOUBLE', 'DOUBLE', 'DOUBLE', 'DOUBLE', 'DOUBLE']
const geoRows = [
  { state: 'Maharashtra', revenue: 120, lat: 19.076, lng: 72.877, lat2: 28.614, lng2: 77.209 },
  { state: 'Karnataka', revenue: 95, lat: 12.971, lng: 77.594, lat2: 13.083, lng2: 80.270 },
]

describe('VizConfigPanel geo type', () => {
  it('renders sub-type selector', () => {
    const geoConfig: GeoConfig = { subType: 'choropleth', mapName: 'india-states' }
    renderWithProviders(
      <VizConfigPanel
        columns={geoColumns}
        types={geoTypes}
        chartType="geo"
        initialGeoConfig={geoConfig}
        onGeoConfigChange={vi.fn()}
      />
    )

    expect(screen.getByLabelText('Geo sub-type Choropleth')).toBeInTheDocument()
    expect(screen.getByLabelText('Geo sub-type Points')).toBeInTheDocument()
    expect(screen.getByLabelText('Geo sub-type Lines')).toBeInTheDocument()
    expect(screen.getByLabelText('Geo sub-type Heatmap')).toBeInTheDocument()
  })

  it('does not render standard X/Y zones for geo', () => {
    const geoConfig: GeoConfig = { subType: 'choropleth', mapName: 'india-states' }
    renderWithProviders(
      <VizConfigPanel
        columns={geoColumns}
        types={geoTypes}
        chartType="geo"
        initialGeoConfig={geoConfig}
        onGeoConfigChange={vi.fn()}
      />
    )

    expect(screen.queryByText('X Axis')).not.toBeInTheDocument()
    expect(screen.queryByText('Y Axis')).not.toBeInTheDocument()
  })

  it('shows choropleth drop zones: Region and Value', () => {
    const geoConfig: GeoConfig = { subType: 'choropleth', mapName: 'india-states' }
    renderWithProviders(
      <VizConfigPanel
        columns={geoColumns}
        types={geoTypes}
        chartType="geo"
        initialGeoConfig={geoConfig}
        onGeoConfigChange={vi.fn()}
      />
    )

    expect(screen.getByText('Region')).toBeInTheDocument()
    expect(screen.getByText('Value')).toBeInTheDocument()
  })

  it('shows points drop zones: Latitude, Longitude, Size (optional)', () => {
    const geoConfig: GeoConfig = { subType: 'points' }
    renderWithProviders(
      <VizConfigPanel
        columns={geoColumns}
        types={geoTypes}
        chartType="geo"
        initialGeoConfig={geoConfig}
        onGeoConfigChange={vi.fn()}
      />
    )

    expect(screen.getByText('Latitude')).toBeInTheDocument()
    expect(screen.getByText('Longitude')).toBeInTheDocument()
    expect(screen.getByText('Size (optional)')).toBeInTheDocument()
  })

  it('shows lines drop zones', () => {
    const geoConfig: GeoConfig = { subType: 'lines' }
    renderWithProviders(
      <VizConfigPanel
        columns={geoColumns}
        types={geoTypes}
        chartType="geo"
        initialGeoConfig={geoConfig}
        onGeoConfigChange={vi.fn()}
      />
    )

    expect(screen.getByText('Origin Lat')).toBeInTheDocument()
    expect(screen.getByText('Origin Lng')).toBeInTheDocument()
    expect(screen.getByText('Dest Lat')).toBeInTheDocument()
    expect(screen.getByText('Dest Lng')).toBeInTheDocument()
  })

  it('shows heatmap drop zones', () => {
    const geoConfig: GeoConfig = { subType: 'heatmap' }
    renderWithProviders(
      <VizConfigPanel
        columns={geoColumns}
        types={geoTypes}
        chartType="geo"
        initialGeoConfig={geoConfig}
        onGeoConfigChange={vi.fn()}
      />
    )

    expect(screen.getByText('Latitude')).toBeInTheDocument()
    expect(screen.getByText('Longitude')).toBeInTheDocument()
    expect(screen.getByText('Intensity (optional)')).toBeInTheDocument()
  })

  it('calls onGeoConfigChange when sub-type is switched', async () => {
    const onGeoConfigChange = vi.fn()
    const user = userEvent.setup()
    const geoConfig: GeoConfig = { subType: 'choropleth', mapName: 'india-states' }

    renderWithProviders(
      <VizConfigPanel
        columns={geoColumns}
        types={geoTypes}
        chartType="geo"
        initialGeoConfig={geoConfig}
        onGeoConfigChange={onGeoConfigChange}
      />
    )

    await user.click(screen.getByLabelText('Geo sub-type Points'))

    expect(onGeoConfigChange).toHaveBeenCalledWith(
      expect.objectContaining({ subType: 'points' })
    )
  })

  it('shows Fields and Settings tabs', () => {
    const geoConfig: GeoConfig = { subType: 'choropleth', mapName: 'india-states' }
    renderWithProviders(
      <VizConfigPanel
        columns={geoColumns}
        types={geoTypes}
        chartType="geo"
        initialGeoConfig={geoConfig}
        onGeoConfigChange={vi.fn()}
      />
    )

    expect(screen.getByText('Fields')).toBeInTheDocument()
    expect(screen.getByText('Settings')).toBeInTheDocument()
  })

  it('shows base map selector and tiles toggle in Settings tab', async () => {
    const user = userEvent.setup()
    const geoConfig: GeoConfig = { subType: 'choropleth', mapName: 'india-states' }

    renderWithProviders(
      <VizConfigPanel
        columns={geoColumns}
        types={geoTypes}
        chartType="geo"
        initialGeoConfig={geoConfig}
        onGeoConfigChange={vi.fn()}
      />
    )

    await user.click(screen.getByText('Settings'))

    expect(screen.getByText('GeoJSON Map')).toBeInTheDocument()
    expect(screen.getByText('OpenStreetMap Tiles')).toBeInTheDocument()
  })

  it('shows color scale picker in Settings tab for choropleth', async () => {
    const user = userEvent.setup()
    const geoConfig: GeoConfig = { subType: 'choropleth', mapName: 'india-states' }

    renderWithProviders(
      <VizConfigPanel
        columns={geoColumns}
        types={geoTypes}
        chartType="geo"
        initialGeoConfig={geoConfig}
        onGeoConfigChange={vi.fn()}
      />
    )

    await user.click(screen.getByText('Settings'))

    expect(screen.getByText('Scale:')).toBeInTheDocument()
  })

  it('no bubble sub-type exists (merged into points)', () => {
    const geoConfig: GeoConfig = { subType: 'choropleth', mapName: 'india-states' }
    renderWithProviders(
      <VizConfigPanel
        columns={geoColumns}
        types={geoTypes}
        chartType="geo"
        initialGeoConfig={geoConfig}
        onGeoConfigChange={vi.fn()}
      />
    )

    expect(screen.queryByLabelText('Geo sub-type Bubble')).not.toBeInTheDocument()
  })

  it('writes pinnedCenter and pinnedZoom from the live map view when "Pin current map view" is clicked', async () => {
    const user = userEvent.setup()
    const onGeoConfigChange = vi.fn()
    const geoConfig: GeoConfig = { subType: 'points', latCol: 'lat', lngCol: 'lng' }

    renderWithProviders(
      <VizConfigPanel
        columns={geoColumns}
        types={geoTypes}
        chartType="geo"
        initialGeoConfig={geoConfig}
        onGeoConfigChange={onGeoConfigChange}
        getMapView={() => ({ center: [40.71, -74.01], zoom: 7 })}
      />
    )

    await user.click(screen.getByLabelText('Geo Settings tab'))
    await user.click(screen.getByLabelText('Pin current map view'))

    expect(onGeoConfigChange).toHaveBeenCalledWith(
      expect.objectContaining({ pinnedCenter: [40.71, -74.01], pinnedZoom: 7 })
    )
  })
})

// ─── ChartBuilder geo rendering ─────────────────────────────────────────────

describe('ChartBuilder geo rendering', () => {
  it('renders choropleth constraint error when no region/value columns assigned', () => {
    const geoConfig: GeoConfig = { subType: 'choropleth', mapName: 'india-states' }
    renderWithProviders(
      <ChartBuilder
        columns={geoColumns}
        types={geoTypes}
        rows={geoRows}
        chartType="geo"
        initialGeoConfig={geoConfig}
        onGeoConfigChange={vi.fn()}
      />
    )

    expect(screen.getByText(/Region Column is required/i)).toBeInTheDocument()
  })

  it('renders points constraint error when no lat/lng columns assigned', () => {
    const geoConfig: GeoConfig = { subType: 'points' }
    renderWithProviders(
      <ChartBuilder
        columns={geoColumns}
        types={geoTypes}
        rows={geoRows}
        chartType="geo"
        initialGeoConfig={geoConfig}
        onGeoConfigChange={vi.fn()}
      />
    )

    expect(screen.getByText(/Lat Column is required/i)).toBeInTheDocument()
  })

  it('renders map successfully for choropleth with all columns assigned', async () => {
    const geoConfig: GeoConfig = {
      subType: 'choropleth',
      mapName: 'india-states',
      regionCol: 'state',
      valueCol: 'revenue',
    }
    renderWithProviders(
      <ChartBuilder
        columns={geoColumns}
        types={geoTypes}
        rows={geoRows}
        chartType="geo"
        initialGeoConfig={geoConfig}
        onGeoConfigChange={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.queryByText(/required/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/No data/i)).not.toBeInTheDocument()
    })
  })

  it('renders map successfully for points with lat/lng assigned', () => {
    const geoConfig: GeoConfig = {
      subType: 'points',
      latCol: 'lat',
      lngCol: 'lng',
    }
    renderWithProviders(
      <ChartBuilder
        columns={geoColumns}
        types={geoTypes}
        rows={geoRows}
        chartType="geo"
        initialGeoConfig={geoConfig}
        onGeoConfigChange={vi.fn()}
      />
    )

    expect(screen.queryByText(/required/i)).not.toBeInTheDocument()
  })

  it('renders map successfully for points with bubble sizing (valueCol set)', () => {
    const geoConfig: GeoConfig = {
      subType: 'points',
      latCol: 'lat',
      lngCol: 'lng',
      valueCol: 'revenue',
    }
    renderWithProviders(
      <ChartBuilder
        columns={geoColumns}
        types={geoTypes}
        rows={geoRows}
        chartType="geo"
        initialGeoConfig={geoConfig}
        onGeoConfigChange={vi.fn()}
      />
    )

    expect(screen.queryByText(/required/i)).not.toBeInTheDocument()
  })
})
