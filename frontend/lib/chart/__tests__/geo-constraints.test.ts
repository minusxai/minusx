import { getGeoConstraintError } from '@/lib/chart/geo-constraints'
import type { GeoConfig } from '@/lib/types'

const columns = ['state', 'revenue', 'lat', 'lng', 'lat2', 'lng2', 'intensity']

describe('getGeoConstraintError', () => {
  describe('choropleth', () => {
    it('requires regionCol', () => {
      const config: GeoConfig = { subType: 'choropleth', mapName: 'us-states', valueCol: 'revenue' }
      const result = getGeoConstraintError(config, columns)
      expect(result.error).toContain('Region')
    })

    it('requires valueCol', () => {
      const config: GeoConfig = { subType: 'choropleth', mapName: 'us-states', regionCol: 'state' }
      const result = getGeoConstraintError(config, columns)
      expect(result.error).toContain('Value')
    })

    it('requires mapName', () => {
      const config: GeoConfig = { subType: 'choropleth', regionCol: 'state', valueCol: 'revenue' }
      const result = getGeoConstraintError(config, columns)
      expect(result.error).toContain('map')
    })

    it('passes with valid config', () => {
      const config: GeoConfig = { subType: 'choropleth', mapName: 'us-states', regionCol: 'state', valueCol: 'revenue' }
      const result = getGeoConstraintError(config, columns)
      expect(result.error).toBeNull()
    })

    it('errors when regionCol not in columns', () => {
      const config: GeoConfig = { subType: 'choropleth', mapName: 'us-states', regionCol: 'missing', valueCol: 'revenue' }
      const result = getGeoConstraintError(config, columns)
      expect(result.error).toBeTruthy()
    })
  })

  describe('points', () => {
    it('requires latCol and lngCol', () => {
      const config: GeoConfig = { subType: 'points', latCol: 'lat' }
      const result = getGeoConstraintError(config, columns)
      expect(result.error).toContain('Lng')
    })

    it('passes with valid config', () => {
      const config: GeoConfig = { subType: 'points', latCol: 'lat', lngCol: 'lng' }
      const result = getGeoConstraintError(config, columns)
      expect(result.error).toBeNull()
    })

    it('passes with optional valueCol for bubble sizing', () => {
      const config: GeoConfig = { subType: 'points', latCol: 'lat', lngCol: 'lng', valueCol: 'revenue' }
      const result = getGeoConstraintError(config, columns)
      expect(result.error).toBeNull()
    })

    it('errors when optional valueCol not in columns', () => {
      const config: GeoConfig = { subType: 'points', latCol: 'lat', lngCol: 'lng', valueCol: 'missing' }
      const result = getGeoConstraintError(config, columns)
      expect(result.error).toBeTruthy()
    })
  })

  describe('lines', () => {
    it('requires all four coordinate columns', () => {
      const config: GeoConfig = { subType: 'lines', latCol: 'lat', lngCol: 'lng', latCol2: 'lat2' }
      const result = getGeoConstraintError(config, columns)
      expect(result.error).toContain('Lng2')
    })

    it('passes with valid config', () => {
      const config: GeoConfig = { subType: 'lines', latCol: 'lat', lngCol: 'lng', latCol2: 'lat2', lngCol2: 'lng2' }
      const result = getGeoConstraintError(config, columns)
      expect(result.error).toBeNull()
    })
  })

  describe('heatmap', () => {
    it('requires latCol and lngCol', () => {
      const config: GeoConfig = { subType: 'heatmap' }
      const result = getGeoConstraintError(config, columns)
      expect(result.error).toBeTruthy()
    })

    it('passes with lat+lng (no value)', () => {
      const config: GeoConfig = { subType: 'heatmap', latCol: 'lat', lngCol: 'lng' }
      const result = getGeoConstraintError(config, columns)
      expect(result.error).toBeNull()
    })

    it('passes with lat+lng+value', () => {
      const config: GeoConfig = { subType: 'heatmap', latCol: 'lat', lngCol: 'lng', valueCol: 'intensity' }
      const result = getGeoConstraintError(config, columns)
      expect(result.error).toBeNull()
    })
  })

  describe('missing geoConfig', () => {
    it('returns error for undefined config', () => {
      const result = getGeoConstraintError(undefined, columns)
      expect(result.error).toBeTruthy()
    })
  })
})
