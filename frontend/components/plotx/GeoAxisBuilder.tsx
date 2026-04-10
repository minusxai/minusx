'use client'

import { useState, useCallback, useMemo, useEffect } from 'react'
import { Box, HStack, VStack, Text, Portal, createListCollection } from '@chakra-ui/react'
import { Checkbox } from '@/components/ui/checkbox'
import { SelectRoot, SelectTrigger, SelectValueText, SelectPositioner, SelectContent, SelectItem } from '@/components/ui/select'
import {
  LuMap, LuMapPin, LuRoute, LuFlame,
  LuLayoutGrid, LuSettings2, LuChevronDown, LuChevronRight,
} from 'react-icons/lu'
import { AxisBuilder, type AxisZone } from './AxisBuilder'
import { ColorScalePicker } from './ColorScalePicker'
import { MAP_OPTIONS } from '@/lib/chart/geo-data'
import type { GeoConfig, GeoSubType } from '@/lib/types.gen'

const SUB_TYPES: Array<{ value: GeoSubType; icon: React.ElementType; label: string }> = [
  { value: 'choropleth', icon: LuMap, label: 'Choropleth' },
  { value: 'points', icon: LuMapPin, label: 'Points' },
  { value: 'lines', icon: LuRoute, label: 'Lines' },
  { value: 'heatmap', icon: LuFlame, label: 'Heatmap' },
]

const mapCollection = createListCollection({
  items: MAP_OPTIONS.map(opt => ({ label: opt.label, value: opt.value })),
})

interface GeoAxisBuilderProps {
  columns: string[]
  types: string[]
  geoConfig?: GeoConfig
  onGeoConfigChange: (config: GeoConfig) => void
  tooltipCols?: string[]
  onTooltipColsChange?: (cols: string[]) => void
}

const DEFAULT_CONFIG: GeoConfig = { subType: 'choropleth', showTiles: false, mapName: 'us-states' }

export function GeoAxisBuilder({
  columns,
  types,
  geoConfig,
  onGeoConfigChange,
  tooltipCols = [],
  onTooltipColsChange,
}: GeoAxisBuilderProps) {
  const config = geoConfig ?? DEFAULT_CONFIG

  const [activeTab, setActiveTab] = useState<'fields' | 'settings'>('fields')
  const [collapsedPanels, setCollapsedPanels] = useState<Record<string, boolean>>({
    geo: false,
  })

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
      // Choropleth requires a mapName; others keep it if already set but don't require it
      onGeoConfigChange({
        subType,
        showTiles: config.showTiles,
        mapName: subType === 'choropleth' ? (config.mapName ?? 'us-states') : config.mapName,
        colorScale: config.colorScale,
      })
    },
    [config.showTiles, config.mapName, config.colorScale, onGeoConfigChange],
  )

  const togglePanel = (key: string) => {
    setCollapsedPanels(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const renderSettingsCard = (title: string, panelKey: string, children: React.ReactNode) => {
    const collapsed = collapsedPanels[panelKey]
    return (
      <VStack
        align="stretch"
        gap={collapsed ? 0 : 2.5}
        p={3}
        bg="bg.surface"
        borderRadius="md"
        border="2px dashed"
        borderColor="border.muted"
        minW={0}
      >
        <HStack justify="space-between" align="center">
          <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em">
            {title}
          </Text>
          <button
            onClick={() => togglePanel(panelKey)}
            aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
            style={{
              color: 'var(--chakra-colors-fg-subtle)',
              background: 'transparent',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            {collapsed ? <LuChevronRight size={14} /> : <LuChevronDown size={14} />}
          </button>
        </HStack>
        {!collapsed && children}
      </VStack>
    )
  }

  // Build AxisBuilder zones based on subType
  const makeZone = useCallback(
    (label: string, field: keyof GeoConfig, emptyText: string): AxisZone => ({
      label,
      emptyText,
      items: config[field] ? [{ column: config[field] as string }] : [],
      onDrop: (col: string) => updateConfig({ [field]: col }),
      onRemove: () => updateConfig({ [field]: null }),
    }),
    [config, updateConfig],
  )

  const tooltipZone: AxisZone = useMemo(() => ({
    label: 'Tooltip',
    items: tooltipCols.filter(c => columns.includes(c)).map(col => ({ column: col })),
    emptyText: 'Drop columns for tooltip',
    onDrop: (col: string) => {
      if (!tooltipCols.includes(col)) {
        onTooltipColsChange?.([...tooltipCols, col])
      }
    },
    onRemove: (col: string) => {
      onTooltipColsChange?.(tooltipCols.filter(c => c !== col))
    },
  }), [tooltipCols, columns, onTooltipColsChange])

  const zones: AxisZone[] = useMemo(() => {
    let subTypeZones: AxisZone[]
    switch (config.subType) {
      case 'choropleth':
        subTypeZones = [
          makeZone('Region', 'regionCol', 'Drop region column'),
          makeZone('Value', 'valueCol', 'Drop value column'),
        ]
        break
      case 'points':
        subTypeZones = [
          makeZone('Latitude', 'latCol', 'Drop lat column'),
          makeZone('Longitude', 'lngCol', 'Drop lng column'),
          makeZone('Size (optional)', 'valueCol', 'Drop value for bubble sizing'),
        ]
        break
      case 'lines':
        subTypeZones = [
          makeZone('Origin Lat', 'latCol', 'Drop origin lat'),
          makeZone('Origin Lng', 'lngCol', 'Drop origin lng'),
          makeZone('Dest Lat', 'latCol2', 'Drop dest lat'),
          makeZone('Dest Lng', 'lngCol2', 'Drop dest lng'),
        ]
        break
      case 'heatmap':
        subTypeZones = [
          makeZone('Latitude', 'latCol', 'Drop lat column'),
          makeZone('Longitude', 'lngCol', 'Drop lng column'),
          makeZone('Intensity (optional)', 'valueCol', 'Drop value column'),
        ]
        break
      default:
        subTypeZones = []
    }
    return [...subTypeZones, tooltipZone]
  }, [config.subType, makeZone])

  return (
    <VStack align="stretch" gap={0}>
      {/* Map sub-type selector */}
      <Box px={3} pt={3} pb={1} bg="bg.canvas">
        <Text fontSize="2xs" fontFamily="mono" fontWeight="700" textTransform="uppercase" letterSpacing="0.05em" color="fg.subtle" mb={1.5}>
          Map Subtypes
        </Text>
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
      </Box>

      {/* Tab bar */}
      <HStack gap={2} justify="flex-start" px={3} pt={3} pb={1} bg="bg.canvas">
        {([{ key: 'fields', icon: LuLayoutGrid, label: 'Fields' }, { key: 'settings', icon: LuSettings2, label: 'Settings' }] as const).map(({ key, icon: Icon, label }) => (
          <HStack
            key={key}
            as="button"
            gap={1}
            px={2}
            py={1}
            cursor="pointer"
            bg="transparent"
            color={activeTab === key ? 'accent.teal' : 'fg.subtle'}
            borderBottom="2px solid"
            borderColor={activeTab === key ? 'accent.teal' : 'transparent'}
            _hover={{ color: 'accent.teal' }}
            transition="all 0.15s"
            onClick={() => setActiveTab(key)}
            borderRadius={0}
          >
            <Box as={Icon} fontSize="xs" />
            <Text fontSize="2xs" fontFamily="mono" fontWeight="700" textTransform="uppercase" letterSpacing="0.05em">
              {label}
            </Text>
          </HStack>
        ))}
      </HStack>

      {/* Fields tab — column drop zones */}
      {activeTab === 'fields' && (
        <AxisBuilder columns={columns} types={types} zones={zones} />
      )}

      {/* Settings tab — base map, tiles, color scale */}
      {activeTab === 'settings' && (
        <Box p={3} bg="bg.canvas" display="flex" flexDirection="column" gap={3}>
          {renderSettingsCard('Geo Settings', 'geo',
            <VStack align="stretch" gap={3}>
              <HStack gap={4} flexWrap="wrap" align="center">
                {/* Base Map checkbox + dropdown */}
                <HStack gap={2} align="center">
                  <Checkbox
                    checked={!!config.mapName}
                    onCheckedChange={(e) => {
                      updateConfig({ mapName: e.checked ? (config.mapName || 'us-states') : null })
                    }}
                    size="sm"
                  >
                    <Text fontSize="xs" color="fg.muted">Base Map</Text>
                  </Checkbox>
                  {!!config.mapName && (
                    <SelectRoot
                      collection={mapCollection}
                      value={[config.mapName]}
                      onValueChange={(e) => updateConfig({ mapName: e.value[0] || undefined })}
                      size="sm"
                      width="180px"
                    >
                      <SelectTrigger aria-label="Base map selector">
                        <SelectValueText placeholder="Select map..." />
                      </SelectTrigger>
                      <Portal>
                        <SelectPositioner>
                          <SelectContent>
                            {MAP_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} item={opt.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </SelectPositioner>
                      </Portal>
                    </SelectRoot>
                  )}
                </HStack>

                {/* Tiles toggle */}
                <Checkbox
                  checked={config.showTiles ?? false}
                  onCheckedChange={(e) => updateConfig({ showTiles: !!e.checked })}
                  size="sm"
                >
                  <Text fontSize="xs" color="fg.muted">Show Map Tiles</Text>
                </Checkbox>
              </HStack>

              {/* Color scale (choropleth only) */}
              {config.subType === 'choropleth' && (
                <ColorScalePicker
                  value={config.colorScale}
                  defaultScale="green"
                  onChange={(scale) => updateConfig({ colorScale: scale })}
                />
              )}
            </VStack>
          )}
        </Box>
      )}
    </VStack>
  )
}
