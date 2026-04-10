'use client'

import { useRef, useEffect, useMemo } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { debounce } from 'lodash'

const TILE_URLS = {
  light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
}

const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'

/** Map container background matching the app theme */
const MAP_BG = {
  light: '#F5F7FA',  // bg.canvas light
  dark: '#0D1117',   // bg.canvas dark
}

interface LeafletMapProps {
  layers: L.Layer[]
  center?: [number, number]
  zoom?: number
  showTiles?: boolean
  colorMode: 'light' | 'dark'
  fitBounds?: L.LatLngBoundsExpression
  style?: React.CSSProperties
}

/**
 * Ref-based Leaflet wrapper for React 19.
 * Manages map lifecycle, resize, and tile/data layer updates.
 */
export function LeafletMap({
  layers,
  center = [20, 0],
  zoom = 2,
  showTiles = false,
  colorMode,
  fitBounds,
  style = { width: '100%', height: '100%', minHeight: '300px' },
}: LeafletMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const tileLayerRef = useRef<L.TileLayer | null>(null)
  const dataLayerGroupRef = useRef<L.LayerGroup | null>(null)

  const debouncedResize = useMemo(
    () =>
      // eslint-disable-next-line react-hooks/refs
      debounce(() => {
        mapRef.current?.invalidateSize()
      }, 100),
    [],
  )

  // Initialize map
  useEffect(() => {
    if (!containerRef.current) return

    const map = L.map(containerRef.current, {
      center,
      zoom,
      zoomControl: true,
      attributionControl: false,
    })

    mapRef.current = map
    dataLayerGroupRef.current = L.layerGroup().addTo(map)

    const resizeObserver = new ResizeObserver(() => {
      debouncedResize()
    })
    resizeObserver.observe(containerRef.current)

    const currentContainer = containerRef.current
    return () => {
      resizeObserver.unobserve(currentContainer)
      resizeObserver.disconnect()
      map.remove()
      mapRef.current = null
      tileLayerRef.current = null
      dataLayerGroupRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Update tile layer
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Remove existing tile layer
    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current)
      tileLayerRef.current = null
    }

    if (showTiles) {
      tileLayerRef.current = L.tileLayer(TILE_URLS[colorMode], {
        attribution: TILE_ATTRIBUTION,
        maxZoom: 19,
      }).addTo(map)
    }
  }, [showTiles, colorMode])

  // Update data layers
  useEffect(() => {
    const group = dataLayerGroupRef.current
    if (!group) return

    group.clearLayers()
    for (const layer of layers) {
      group.addLayer(layer)
    }
  }, [layers])

  // Fit bounds when provided
  useEffect(() => {
    const map = mapRef.current
    if (!map || !fitBounds) return

    try {
      map.fitBounds(fitBounds, { padding: [20, 20], maxZoom: 10 })
    } catch {
      // fitBounds can throw if bounds are invalid (empty data)
    }
  }, [fitBounds])

  return (
    <>
      <style>{`
        .geo-tooltip-custom {
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
          padding: 0 !important;
        }
        .geo-tooltip-custom::before {
          display: none !important;
        }
      `}</style>
      <div ref={containerRef} style={{ ...style, background: MAP_BG[colorMode] }} />
    </>
  )
}
