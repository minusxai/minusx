'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import L from 'leaflet'
import 'leaflet.heat'
import { LeafletMap, type LeafletMapHandle } from './LeafletMap'
import { ChartError } from './ChartError'
import { loadGeoJSON, MAP_DEFAULTS, type MapName } from '@/lib/chart/geo-data'
import { getColorScale, getRadiusScale, getHeatGradient, GEO_MARKER_COLOR, GEO_MARKER_COLOR_DARK } from '@/lib/chart/geo-color-scale'
import { COLOR_PALETTE } from '@/lib/chart/echarts-theme'
import { formatNumber, applyPrefixSuffix } from '@/lib/chart/chart-utils'
import { getGeoConstraintError } from '@/lib/chart/geo-constraints'
import { computeHeatmapOptions } from '@/lib/chart/geo-heatmap-defaults'
import { parseGeoNumber } from '@/lib/chart/geo-value-utils'
import { useAppSelector } from '@/store/hooks'
import type { GeoConfig, ColumnFormatConfig } from '@/lib/types'
import type { FeatureCollection } from 'geojson'

export type GetMapView = () => { center: [number, number]; zoom: number } | null

interface GeoPlotProps {
  rows: Record<string, unknown>[]
  columns: string[]
  geoConfig: GeoConfig
  tooltipCols?: string[]
  markerColor?: string
  height?: number | string
  columnFormats?: Record<string, ColumnFormatConfig>
  onMapReady?: (getView: GetMapView) => void
}

/** Border colors: close to white in dark, close to black in light */
const GEO_BORDER = {
  light: '#2a2a2a',
  dark: '#d0d0d0',
}

const TOOLTIP_STYLE = {
  light: {
    bg: 'rgba(255,255,255,0.95)',
    border: '#D0D7DE',
    fg: '#0D1117',
    fgMuted: '#57606A',
  },
  dark: {
    bg: 'rgba(22,27,34,0.95)',
    border: '#30363D',
    fg: '#E6EDF3',
    fgMuted: '#8B949E',
  },
}

function geoTooltipHtml(
  rows: Array<{ key: string; value: string }>,
  header: string | null,
  colorMode: 'light' | 'dark',
): string {
  const t = TOOLTIP_STYLE[colorMode]
  const headerHtml = header
    ? `<div style="font-weight:700;margin-bottom:4px;color:${t.fg}">${header}</div>`
    : ''
  const rowsHtml = rows.map(
    (r) =>
      `<tr><td style="padding:1px 10px 1px 0;color:${t.fgMuted};white-space:nowrap">${r.key}</td><td style="text-align:right;font-weight:600;color:${t.fg};white-space:nowrap">${r.value}</td></tr>`,
  ).join('')
  return `<div style="font-family:JetBrains Mono,Consolas,monospace;font-size:12px;background:${t.bg};color:${t.fg};border:1px solid ${t.border};border-radius:4px;padding:6px 8px;box-shadow:0 2px 8px rgba(0,0,0,0.15)">${headerHtml}<table style="border-collapse:collapse">${rowsHtml}</table></div>`
}

const GEO_TOOLTIP_OPTIONS: L.TooltipOptions = {
  sticky: true,
  direction: 'top',
  offset: [0, -8],
  opacity: 1,
  className: 'geo-tooltip-custom',
}

/** Default style for background regions — subtle for lines, more visible for others */
function getGeoOnlyStyle(colorMode: 'light' | 'dark', isLines: boolean): L.PathOptions {
  if (isLines) {
    return colorMode === 'light'
      ? { fillColor: '#D0D7DE', weight: 0.3, color: '#ccc', fillOpacity: 0.1 }
      : { fillColor: '#30363D', weight: 0.3, color: '#555', fillOpacity: 0.1 }
  }
  return colorMode === 'light'
    ? { fillColor: '#D0D7DE', weight: 0.5, color: '#aaa', fillOpacity: 0.25 }
    : { fillColor: '#30363D', weight: 0.5, color: '#666', fillOpacity: 0.3 }
}

/** Generate intermediate points along a great-circle arc */
function greatCircleArc(lat1: number, lng1: number, lat2: number, lng2: number, numPoints = 50): [number, number][] {
  const toRad = (d: number) => (d * Math.PI) / 180
  const toDeg = (r: number) => (r * 180) / Math.PI
  const φ1 = toRad(lat1), λ1 = toRad(lng1)
  const φ2 = toRad(lat2), λ2 = toRad(lng2)
  const d = 2 * Math.asin(Math.sqrt(
    Math.sin((φ2 - φ1) / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2,
  ))
  if (d < 1e-10) return [[lat1, lng1], [lat2, lng2]]
  const points: [number, number][] = []
  for (let i = 0; i <= numPoints; i++) {
    const f = i / numPoints
    const a = Math.sin((1 - f) * d) / Math.sin(d)
    const b = Math.sin(f * d) / Math.sin(d)
    const x = a * Math.cos(φ1) * Math.cos(λ1) + b * Math.cos(φ2) * Math.cos(λ2)
    const y = a * Math.cos(φ1) * Math.sin(λ1) + b * Math.cos(φ2) * Math.sin(λ2)
    const z = a * Math.sin(φ1) + b * Math.sin(φ2)
    points.push([toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))), toDeg(Math.atan2(y, x))])
  }
  return points
}

export function GeoPlot({ rows, columns, geoConfig, tooltipCols = [], markerColor, height, columnFormats = {}, onMapReady }: GeoPlotProps) {
  const colorMode = useAppSelector((state) => state.ui.colorMode) as 'light' | 'dark'
  const [geoJsonData, setGeoJsonData] = useState<FeatureCollection | null>(null)
  const [geoJsonError, setGeoJsonError] = useState<string | null>(null)
  const selectedLayerRef = useRef<L.Layer | null>(null)
  const mapRef = useRef<LeafletMapHandle>(null)

  // Expose getView to parent via callback
  useEffect(() => {
    if (mapRef.current && onMapReady) {
      onMapReady(() => mapRef.current?.getView() ?? null)
    }
  }) // runs after every render to catch map init

  // Validate config
  const constraint = getGeoConstraintError(geoConfig, columns)
  const hasError = constraint.error !== null

  const needsGeoJson = !!geoConfig.mapName

  // Load GeoJSON when mapName is set (choropleth fills it, others use it as background outline)
  useEffect(() => {
    if (!needsGeoJson) return

    let cancelled = false
    loadGeoJSON(geoConfig.mapName!)
      .then((data) => { if (!cancelled) setGeoJsonData(data) })
      .catch((err) => { if (!cancelled) setGeoJsonError(String(err)) })
    return () => { cancelled = true }
  }, [needsGeoJson, geoConfig.mapName])

  // Reset GeoJSON data when not needed (derived, not in effect)
  const effectiveGeoJsonData = needsGeoJson ? geoJsonData : null

  const effectiveMarkerColor = markerColor ?? (colorMode === 'dark' ? GEO_MARKER_COLOR_DARK : GEO_MARKER_COLOR)

  // Build Leaflet layers from data
  const { layers, bounds } = useMemo(() => {
    if (hasError) return { layers: [], bounds: undefined }

    /** Build extra tooltip rows from user-configured tooltipCols */
    const extraTooltipRows = (row: Record<string, unknown>): Array<{ key: string; value: string }> =>
      tooltipCols
        .filter(col => row[col] != null)
        .map(col => ({ key: col, value: typeof row[col] === 'number' ? Number(row[col]).toLocaleString() : String(row[col]) }))

    const builtLayers: L.Layer[] = []
    let builtBounds: L.LatLngBounds | undefined

    // For non-choropleth, add GeoJSON as a background outline layer if available
    if (geoConfig.subType !== 'choropleth' && effectiveGeoJsonData) {
      const bgLayer = L.geoJSON(effectiveGeoJsonData, {
        style: () => getGeoOnlyStyle(colorMode, geoConfig.subType === 'lines'),
      })
      builtLayers.push(bgLayer)
      builtBounds = bgLayer.getBounds()
    }

    switch (geoConfig.subType) {
      case 'choropleth': {
        if (!effectiveGeoJsonData || !geoConfig.regionCol || !geoConfig.valueCol) break

        // Build value lookup
        const valueMap = new Map<string, number>()
        let min = Infinity
        let max = -Infinity
        for (const row of rows) {
          const region = String(row[geoConfig.regionCol] ?? '')
          const val = parseGeoNumber(row[geoConfig.valueCol])
          if (region && !isNaN(val)) {
            valueMap.set(region.toLowerCase(), val)
            min = Math.min(min, val)
            max = Math.max(max, val)
          }
        }

        const defaultStyle = (feature: GeoJSON.Feature | undefined): L.PathOptions => {
          const name = String(feature?.properties?.name ?? '').toLowerCase()
          const val = valueMap.get(name)
          if (val === undefined) return { ...getGeoOnlyStyle(colorMode, false), fillOpacity: 0.1 }
          return {
            fillColor: getColorScale(val, min, max, colorMode, geoConfig.colorScale),
            weight: 0.5,
            color: GEO_BORDER[colorMode],
            fillOpacity: 0.8,
          }
        }

        // eslint-disable-next-line react-hooks/refs -- ref used in click handler, not during render
        const geoLayer = L.geoJSON(effectiveGeoJsonData, {
          style: defaultStyle,
          onEachFeature: (feature, layer) => {
            const name = String(feature?.properties?.name ?? '')
            const val = valueMap.get(name.toLowerCase())
            if (val !== undefined) {
              // Find the matching row to get extra tooltip cols
              const matchRow = rows.find(r => String(r[geoConfig.regionCol!] ?? '').toLowerCase() === name.toLowerCase())
              const ttRows = [{ key: geoConfig.valueCol!, value: val.toLocaleString() }, ...(matchRow ? extraTooltipRows(matchRow) : [])]
              layer.bindTooltip(
                geoTooltipHtml(ttRows, name, colorMode),
                GEO_TOOLTIP_OPTIONS,
              )
            }

            // Click to highlight region border
            layer.on('click', () => {
              // Reset previously selected
              if (selectedLayerRef.current && selectedLayerRef.current !== layer) {
                (selectedLayerRef.current as L.GeoJSON).setStyle(defaultStyle((selectedLayerRef.current as unknown as { feature: GeoJSON.Feature }).feature))
              }
              // Highlight clicked region
              if (selectedLayerRef.current === layer) {
                (layer as L.GeoJSON).setStyle(defaultStyle(feature))
                selectedLayerRef.current = null
              } else {
                (layer as L.GeoJSON).setStyle({
                  weight: 2.5,
                  color: colorMode === 'light' ? '#1a73e8' : '#ffffff',
                  fillOpacity: 0.9,
                })
                if (!(layer instanceof L.Marker)) {
                  (layer as L.Path).bringToFront()
                }
                selectedLayerRef.current = layer
              }
            })
          },
        })

        builtLayers.push(geoLayer)
        builtBounds = geoLayer.getBounds()

        // Add value labels at region centroids
        const labelLayers: L.Marker[] = []
        geoLayer.eachLayer((layer) => {
          const geoJsonLayer = layer as L.GeoJSON & { feature: GeoJSON.Feature }
          const name = String(geoJsonLayer.feature?.properties?.name ?? '').toLowerCase()
          const val = valueMap.get(name)
          if (val === undefined) return

          // Compute polygon centroid using the signed-area formula
          const center = (() => {
            const geom = geoJsonLayer.feature.geometry as unknown as { type: string; coordinates: number[][][] | number[][][][] }
            // Collect outer rings: Polygon → [ring], MultiPolygon → [ring, ring, ...]
            const rings: number[][][] =
              geom.type === 'MultiPolygon'
                ? (geom.coordinates as number[][][][]).map(poly => poly[0])
                : geom.type === 'Polygon'
                  ? [geom.coordinates[0] as number[][]]
                  : []

            // Find the ring with the largest absolute area (main landmass)
            let bestRing = rings[0]
            let bestArea = 0
            for (const ring of rings) {
              let a = 0
              for (let i = 0; i < ring.length - 1; i++) {
                a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
              }
              if (Math.abs(a) > Math.abs(bestArea)) { bestArea = a; bestRing = ring }
            }

            if (!bestRing || bestRing.length < 3) return (layer as L.Polygon).getBounds().getCenter()

            // Signed-area centroid of the largest ring
            let cx = 0, cy = 0, a = 0
            for (let i = 0; i < bestRing.length - 1; i++) {
              const [x0, y0] = bestRing[i]
              const [x1, y1] = bestRing[i + 1]
              const cross = x0 * y1 - x1 * y0
              a += cross
              cx += (x0 + x1) * cross
              cy += (y0 + y1) * cross
            }
            if (Math.abs(a) < 1e-10) return (layer as L.Polygon).getBounds().getCenter()
            a *= 0.5
            cx /= (6 * a)
            cy /= (6 * a)
            // GeoJSON coordinates are [lng, lat]
            return L.latLng(cy, cx)
          })()

          const colFmt = geoConfig.valueCol ? columnFormats[geoConfig.valueCol] : undefined
          const formattedVal = applyPrefixSuffix(
            formatNumber(val, colFmt?.decimalPoints ?? undefined),
            colFmt?.prefix,
            colFmt?.suffix,
          )

          const labelMarker = L.marker(center, {
            icon: L.divIcon({
              className: 'choropleth-value-label',
              html: `<span style="color:${colorMode === 'dark' ? '#fff' : '#1a1a1a'}">${formattedVal}</span>`,
              iconSize: [0, 0],
              iconAnchor: [0, 0],
            }),
            interactive: false,
          })
          labelLayers.push(labelMarker)
        })

        if (labelLayers.length > 0) {
          builtLayers.push(L.layerGroup(labelLayers))
        }
        break
      }

      case 'points': {
        if (!geoConfig.latCol || !geoConfig.lngCol) break

        // If valueCol is set, use bubble sizing; otherwise fixed-size points
        const hasBubble = !!geoConfig.valueCol
        let min = Infinity
        let max = -Infinity
        if (hasBubble) {
          for (const row of rows) {
            const val = parseGeoNumber(row[geoConfig.valueCol!])
            if (!isNaN(val)) { min = Math.min(min, val); max = Math.max(max, val) }
          }
        }

        // Color logic: auto-detect numeric vs categorical
        const hasColorCol = !!geoConfig.colorCol
        const isNumericColor = hasColorCol && rows.some((row) => !isNaN(parseGeoNumber(row[geoConfig.colorCol!])))
        let colorMin = Infinity
        let colorMax = -Infinity
        const categoricalColorMap = new Map<string, string>()
        if (hasColorCol) {
          if (isNumericColor) {
            for (const row of rows) {
              const val = parseGeoNumber(row[geoConfig.colorCol!])
              if (!isNaN(val)) { colorMin = Math.min(colorMin, val); colorMax = Math.max(colorMax, val) }
            }
          } else {
            const uniqueValues = [...new Set(rows.map(r => String(r[geoConfig.colorCol!] ?? '')))]
            uniqueValues.forEach((val, i) => {
              categoricalColorMap.set(val, COLOR_PALETTE[i % COLOR_PALETTE.length])
            })
          }
        }

        const getPointColor = (row: Record<string, unknown>): string => {
          if (!hasColorCol) return effectiveMarkerColor
          if (isNumericColor) {
            const val = parseGeoNumber(row[geoConfig.colorCol!])
            if (isNaN(val)) return effectiveMarkerColor
            return getColorScale(val, colorMin, colorMax, colorMode, geoConfig.colorScale)
          }
          return categoricalColorMap.get(String(row[geoConfig.colorCol!] ?? '')) ?? effectiveMarkerColor
        }

        const markers: L.CircleMarker[] = []
        for (const row of rows) {
          const lat = parseGeoNumber(row[geoConfig.latCol])
          const lng = parseGeoNumber(row[geoConfig.lngCol])
          if (isNaN(lat) || isNaN(lng)) continue

          const effectiveMinRadius = geoConfig.minRadius ?? 5
          const effectiveScale = geoConfig.radiusScale ?? 1
          const radius = hasBubble
            ? getRadiusScale(parseGeoNumber(row[geoConfig.valueCol!]), min, max, effectiveMinRadius, effectiveScale)
            : effectiveMinRadius * effectiveScale

          const pointColor = getPointColor(row)

          const marker = L.circleMarker([lat, lng], {
            radius,
            fillColor: pointColor,
            color: pointColor,
            weight: 1,
            fillOpacity: 0.7,
          })

          // Tooltip
          const pointTtRows: Array<{ key: string; value: string }> = []
          if (geoConfig.colorCol && row[geoConfig.colorCol] != null) {
            pointTtRows.push({ key: geoConfig.colorCol, value: String(row[geoConfig.colorCol]) })
          }
          if (geoConfig.valueCol && row[geoConfig.valueCol] != null) {
            const value = parseGeoNumber(row[geoConfig.valueCol])
            pointTtRows.push({ key: geoConfig.valueCol, value: isNaN(value) ? String(row[geoConfig.valueCol]) : value.toLocaleString() })
          }
          pointTtRows.push(...extraTooltipRows(row))
          pointTtRows.push({ key: 'Location', value: `${lat.toFixed(4)}, ${lng.toFixed(4)}` })
          marker.bindTooltip(geoTooltipHtml(pointTtRows, null, colorMode), GEO_TOOLTIP_OPTIONS)

          markers.push(marker)
        }

        if (markers.length > 0) {
          const group = L.layerGroup(markers)
          builtLayers.push(group)
          const pointBounds = L.latLngBounds(markers.map((m) => m.getLatLng()))
          builtBounds = builtBounds ? builtBounds.extend(pointBounds) : pointBounds
        }
        break
      }

      case 'lines': {
        if (!geoConfig.latCol || !geoConfig.lngCol || !geoConfig.latCol2 || !geoConfig.lngCol2) break

        const lineColor = effectiveMarkerColor
        const lineLayers: L.Layer[] = []
        const allLatLngs: L.LatLng[] = []

        for (const row of rows) {
          const lat1 = parseGeoNumber(row[geoConfig.latCol])
          const lng1 = parseGeoNumber(row[geoConfig.lngCol])
          const lat2 = parseGeoNumber(row[geoConfig.latCol2])
          const lng2 = parseGeoNumber(row[geoConfig.lngCol2])
          if (isNaN(lat1) || isNaN(lng1) || isNaN(lat2) || isNaN(lng2)) continue

          // Arc line
          const arcPoints = greatCircleArc(lat1, lng1, lat2, lng2)
          const line = L.polyline(arcPoints, {
            color: lineColor,
            weight: 2,
            opacity: 0.7,
          })
          // Line tooltip
          const lineTtRows: Array<{ key: string; value: string }> = [
            { key: 'Origin', value: `${lat1.toFixed(2)}, ${lng1.toFixed(2)}` },
            { key: 'Dest', value: `${lat2.toFixed(2)}, ${lng2.toFixed(2)}` },
            ...extraTooltipRows(row),
          ]
          const cityName = columns.find(c => c !== geoConfig.latCol && c !== geoConfig.lngCol && c !== geoConfig.latCol2 && c !== geoConfig.lngCol2)
          const header = cityName && row[cityName] != null ? String(row[cityName]) : null
          line.bindTooltip(geoTooltipHtml(lineTtRows, header, colorMode), GEO_TOOLTIP_OPTIONS)
          lineLayers.push(line)

          // Start point
          const start = L.circleMarker([lat1, lng1], {
            radius: 3,
            fillColor: lineColor,
            color: lineColor,
            weight: 1,
            fillOpacity: 0.9,
          })
          lineLayers.push(start)

          // End point
          const end = L.circleMarker([lat2, lng2], {
            radius: 3,
            fillColor: lineColor,
            color: lineColor,
            weight: 1,
            fillOpacity: 0.9,
          })
          lineLayers.push(end)

          allLatLngs.push(L.latLng(lat1, lng1), L.latLng(lat2, lng2))
        }

        if (lineLayers.length > 0) {
          const group = L.layerGroup(lineLayers)
          builtLayers.push(group)
          const lineBounds = L.latLngBounds(allLatLngs)
          builtBounds = builtBounds ? builtBounds.extend(lineBounds) : lineBounds
        }
        break
      }

      case 'heatmap': {
        if (!geoConfig.latCol || !geoConfig.lngCol) break

        const heatPoints: [number, number, number][] = []
        for (const row of rows) {
          const lat = parseGeoNumber(row[geoConfig.latCol])
          const lng = parseGeoNumber(row[geoConfig.lngCol])
          if (isNaN(lat) || isNaN(lng)) continue
          const intensityValue = geoConfig.valueCol ? parseGeoNumber(row[geoConfig.valueCol]) : 1
          const intensity = !isNaN(intensityValue) && intensityValue > 0 ? intensityValue : 1
          heatPoints.push([lat, lng, intensity])
        }

        if (heatPoints.length > 0) {
          const { points: normalizedPoints, radius, blur, maxZoom, max } = computeHeatmapOptions(heatPoints, {
            weighted: !!geoConfig.valueCol,
          })
          const heat = L.heatLayer(normalizedPoints, {
            radius,
            blur,
            maxZoom,
            max,
            minOpacity: 0.4,
            gradient: getHeatGradient(colorMode, geoConfig.colorScale),
          })
          builtLayers.push(heat)
          const heatBounds = L.latLngBounds(heatPoints.map(([lat, lng]) => [lat, lng] as [number, number]))
          builtBounds = builtBounds ? builtBounds.extend(heatBounds) : heatBounds
        }
        break
      }
    }

    return { layers: builtLayers, bounds: builtBounds }
  }, [rows, geoConfig, effectiveGeoJsonData, colorMode, hasError, tooltipCols, effectiveMarkerColor, columnFormats])

  if (hasError) {
    return <ChartError variant="info" message={constraint.error!} />
  }

  if (geoJsonError) {
    return <ChartError message={`Failed to load map: ${geoJsonError}`} />
  }

  // For choropleth, wait for GeoJSON to load
  if (geoConfig.subType === 'choropleth' && !effectiveGeoJsonData) {
    return <ChartError variant="info" message="Loading map data..." />
  }

  const mapDefaults = geoConfig.mapName
    ? MAP_DEFAULTS[geoConfig.mapName as MapName]
    : undefined

  // Pinned view overrides map defaults and fitBounds
  const pinnedCenter = geoConfig.pinnedCenter as [number, number] | undefined
  const pinnedZoom = geoConfig.pinnedZoom ?? undefined

  return (
    <LeafletMap
      ref={mapRef}
      layers={layers}
      center={pinnedCenter ?? mapDefaults?.center}
      zoom={pinnedZoom ?? mapDefaults?.zoom}
      showTiles={geoConfig.showTiles ?? false}
      colorMode={colorMode}
      fitBounds={pinnedCenter ? undefined : bounds}
      style={{ width: '100%', height: height ?? '100%', minHeight: '300px' }}
    />
  )
}
