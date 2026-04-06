'use client'

import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { Box, HStack, VStack, Text, Switch } from '@chakra-ui/react'
import { LuChevronDown, LuChevronRight } from 'react-icons/lu'
import { ColumnChip, DropZone, ZoneChip, resolveColumnType, useIsTouchDevice } from './AxisComponents'
import type { ColumnFormatConfig, AxisConfig } from '@/lib/types'

export interface AxisZone {
  label: string
  items: Array<{ column: string; extra?: React.ReactNode }>
  emptyText?: string
  onDrop: (column: string) => void
  onRemove: (column: string) => void
}

interface AxisBuilderProps {
  columns: string[]
  types: string[]
  zones: AxisZone[]
  columnFormats?: Record<string, ColumnFormatConfig>
  onColumnFormatChange?: (column: string, config: ColumnFormatConfig) => void
  children?: React.ReactNode
  stylePanel?: React.ReactNode
  annotationPanel?: React.ReactNode
  axisConfig?: AxisConfig
  onAxisConfigChange?: (config: AxisConfig) => void
  chartType?: string
}

const AxisSettingsPanel = ({ axis, axisConfig, onChange }: {
  axis: 'x' | 'y'
  axisConfig: AxisConfig
  onChange: (config: AxisConfig) => void
}) => {
  const scaleKey = axis === 'x' ? 'xScale' : 'yScale'
  const minKey = axis === 'x' ? 'xMin' : 'yMin'
  const maxKey = axis === 'x' ? 'xMax' : 'yMax'
  const currentScale = axisConfig[scaleKey] ?? 'linear'
  const currentMin = axisConfig[minKey]
  const currentMax = axisConfig[maxKey]
  const currentTitle = axis === 'y' ? axisConfig.yTitle ?? '' : ''

  const inputStyle = {
    fontSize: '12px',
    fontFamily: 'var(--fonts-mono, monospace)',
    padding: '4px 8px',
    width: '100%',
    border: '1px solid var(--colors-border-muted, #333)',
    borderRadius: '4px',
    background: 'var(--colors-bg-surface, transparent)',
    color: 'var(--colors-fg-default, inherit)',
    outline: 'none',
  }

  return (
    <VStack align="stretch" gap={2.5} minW={0}>
      {axis === 'y' && (
        <HStack gap={2} align="center">
          <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em">
            Dual Y-axis
          </Text>
          <Switch.Root
            size="sm"
            checked={!!axisConfig.dualAxis}
            onCheckedChange={(e) => { onChange({ ...axisConfig, dualAxis: e.checked || null }) }}
            colorPalette="teal"
          >
            <Switch.HiddenInput aria-label="Dual Y-axis toggle" />
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Root>
        </HStack>
      )}
      {axis === 'y' && (
        <Box>
          <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em" mb={1}>
            Title
          </Text>
          <input
            type="text"
            placeholder="auto"
            value={currentTitle}
            onChange={(e) => {
              const value = e.target.value
              onChange({ ...axisConfig, yTitle: value || null })
            }}
            onClick={(e) => e.stopPropagation()}
            style={inputStyle}
          />
        </Box>
      )}
      <Box>
        <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em" mb={1}>
          Scale
        </Text>
        <HStack gap={1}>
          {(['linear', 'log'] as const).map(scale => (
            <Box
              key={scale}
              px={2} py={0.5}
              borderRadius="sm"
              cursor="pointer"
              fontSize="xs"
              fontFamily="mono"
              fontWeight={currentScale === scale ? '700' : '500'}
              bg={currentScale === scale ? 'accent.teal' : 'bg.surface'}
              color={currentScale === scale ? 'white' : 'fg.default'}
              border="1px solid"
              borderColor={currentScale === scale ? 'accent.teal' : 'border.muted'}
              _hover={{ bg: currentScale === scale ? 'accent.teal' : 'bg.muted' }}
              onClick={(e) => { e.stopPropagation(); onChange({ ...axisConfig, [scaleKey]: scale }) }}
              transition="all 0.15s"
              textAlign="center"
              aria-label={`${axis.toUpperCase()} axis ${scale} scale`}
            >
              {scale}
            </Box>
          ))}
        </HStack>
      </Box>
      <HStack gap={2}>
        <Box flex={1}>
          <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em" mb={1}>
            Min
          </Text>
          <input
            type="number"
            placeholder="auto"
            value={currentMin ?? ''}
            onChange={(e) => {
              const val = e.target.value === '' ? undefined : Number(e.target.value)
              onChange({ ...axisConfig, [minKey]: val ?? null })
            }}
            onClick={(e) => e.stopPropagation()}
            style={inputStyle}
          />
        </Box>
        <Box flex={1}>
          <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em" mb={1}>
            Max
          </Text>
          <input
            type="number"
            placeholder="auto"
            value={currentMax ?? ''}
            onChange={(e) => {
              const val = e.target.value === '' ? undefined : Number(e.target.value)
              onChange({ ...axisConfig, [maxKey]: val ?? null })
            }}
            onClick={(e) => e.stopPropagation()}
            style={inputStyle}
          />
        </Box>
      </HStack>
    </VStack>
  )
}

export const AxisBuilder = ({ columns, types, zones, columnFormats, onColumnFormatChange, children, stylePanel, annotationPanel, axisConfig, onAxisConfigChange, chartType }: AxisBuilderProps) => {
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null)
  const [dragSourceZone, setDragSourceZone] = useState<AxisZone | null>(null)
  const [selectedColumnForMobile, setSelectedColumnForMobile] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'fields' | 'settings'>('fields')
  const [collapsedPanels, setCollapsedPanels] = useState<Record<string, boolean>>({
    xAxis: false,
    yAxis: false,
    style: false,
    annotations: false,
  })
  const isTouchDevice = useIsTouchDevice()
  // Track whether a drop landed on a zone (set in onDrop, read in onDragEnd)
  const dropLandedRef = useRef(false)
  // Track pending source removal (deferred to onDragEnd so fresh zone closures are used)
  const pendingRemoveRef = useRef<{ column: string; zoneLabel: string } | null>(null)
  // Keep a ref to the latest zones so deferred removal can use fresh closures
  const zonesRef = useRef(zones)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { zonesRef.current = zones }, [zones])

  // Compute assigned columns from all zones
  const assignedColumns = useMemo(() => {
    const set = new Set<string>()
    zones.forEach(zone => zone.items.forEach(item => set.add(item.column)))
    return set
  }, [zones])

  const handleDragStart = useCallback((e: React.DragEvent, column: string) => {
    setDraggedColumn(column)
    dropLandedRef.current = false
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', column)
  }, [])

  const handleDragEnd = useCallback(() => {
    // If dragged from a zone and drop did NOT land on any zone → remove (drag outside)
    if (dragSourceZone && draggedColumn && !dropLandedRef.current) {
      dragSourceZone.onRemove(draggedColumn)
    }
    // If a zone-to-zone move is pending, defer source removal to after React
    // re-renders with the onDrop state, so zonesRef has fresh closures
    if (pendingRemoveRef.current) {
      requestAnimationFrame(() => {
        if (pendingRemoveRef.current) {
          const { column, zoneLabel } = pendingRemoveRef.current
          const freshZone = zonesRef.current.find(z => z.label === zoneLabel)
          freshZone?.onRemove(column)
          pendingRemoveRef.current = null
        }
      })
    }
    setDraggedColumn(null)
    setDragSourceZone(null)
    dropLandedRef.current = false
  }, [dragSourceZone, draggedColumn])

  const handleZoneChipDragStart = useCallback((e: React.DragEvent, column: string, sourceZone: AxisZone) => {
    setDraggedColumn(column)
    setDragSourceZone(sourceZone)
    dropLandedRef.current = false
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', column)
  }, [])

  const handleMobileSelect = useCallback((column: string) => {
    setSelectedColumnForMobile(prev => prev === column ? null : column)
  }, [])

  const handleZoneDrop = useCallback((zone: AxisZone) => {
    const col = draggedColumn || selectedColumnForMobile
    if (col) {
      dropLandedRef.current = true
      zone.onDrop(col)
      // Defer source removal to handleDragEnd so it uses fresh zone closures
      // (avoids stale state when source.onRemove and target.onDrop share a state setter)
      if (dragSourceZone && dragSourceZone.label !== zone.label) {
        pendingRemoveRef.current = { column: col, zoneLabel: dragSourceZone.label }
      }
    }
    setDraggedColumn(null)
    setSelectedColumnForMobile(null)
  }, [draggedColumn, selectedColumnForMobile, dragSourceZone])

  const showXAxisSettings = chartType === 'scatter' && !!onAxisConfigChange
  const showYAxisSettings = !!onAxisConfigChange
  const hasSettingsTab = showXAxisSettings || showYAxisSettings || !!stylePanel || !!annotationPanel

  const tabButtonStyles = {
    px: 2.5,
    py: 1,
    borderRadius: 'md',
    fontSize: '2xs',
    fontFamily: 'mono',
    fontWeight: '700',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    border: '1px solid',
    transition: 'all 0.15s',
  }

  const togglePanel = (key: 'xAxis' | 'yAxis' | 'style' | 'annotations') => {
    setCollapsedPanels(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const renderSettingsCard = (title: string, panelKey: 'xAxis' | 'yAxis' | 'style' | 'annotations', children: React.ReactNode) => {
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

  return (
    <Box display="flex" flexDirection="column" gap={4} width="100%" p={3} bg="bg.canvas" borderBottom="1px solid" borderColor="border.muted">
      <HStack gap={2} flexWrap="wrap" justifyContent="space-between">
        <HStack gap={2} flexWrap="wrap">
          {columns.map(col => (
            <ColumnChip
              key={col}
              column={col}
              type={resolveColumnType(col, columns, types)}
              isAssigned={assignedColumns.has(col)}
              isDragging={draggedColumn === col}
              isMobileSelected={selectedColumnForMobile === col}
              isTouchDevice={isTouchDevice}
              onDragStart={(e) => handleDragStart(e, col)}
              onDragEnd={handleDragEnd}
              onMobileSelect={() => handleMobileSelect(col)}
            />
          ))}
        </HStack>
        {children}
      </HStack>

      {isTouchDevice && selectedColumnForMobile && (
        <Box p={2} bg="accent.teal/10" borderRadius="md" textAlign="center">
          <Text fontSize="xs" fontWeight="600" color="accent.teal">
            Tap a zone below to add &quot;{selectedColumnForMobile}&quot;
          </Text>
        </Box>
      )}

      {hasSettingsTab && (
        <HStack gap={2} justify="flex-end">
          <Box
            as="button"
            {...tabButtonStyles}
            bg={activeTab === 'fields' ? 'accent.teal' : 'bg.surface'}
            color={activeTab === 'fields' ? 'white' : 'fg.subtle'}
            borderColor={activeTab === 'fields' ? 'accent.teal' : 'border.muted'}
            onClick={() => setActiveTab('fields')}
          >
            Fields
          </Box>
          <Box
            as="button"
            {...tabButtonStyles}
            bg={activeTab === 'settings' ? 'accent.teal' : 'bg.surface'}
            color={activeTab === 'settings' ? 'white' : 'fg.subtle'}
            borderColor={activeTab === 'settings' ? 'accent.teal' : 'border.muted'}
            onClick={() => setActiveTab('settings')}
          >
            Settings
          </Box>
        </HStack>
      )}

      {(!hasSettingsTab || activeTab === 'fields') && (
        <Box display="flex" gap={3} alignItems="stretch" minWidth={0}>
          {zones.map(zone => {
            const zoneFlex = zone.label === 'X Axis' || zone.label === 'Y Axis' ? 2 : 1
            return (
              <Box key={zone.label} minW={0} flex={zoneFlex} display="flex" alignItems="stretch">
                <DropZone
                  label={zone.label}
                  onDrop={() => handleZoneDrop(zone)}
                  isTouchDevice={isTouchDevice}
                >
                  <HStack gap={1.5} flexWrap="wrap" minW={0} width="100%">
                    {zone.items.map(item => (
                      <ZoneChip
                        key={item.column}
                        column={item.column}
                        type={resolveColumnType(item.column, columns, types)}
                        onRemove={() => zone.onRemove(item.column)}
                        extra={item.extra}
                        formatConfig={columnFormats?.[item.column]}
                        onFormatChange={onColumnFormatChange ? (config) => onColumnFormatChange(item.column, config) : undefined}
                        onDragStart={(e) => handleZoneChipDragStart(e, item.column, zone)}
                        onDragEnd={handleDragEnd}
                      />
                    ))}
                  </HStack>
                  {zone.items.length === 0 && (
                    <Text
                      fontSize="xs"
                      color="fg.subtle"
                      fontStyle="italic"
                      maxWidth="100%"
                      overflow="hidden"
                      textOverflow="ellipsis"
                      whiteSpace="nowrap"
                    >
                      {zone.emptyText || 'Drop columns here'}
                    </Text>
                  )}
                </DropZone>
              </Box>
            )
          })}
        </Box>
      )}

      {hasSettingsTab && activeTab === 'settings' && (
        <Box display="grid" gridTemplateColumns="minmax(240px, 1.1fr) minmax(280px, 1fr)" gap={3} minWidth={0}>
          <VStack align="stretch" gap={3} minW={0}>
            {showXAxisSettings && onAxisConfigChange && (
              renderSettingsCard('X Axis', 'xAxis',
                <AxisSettingsPanel axis="x" axisConfig={axisConfig ?? {}} onChange={onAxisConfigChange} />
              )
            )}
            {showYAxisSettings && onAxisConfigChange && (
              renderSettingsCard('Y Axis', 'yAxis',
                <AxisSettingsPanel axis="y" axisConfig={axisConfig ?? {}} onChange={onAxisConfigChange} />
              )
            )}
          </VStack>
          <VStack align="stretch" gap={3} minW={0}>
            {stylePanel ? (
              renderSettingsCard('Style', 'style',
                stylePanel
              )
            ) : null}
            {annotationPanel ? (
              renderSettingsCard('Annotations', 'annotations',
                annotationPanel
              )
            ) : null}
          </VStack>
        </Box>
      )}

    </Box>
  )
}
