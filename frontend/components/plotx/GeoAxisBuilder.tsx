'use client'

import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { Box, HStack, VStack, Text, Portal, createListCollection } from '@chakra-ui/react'
import { Checkbox } from '@/components/ui/checkbox'
import { SelectRoot, SelectTrigger, SelectValueText, SelectPositioner, SelectContent, SelectItem } from '@/components/ui/select'
import {
  LuMap, LuMapPin, LuRoute, LuFlame,
  LuLayoutGrid, LuSettings2, LuChevronDown, LuChevronRight,
  LuCrosshair, LuX,
} from 'react-icons/lu'
import { AxisBuilder, type AxisZone } from './AxisBuilder'
import { resolveColumnType } from './AxisComponents'
import { ColorScalePicker } from './ColorScalePicker'
import { ColorPicker } from './ColorPicker'
import { MAP_OPTIONS } from '@/lib/chart/geo-data'
import type { GeoConfig, GeoSubType, ChoroplethConfig, PointsConfig, HeatmapConfig } from '@/lib/types'

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
  colorOverrides?: Record<string, string>
  onColorOverridesChange?: (overrides: Record<string, string>) => void
  getMapView?: () => { center: [number, number]; zoom: number } | null
}

const DEFAULT_CONFIG: ChoroplethConfig = { subType: 'choropleth', showTiles: false, mapName: 'us-states' }

const NUM_INPUT_STYLE = {
  width: '60px',
  padding: '2px 6px',
  fontSize: '12px',
  fontFamily: 'var(--font-jetbrains-mono)',
  background: 'var(--chakra-colors-bg-subtle)',
  color: 'var(--chakra-colors-fg-default)',
  border: '1px solid var(--chakra-colors-border-muted)',
  borderRadius: '4px',
}

/** Number input that uses local string state so the field is freely editable. Commits on blur. */
function NumInput({ value, placeholder, ariaLabel, onCommit }: {
  value: number | undefined | null
  placeholder: string
  ariaLabel: string
  onCommit: (v: number | undefined) => void
}) {
  const [local, setLocal] = useState(value != null ? String(value) : '')
  /* eslint-disable react-hooks/refs -- standard "previous value" pattern for render-time sync */
  const prevValue = useRef(value)
  if (value !== prevValue.current) {
    prevValue.current = value
    setLocal(value != null ? String(value) : '')
  }
  /* eslint-enable react-hooks/refs */

  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        const trimmed = local.trim()
        if (trimmed === '') {
          onCommit(undefined)
        } else {
          const n = Number(trimmed)
          onCommit(isNaN(n) ? undefined : n)
        }
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
      onClick={(e) => e.stopPropagation()}
      style={NUM_INPUT_STYLE}
    />
  )
}

function PointsSizeInputs({ config, onUpdate }: { config: PointsConfig; onUpdate: (partial: Record<string, unknown>) => void }) {
  return (
    <HStack gap={4} align="center" flexWrap="wrap">
      <HStack gap={2} align="center">
        <Text fontSize="xs" color="fg.muted" whiteSpace="nowrap">Min Radius</Text>
        <NumInput
          value={config.minRadius}
          placeholder="5"
          ariaLabel="Min radius"
          onCommit={(v) => onUpdate({ minRadius: v })}
        />
      </HStack>
      <HStack gap={2} align="center">
        <Text fontSize="xs" color="fg.muted" whiteSpace="nowrap">Scale</Text>
        <NumInput
          value={config.radiusScale}
          placeholder="1"
          ariaLabel="Radius scale"
          onCommit={(v) => onUpdate({ radiusScale: v })}
        />
      </HStack>
    </HStack>
  )
}

export function GeoAxisBuilder({
  columns,
  types,
  geoConfig,
  onGeoConfigChange,
  tooltipCols = [],
  onTooltipColsChange,
  colorOverrides = {},
  onColorOverridesChange,
  getMapView,
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

  const handleSubTypeChange = useCallback(
    (subType: GeoSubType) => {
      const shared = { showTiles: config.showTiles, mapName: config.mapName }
      switch (subType) {
        case 'choropleth':
          onGeoConfigChange({ subType, ...shared, mapName: shared.mapName ?? 'us-states' })
          break
        case 'points':
          onGeoConfigChange({ subType, ...shared })
          break
        case 'lines':
          onGeoConfigChange({ subType, ...shared })
          break
        case 'heatmap':
          onGeoConfigChange({ subType, ...shared })
          break
      }
    },
    [config.showTiles, config.mapName, onGeoConfigChange],
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

  /** Build a drop zone for a single column field on the current config. */
  const makeZone = useCallback(
    (label: string, fieldKey: string, emptyText: string): AxisZone => {
      const currentValue = (config as unknown as Record<string, unknown>)[fieldKey] as string | undefined
      return {
        label,
        emptyText,
        items: currentValue ? [{ column: currentValue }] : [],
        onDrop: (col: string) => onGeoConfigChange({ ...config, [fieldKey]: col } as GeoConfig),
        onRemove: () => onGeoConfigChange({ ...config, [fieldKey]: null } as GeoConfig),
      }
    },
    [config, onGeoConfigChange],
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
          makeZone('Color (optional)', 'colorCol', 'Drop column to color points'),
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
  }, [config.subType, makeZone, tooltipZone])

  /** Helper to update current config with narrowed type fields via spread. */
  const update = useCallback(
    (partial: Record<string, unknown>) => {
      onGeoConfigChange({ ...config, ...partial } as GeoConfig)
    },
    [config, onGeoConfigChange],
  )

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
        <Box p={3} bg="bg.canvas" display="flex" flexDirection="column" gap={3} position="relative" zIndex={500}>
          {renderSettingsCard('Geo Settings', 'geo',
            <VStack align="stretch" gap={3}>
              <HStack gap={4} flexWrap="wrap" align="center">
                {/* Base Map checkbox + dropdown */}
                <HStack gap={2} align="center">
                  <Checkbox
                    checked={!!config.mapName}
                    onCheckedChange={(e) => {
                      update({ mapName: e.checked ? (config.mapName || 'us-states') : null })
                    }}
                    size="sm"
                  >
                    <Text fontSize="xs" color="fg.muted">GeoJSON Map</Text>
                  </Checkbox>
                  {!!config.mapName && (
                    <SelectRoot
                      collection={mapCollection}
                      value={[config.mapName]}
                      onValueChange={(e) => update({ mapName: e.value[0] || null })}
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
                  onCheckedChange={(e) => update({ showTiles: !!e.checked })}
                  size="sm"
                >
                  <Text fontSize="xs" color="fg.muted">OpenStreetMap Tiles</Text>
                </Checkbox>
              </HStack>

              {/* Pin / Unpin view */}
              <HStack gap={2} align="center">
                {config.pinnedCenter ? (
                  <>
                    <Text fontSize="xs" color="fg.muted" fontFamily="mono">
                      Pinned: {config.pinnedCenter[0].toFixed(2)}, {config.pinnedCenter[1].toFixed(2)} z{config.pinnedZoom ?? '?'}
                    </Text>
                    <HStack
                      as="button"
                      aria-label="Unpin map view"
                      gap={1}
                      px={2}
                      py={1}
                      borderRadius="md"
                      cursor="pointer"
                      fontSize="xs"
                      fontWeight="600"
                      color="accent.danger"
                      bg="accent.danger/10"
                      _hover={{ bg: 'accent.danger/20' }}
                      onClick={() => update({ pinnedCenter: undefined, pinnedZoom: undefined })}
                    >
                      <LuX size={12} />
                      <Text fontSize="xs">Unpin</Text>
                    </HStack>
                  </>
                ) : (
                  <HStack
                    as="button"
                    aria-label="Pin current map view"
                    gap={1}
                    px={2}
                    py={1}
                    borderRadius="md"
                    cursor="pointer"
                    fontSize="xs"
                    fontWeight="600"
                    color="accent.teal"
                    bg="accent.teal/10"
                    _hover={{ bg: 'accent.teal/20' }}
                    onClick={() => {
                      const view = getMapView?.()
                      if (view) {
                        update({ pinnedCenter: view.center, pinnedZoom: view.zoom })
                      }
                    }}
                  >
                    <LuCrosshair size={12} />
                    <Text fontSize="xs">Pin Current View</Text>
                  </HStack>
                )}
              </HStack>

              {/* Color scale (choropleth, heatmap, or points with numeric colorCol) */}
              {(config.subType === 'choropleth' || config.subType === 'heatmap' || (config.subType === 'points' && !!(config as PointsConfig).colorCol && resolveColumnType((config as PointsConfig).colorCol!, columns, types) === 'number')) && (
                <ColorScalePicker
                  value={(config as ChoroplethConfig | HeatmapConfig | PointsConfig).colorScale}
                  defaultScale="green"
                  onChange={(scale) => update({ colorScale: scale })}
                />
              )}

              {/* Points sizing */}
              {config.subType === 'points' && (
                <PointsSizeInputs config={config as PointsConfig} onUpdate={update} />
              )}

              {/* Marker color (points without colorCol, & lines) */}
              {(((config.subType === 'points' && !(config as PointsConfig).colorCol) || config.subType === 'lines') && onColorOverridesChange) && (
                <Box alignSelf="flex-start">
                  <ColorPicker
                    colorOverrides={colorOverrides}
                    numSeries={1}
                    onChange={onColorOverridesChange}
                  />
                </Box>
              )}
            </VStack>
          )}
        </Box>
      )}
    </VStack>
  )
}
