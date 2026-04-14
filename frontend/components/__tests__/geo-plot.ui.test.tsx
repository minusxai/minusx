import React from 'react'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/helpers/render-with-providers'
import { ChartBuilder } from '@/components/plotx/ChartBuilder'
import type { GeoConfig } from '@/lib/types'

// Mock Leaflet — JSDOM has no canvas/DOM rendering
const mockSetView = jest.fn()
const mockRemove = jest.fn()
const mockFitBounds = jest.fn()
const mockInvalidateSize = jest.fn()
const mockAddLayer = jest.fn()
const mockClearLayers = jest.fn()

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

// Mock leaflet.heat (side-effect import)
jest.mock('leaflet.heat', () => {})

// Mock leaflet CSS
jest.mock('leaflet/dist/leaflet.css', () => {})

// Mock EChart to avoid echarts init crash in JSDOM
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

// Mock geo-data to avoid actual fetch calls
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

    // Sub-type selector should be visible in the Fields tab
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

    // Should show a constraint/info message since regionCol is not set
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

    // Wait for GeoJSON to load (mocked)
    await waitFor(() => {
      // Should not show any error messages
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
