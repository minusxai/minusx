import type { FeatureCollection } from 'geojson'

const cache: Record<string, FeatureCollection> = {}

export async function loadGeoJSON(mapName: string): Promise<FeatureCollection> {
  if (cache[mapName]) return cache[mapName]
  const resp = await fetch(`/geojson/${mapName}.json`)
  if (!resp.ok) throw new Error(`Failed to load GeoJSON: ${mapName}`)
  const data: FeatureCollection = await resp.json()
  cache[mapName] = data
  return data
}

export const MAP_OPTIONS = [
  { value: 'world', label: 'World (Countries)' },
  { value: 'us-states', label: 'US (States)' },
  { value: 'india-states', label: 'India (States)' },
] as const

export type MapName = typeof MAP_OPTIONS[number]['value']

/** Default center + zoom for each base map */
export const MAP_DEFAULTS: Record<MapName, { center: [number, number]; zoom: number }> = {
  'world': { center: [20, 0], zoom: 2 },
  'us-states': { center: [37.8, -96], zoom: 4 },
  'india-states': { center: [22.5, 82], zoom: 5 },
}
