import React from 'react'
import { screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/helpers/render-with-providers'
import { TableV2 } from '@/components/plotx/TableV2'
import { ChartBuilder } from '@/components/plotx/ChartBuilder'
import type { GeoConfig } from '@/lib/types'

// ─── Shared mocks ────────────────────────────────────────────────────────────

jest.mock('@/components/plotx/EChart', () => ({
  EChart: () => <div data-testid="mock-echart" />,
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

// ─── TableV2 mocks ───────────────────────────────────────────────────────────

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

// ─── Geo-plot mocks ──────────────────────────────────────────────────────────

const mockSetView = jest.fn()
const mockRemove = jest.fn()
const mockFitBounds = jest.fn()
const mockInvalidateSize = jest.fn()
const mockAddLayer = jest.fn()

const mockLayerGroup = {
  addTo: jest.fn().mockReturnThis(),
  addLayer: jest.fn(),
  clearLayers: jest.fn(),
}

const mockGeoJsonLayer = {
  addTo: jest.fn().mockReturnThis(),
  getBounds: jest.fn().mockReturnValue({ isValid: () => true }),
  eachLayer: jest.fn(),
}

jest.mock('leaflet', () => ({
  map: jest.fn(() => ({
    setView: mockSetView,
    remove: mockRemove,
    fitBounds: mockFitBounds,
    invalidateSize: mockInvalidateSize,
    addLayer: mockAddLayer,
  })),
  tileLayer: jest.fn(() => ({ addTo: jest.fn().mockReturnThis(), remove: jest.fn() })),
  circleMarker: jest.fn(() => ({
    addTo: jest.fn().mockReturnThis(),
    getLatLng: jest.fn().mockReturnValue({ lat: 0, lng: 0 }),
    bindTooltip: jest.fn().mockReturnThis(),
  })),
  geoJSON: jest.fn(() => mockGeoJsonLayer),
  polyline: jest.fn(() => ({
    addTo: jest.fn().mockReturnThis(),
    getLatLngs: jest.fn().mockReturnValue([{ lat: 0, lng: 0 }]),
    bindTooltip: jest.fn().mockReturnThis(),
  })),
  layerGroup: jest.fn(() => mockLayerGroup),
  latLngBounds: jest.fn().mockReturnValue({
    isValid: () => true,
    extend: jest.fn().mockReturnThis(),
  }),
  heatLayer: jest.fn(() => ({ addTo: jest.fn().mockReturnThis() })),
}))

jest.mock('leaflet.heat', () => {})
jest.mock('leaflet/dist/leaflet.css', () => {})

jest.mock('@/lib/chart/geo-data', () => ({
  loadGeoJSON: jest.fn().mockResolvedValue({
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

    expect(screen.getByText('250')).toBeInTheDocument()
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

// ─── ChartBuilder dual axis ───────────────────────────────────────────────────

describe('ChartBuilder dual axis', () => {
  const columns = ['month', 'category', 'revenue', 'orders']
  const types = ['TIMESTAMP', 'VARCHAR', 'DOUBLE', 'BIGINT']
  const rows = [
    { month: '2026-01', category: 'A', revenue: 100, orders: 10 },
    { month: '2026-02', category: 'B', revenue: 200, orders: 20 },
  ]

  it('shows single Y Axis zone when dualAxis is off', () => {
    renderWithProviders(
      <ChartBuilder
        columns={columns}
        types={types}
        rows={rows}
        chartType="line"
        initialXCols={['month']}
        initialYCols={['revenue', 'orders']}
        showAxisBuilder
        axisConfig={{}}
        onAxisConfigChange={jest.fn()}
      />
    )

    expect(screen.getByText('Y Axis')).toBeInTheDocument()
    expect(screen.queryByText('Y Left')).not.toBeInTheDocument()
    expect(screen.queryByText('Y Right')).not.toBeInTheDocument()
  })

  it('shows Y Left and Y Right zones when dualAxis is on', () => {
    renderWithProviders(
      <ChartBuilder
        columns={columns}
        types={types}
        rows={rows}
        chartType="line"
        initialXCols={['month']}
        initialYCols={['revenue']}
        initialYRightCols={['orders']}
        showAxisBuilder
        axisConfig={{ dualAxis: true }}
        onAxisConfigChange={jest.fn()}
      />
    )

    expect(screen.queryByText('Y Axis')).not.toBeInTheDocument()
    expect(screen.getByText('Y Left')).toBeInTheDocument()
    expect(screen.getByText('Y Right')).toBeInTheDocument()
  })

  it('shows dual axis toggle in settings panel', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <ChartBuilder
        columns={columns}
        types={types}
        rows={rows}
        chartType="line"
        initialXCols={['month']}
        initialYCols={['revenue', 'orders']}
        showAxisBuilder
        axisConfig={{}}
        onAxisConfigChange={jest.fn()}
        settingsExpanded
      />
    )

    const settingsTab = screen.getByText('Settings')
    await user.click(settingsTab)

    expect(screen.getByLabelText('Dual Y-axis toggle')).toBeInTheDocument()
  })
})

// ─── ChartBuilder geo type ────────────────────────────────────────────────────

const geoColumns = ['state', 'revenue', 'lat', 'lng', 'lat2', 'lng2']
const geoTypes = ['VARCHAR', 'DOUBLE', 'DOUBLE', 'DOUBLE', 'DOUBLE', 'DOUBLE']
const geoRows = [
  { state: 'Maharashtra', revenue: 120, lat: 19.076, lng: 72.877, lat2: 28.614, lng2: 77.209 },
  { state: 'Karnataka', revenue: 95, lat: 12.971, lng: 77.594, lat2: 13.083, lng2: 80.270 },
]

describe('ChartBuilder geo type', () => {
  it('renders GeoAxisBuilder with sub-type selector when chartType is geo', () => {
    const geoConfig: GeoConfig = { subType: 'choropleth', mapName: 'india-states' }
    renderWithProviders(
      <ChartBuilder
        columns={geoColumns}
        types={geoTypes}
        rows={geoRows}
        chartType="geo"
        showAxisBuilder
        settingsExpanded
        initialGeoConfig={geoConfig}
        onGeoConfigChange={jest.fn()}
      />
    )

    expect(screen.getByLabelText('Geo sub-type Choropleth')).toBeInTheDocument()
    expect(screen.getByLabelText('Geo sub-type Points')).toBeInTheDocument()
    expect(screen.getByLabelText('Geo sub-type Lines')).toBeInTheDocument()
    expect(screen.getByLabelText('Geo sub-type Heatmap')).toBeInTheDocument()
  })

  it('does not render standard AxisBuilder X/Y zones for geo', () => {
    const geoConfig: GeoConfig = { subType: 'choropleth', mapName: 'india-states' }
    renderWithProviders(
      <ChartBuilder
        columns={geoColumns}
        types={geoTypes}
        rows={geoRows}
        chartType="geo"
        showAxisBuilder
        settingsExpanded
        initialGeoConfig={geoConfig}
        onGeoConfigChange={jest.fn()}
      />
    )

    expect(screen.queryByText('X Axis')).not.toBeInTheDocument()
    expect(screen.queryByText('Y Axis')).not.toBeInTheDocument()
  })

  it('shows choropleth drop zones: Region and Value', () => {
    const geoConfig: GeoConfig = { subType: 'choropleth', mapName: 'india-states' }
    renderWithProviders(
      <ChartBuilder
        columns={geoColumns}
        types={geoTypes}
        rows={geoRows}
        chartType="geo"
        showAxisBuilder
        settingsExpanded
        initialGeoConfig={geoConfig}
        onGeoConfigChange={jest.fn()}
      />
    )

    expect(screen.getByText('Region')).toBeInTheDocument()
    expect(screen.getByText('Value')).toBeInTheDocument()
  })

  it('shows points drop zones: Latitude, Longitude, Size (optional)', () => {
    const geoConfig: GeoConfig = { subType: 'points' }
    renderWithProviders(
      <ChartBuilder
        columns={geoColumns}
        types={geoTypes}
        rows={geoRows}
        chartType="geo"
        showAxisBuilder
        settingsExpanded
        initialGeoConfig={geoConfig}
        onGeoConfigChange={jest.fn()}
      />
    )

    expect(screen.getByText('Latitude')).toBeInTheDocument()
    expect(screen.getByText('Longitude')).toBeInTheDocument()
    expect(screen.getByText('Size (optional)')).toBeInTheDocument()
  })

  it('shows lines drop zones: Origin Lat, Origin Lng, Dest Lat, Dest Lng', () => {
    const geoConfig: GeoConfig = { subType: 'lines' }
    renderWithProviders(
      <ChartBuilder
        columns={geoColumns}
        types={geoTypes}
        rows={geoRows}
        chartType="geo"
        showAxisBuilder
        settingsExpanded
        initialGeoConfig={geoConfig}
        onGeoConfigChange={jest.fn()}
      />
    )

    expect(screen.getByText('Origin Lat')).toBeInTheDocument()
    expect(screen.getByText('Origin Lng')).toBeInTheDocument()
    expect(screen.getByText('Dest Lat')).toBeInTheDocument()
    expect(screen.getByText('Dest Lng')).toBeInTheDocument()
  })

  it('shows heatmap drop zones: Latitude, Longitude, Intensity (optional)', () => {
    const geoConfig: GeoConfig = { subType: 'heatmap' }
    renderWithProviders(
      <ChartBuilder
        columns={geoColumns}
        types={geoTypes}
        rows={geoRows}
        chartType="geo"
        showAxisBuilder
        settingsExpanded
        initialGeoConfig={geoConfig}
        onGeoConfigChange={jest.fn()}
      />
    )

    expect(screen.getByText('Latitude')).toBeInTheDocument()
    expect(screen.getByText('Longitude')).toBeInTheDocument()
    expect(screen.getByText('Intensity (optional)')).toBeInTheDocument()
  })

  it('calls onGeoConfigChange when sub-type is switched', async () => {
    const onGeoConfigChange = jest.fn()
    const user = userEvent.setup()
    const geoConfig: GeoConfig = { subType: 'choropleth', mapName: 'india-states' }

    renderWithProviders(
      <ChartBuilder
        columns={geoColumns}
        types={geoTypes}
        rows={geoRows}
        chartType="geo"
        showAxisBuilder
        settingsExpanded
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
      <ChartBuilder
        columns={geoColumns}
        types={geoTypes}
        rows={geoRows}
        chartType="geo"
        showAxisBuilder
        settingsExpanded
        initialGeoConfig={geoConfig}
        onGeoConfigChange={jest.fn()}
      />
    )

    expect(screen.getByText('Fields')).toBeInTheDocument()
    expect(screen.getByText('Settings')).toBeInTheDocument()
  })

  it('shows base map selector and tiles toggle in Settings tab', async () => {
    const user = userEvent.setup()
    const geoConfig: GeoConfig = { subType: 'choropleth', mapName: 'india-states' }

    renderWithProviders(
      <ChartBuilder
        columns={geoColumns}
        types={geoTypes}
        rows={geoRows}
        chartType="geo"
        showAxisBuilder
        settingsExpanded
        initialGeoConfig={geoConfig}
        onGeoConfigChange={jest.fn()}
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
      <ChartBuilder
        columns={geoColumns}
        types={geoTypes}
        rows={geoRows}
        chartType="geo"
        showAxisBuilder
        settingsExpanded
        initialGeoConfig={geoConfig}
        onGeoConfigChange={jest.fn()}
      />
    )

    await user.click(screen.getByText('Settings'))

    expect(screen.getByText('Scale:')).toBeInTheDocument()
  })

  it('does not show color scale picker for non-choropleth sub-types', async () => {
    const user = userEvent.setup()
    const geoConfig: GeoConfig = { subType: 'points' }

    renderWithProviders(
      <ChartBuilder
        columns={geoColumns}
        types={geoTypes}
        rows={geoRows}
        chartType="geo"
        showAxisBuilder
        settingsExpanded
        initialGeoConfig={geoConfig}
        onGeoConfigChange={jest.fn()}
      />
    )

    await user.click(screen.getByText('Settings'))

    expect(screen.queryByText('Scale:')).not.toBeInTheDocument()
  })

  it('base map selector is available for non-choropleth sub-types', async () => {
    const user = userEvent.setup()
    const geoConfig: GeoConfig = { subType: 'points' }

    renderWithProviders(
      <ChartBuilder
        columns={geoColumns}
        types={geoTypes}
        rows={geoRows}
        chartType="geo"
        showAxisBuilder
        settingsExpanded
        initialGeoConfig={geoConfig}
        onGeoConfigChange={jest.fn()}
      />
    )

    await user.click(screen.getByText('Settings'))

    expect(screen.getByText('GeoJSON Map')).toBeInTheDocument()
  })

  it('no bubble sub-type exists (merged into points)', () => {
    const geoConfig: GeoConfig = { subType: 'choropleth', mapName: 'india-states' }
    renderWithProviders(
      <ChartBuilder
        columns={geoColumns}
        types={geoTypes}
        rows={geoRows}
        chartType="geo"
        showAxisBuilder
        settingsExpanded
        initialGeoConfig={geoConfig}
        onGeoConfigChange={jest.fn()}
      />
    )

    expect(screen.queryByLabelText('Geo sub-type Bubble')).not.toBeInTheDocument()
  })

  it('renders choropleth constraint error when no region/value columns assigned', () => {
    const geoConfig: GeoConfig = { subType: 'choropleth', mapName: 'india-states' }
    renderWithProviders(
      <ChartBuilder
        columns={geoColumns}
        types={geoTypes}
        rows={geoRows}
        chartType="geo"
        initialGeoConfig={geoConfig}
        onGeoConfigChange={jest.fn()}
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
        onGeoConfigChange={jest.fn()}
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
        onGeoConfigChange={jest.fn()}
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
        onGeoConfigChange={jest.fn()}
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
        onGeoConfigChange={jest.fn()}
      />
    )

    expect(screen.queryByText(/required/i)).not.toBeInTheDocument()
  })
})
