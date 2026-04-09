import type { GeoConfig } from '@/lib/types.gen'

export interface GeoConstraintResult {
  error: string | null
}

/**
 * Validate that a GeoConfig has all required fields for its sub-type,
 * and that referenced columns exist in the data.
 */
export function getGeoConstraintError(
  config: GeoConfig | undefined | null,
  columns: string[],
): GeoConstraintResult {
  if (!config) return { error: 'Select a geo sub-type to get started.' }

  const has = (col: string | undefined | null) => col && columns.includes(col)

  switch (config.subType) {
    case 'choropleth': {
      if (!config.mapName) return { error: 'Select a base map for the choropleth.' }
      if (!config.regionCol) return { error: 'Region Column is required for choropleth.' }
      if (!has(config.regionCol)) return { error: `Region Column "${config.regionCol}" not found in data.` }
      if (!config.valueCol) return { error: 'Value Column is required for choropleth.' }
      if (!has(config.valueCol)) return { error: `Value Column "${config.valueCol}" not found in data.` }
      return { error: null }
    }

    case 'points': {
      if (!config.latCol) return { error: 'Lat Column is required for point maps.' }
      if (!has(config.latCol)) return { error: `Lat Column "${config.latCol}" not found in data.` }
      if (!config.lngCol) return { error: 'Lng Column is required for point maps.' }
      if (!has(config.lngCol)) return { error: `Lng Column "${config.lngCol}" not found in data.` }
      return { error: null }
    }

    case 'bubble': {
      if (!config.latCol) return { error: 'Lat Column is required for bubble maps.' }
      if (!has(config.latCol)) return { error: `Lat Column "${config.latCol}" not found in data.` }
      if (!config.lngCol) return { error: 'Lng Column is required for bubble maps.' }
      if (!has(config.lngCol)) return { error: `Lng Column "${config.lngCol}" not found in data.` }
      if (!config.valueCol) return { error: 'Value Column is required for bubble maps.' }
      if (!has(config.valueCol)) return { error: `Value Column "${config.valueCol}" not found in data.` }
      return { error: null }
    }

    case 'lines': {
      if (!config.latCol) return { error: 'Lat Column is required for line maps.' }
      if (!has(config.latCol)) return { error: `Lat Column "${config.latCol}" not found in data.` }
      if (!config.lngCol) return { error: 'Lng Column is required for line maps.' }
      if (!has(config.lngCol)) return { error: `Lng Column "${config.lngCol}" not found in data.` }
      if (!config.latCol2) return { error: 'Lat2 Column is required for line maps.' }
      if (!has(config.latCol2)) return { error: `Lat2 Column "${config.latCol2}" not found in data.` }
      if (!config.lngCol2) return { error: 'Lng2 Column is required for line maps.' }
      if (!has(config.lngCol2)) return { error: `Lng2 Column "${config.lngCol2}" not found in data.` }
      return { error: null }
    }

    case 'heatmap': {
      if (!config.latCol) return { error: 'Lat Column is required for heatmaps.' }
      if (!has(config.latCol)) return { error: `Lat Column "${config.latCol}" not found in data.` }
      if (!config.lngCol) return { error: 'Lng Column is required for heatmaps.' }
      if (!has(config.lngCol)) return { error: `Lng Column "${config.lngCol}" not found in data.` }
      // valueCol is optional for heatmaps
      if (config.valueCol && !has(config.valueCol)) return { error: `Value Column "${config.valueCol}" not found in data.` }
      return { error: null }
    }

    default:
      return { error: `Unknown geo sub-type: ${(config as GeoConfig).subType}` }
  }
}
