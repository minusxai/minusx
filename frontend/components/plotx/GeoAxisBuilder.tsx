'use client'

import { useCallback, useMemo, useEffect } from 'react'
import { Box, HStack, VStack, Text } from '@chakra-ui/react'
import { Checkbox } from '@/components/ui/checkbox'
import {
  LuMap, LuMapPin, LuCircleDot, LuRoute, LuFlame,
} from 'react-icons/lu'
import { AxisBuilder, type AxisZone } from './AxisBuilder'
import { MAP_OPTIONS } from '@/lib/chart/geo-data'
import type { GeoConfig, GeoSubType } from '@/lib/types.gen'

const SUB_TYPES: Array<{ value: GeoSubType; icon: React.ElementType; label: string }> = [
  { value: 'choropleth', icon: LuMap, label: 'Choropleth' },
  { value: 'points', icon: LuMapPin, label: 'Points' },
  { value: 'bubble', icon: LuCircleDot, label: 'Bubble' },
  { value: 'lines', icon: LuRoute, label: 'Lines' },
  { value: 'heatmap', icon: LuFlame, label: 'Heatmap' },
]

interface GeoAxisBuilderProps {
  columns: string[]
  types: string[]
  geoConfig?: GeoConfig
  onGeoConfigChange: (config: GeoConfig) => void
}

const DEFAULT_CONFIG: GeoConfig = { subType: 'choropleth', showTiles: false }

export function GeoAxisBuilder({
  columns,
  types,
  geoConfig,
  onGeoConfigChange,
}: GeoAxisBuilderProps) {
  const config = geoConfig ?? DEFAULT_CONFIG

  // Auto-fire initial config
  useEffect(() => {
    if (!geoConfig) {
      onGeoConfigChange(DEFAULT_CONFIG)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const updateConfig = useCallback(
    (partial: Partial<GeoConfig>) => {
      onGeoConfigChange({ ...config, ...partial })
    },
    [config, onGeoConfigChange],
  )

  const handleSubTypeChange = useCallback(
    (subType: GeoSubType) => {
      // Reset column assignments when switching sub-type
      onGeoConfigChange({
        subType,
        showTiles: config.showTiles,
        mapName: subType === 'choropleth' ? (config.mapName ?? 'us-states') : undefined,
      })
    },
    [config.showTiles, config.mapName, onGeoConfigChange],
  )

  // Build AxisBuilder zones based on subType
  const makeZone = useCallback(
    (label: string, field: keyof GeoConfig, emptyText: string): AxisZone => ({
      label,
      emptyText,
      items: config[field] ? [{ column: config[field] as string }] : [],
      onDrop: (col: string) => updateConfig({ [field]: col }),
      onRemove: () => updateConfig({ [field]: undefined }),
    }),
    [config, updateConfig],
  )

  const zones: AxisZone[] = useMemo(() => {
    switch (config.subType) {
      case 'choropleth':
        return [
          makeZone('Region', 'regionCol', 'Drop region column'),
          makeZone('Value', 'valueCol', 'Drop value column'),
        ]
      case 'points':
        return [
          makeZone('Latitude', 'latCol', 'Drop lat column'),
          makeZone('Longitude', 'lngCol', 'Drop lng column'),
        ]
      case 'bubble':
        return [
          makeZone('Latitude', 'latCol', 'Drop lat column'),
          makeZone('Longitude', 'lngCol', 'Drop lng column'),
          makeZone('Value', 'valueCol', 'Drop value column'),
        ]
      case 'lines':
        return [
          makeZone('Origin Lat', 'latCol', 'Drop origin lat'),
          makeZone('Origin Lng', 'lngCol', 'Drop origin lng'),
          makeZone('Dest Lat', 'latCol2', 'Drop dest lat'),
          makeZone('Dest Lng', 'lngCol2', 'Drop dest lng'),
        ]
      case 'heatmap':
        return [
          makeZone('Latitude', 'latCol', 'Drop lat column'),
          makeZone('Longitude', 'lngCol', 'Drop lng column'),
          makeZone('Intensity', 'valueCol', 'Drop value (optional)'),
        ]
      default:
        return []
    }
  }, [config.subType, makeZone])

  return (
    <VStack align="stretch" gap={0}>
      {/* Sub-type selector + geo controls */}
      <Box px={3} py={2} borderBottom="1px solid" borderColor="border.muted" bg="bg.muted">
        <VStack align="stretch" gap={2}>
          {/* Sub-type tabs */}
          <HStack gap={1} flexWrap="wrap">
            {SUB_TYPES.map(({ value, icon: Icon, label }) => {
              const isActive = config.subType === value
              return (
                <HStack
                  key={value}
                  aria-label={`Geo sub-type ${label}`}
                  gap={1}
                  px={2}
                  py={1}
                  borderRadius="md"
                  cursor="pointer"
                  bg={isActive ? 'accent.teal/15' : 'transparent'}
                  color={isActive ? 'accent.teal' : 'fg.muted'}
                  _hover={{ bg: isActive ? 'accent.teal/20' : 'bg.subtle' }}
                  transition="all 0.15s"
                  onClick={() => handleSubTypeChange(value)}
                >
                  <Icon size={14} />
                  <Text fontSize="xs" fontWeight={isActive ? '700' : '500'}>{label}</Text>
                </HStack>
              )
            })}
          </HStack>

          {/* Map selector (choropleth only) */}
          {config.subType === 'choropleth' && (
            <HStack gap={2}>
              <Text fontSize="xs" fontWeight="600" color="fg.muted" whiteSpace="nowrap">Base Map</Text>
              <select
                aria-label="Base map selector"
                value={config.mapName ?? ''}
                onChange={(e) => updateConfig({ mapName: e.target.value || undefined })}
                style={{
                  fontSize: '12px',
                  padding: '4px 8px',
                  borderRadius: '6px',
                  border: '1px solid var(--chakra-colors-border-muted)',
                  background: 'var(--chakra-colors-bg-panel)',
                  color: 'var(--chakra-colors-fg-default)',
                }}
              >
                <option value="">Select map...</option>
                {MAP_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </HStack>
          )}

          {/* Tiles toggle */}
          <Checkbox
            checked={config.showTiles ?? false}
            onCheckedChange={(e) => updateConfig({ showTiles: !!e.checked })}
            size="sm"
          >
            <Text fontSize="xs" color="fg.muted">Show Tiles</Text>
          </Checkbox>
        </VStack>
      </Box>

      {/* Column palette + drop zones (reuse AxisBuilder) */}
      <AxisBuilder
        columns={columns}
        types={types}
        zones={zones}
      />
    </VStack>
  )
}
