'use client'

import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { Box, HStack, VStack, Text } from '@chakra-ui/react'
import { LuSettings2 } from 'react-icons/lu'
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
  axisConfig?: AxisConfig
  onAxisConfigChange?: (config: AxisConfig) => void
  chartType?: string
}

// Popover for axis settings (scale + min/max)
const AxisSettingsPopover = ({ axis, axisConfig, onChange }: {
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
    <VStack align="stretch" gap={2.5} p={2.5} minW="160px">
      {/* Scale */}
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

      {/* Min / Max */}
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

// Settings icon + popover for a drop zone
const ZoneSettings = ({ axis, axisConfig, onChange }: {
  axis: 'x' | 'y'
  axisConfig: AxisConfig
  onChange: (config: AxisConfig) => void
}) => {
  const [showPopover, setShowPopover] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLDivElement>(null)

  const scaleKey = axis === 'x' ? 'xScale' : 'yScale'
  const minKey = axis === 'x' ? 'xMin' : 'yMin'
  const maxKey = axis === 'x' ? 'xMax' : 'yMax'
  const hasConfig = (axisConfig[scaleKey] && axisConfig[scaleKey] !== 'linear')
    || axisConfig[minKey] != null || axisConfig[maxKey] != null

  useEffect(() => {
    if (!showPopover) return
    const handler = (e: MouseEvent) => {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setShowPopover(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showPopover])

  return (
    <Box position="relative" display="inline-flex" ref={buttonRef}>
      <Box
        as="button"
        onClick={(e: React.MouseEvent) => { e.stopPropagation(); setShowPopover(!showPopover) }}
        color={hasConfig ? 'accent.teal' : 'fg.subtle'}
        _hover={{ color: 'accent.teal' }}
        transition="color 0.2s"
        aria-label={`${axis.toUpperCase()} axis settings`}
      >
        <LuSettings2 size={11} />
      </Box>
      {showPopover && (
        <Box
          ref={popoverRef}
          position="absolute"
          top="100%"
          left={0}
          mt={1}
          bg="bg.panel"
          border="1px solid"
          borderColor="border.muted"
          borderRadius="md"
          boxShadow="md"
          zIndex={20}
        >
          <AxisSettingsPopover axis={axis} axisConfig={axisConfig} onChange={onChange} />
        </Box>
      )}
    </Box>
  )
}

export const AxisBuilder = ({ columns, types, zones, columnFormats, onColumnFormatChange, children, axisConfig, onAxisConfigChange, chartType }: AxisBuilderProps) => {
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null)
  const [selectedColumnForMobile, setSelectedColumnForMobile] = useState<string | null>(null)
  const isTouchDevice = useIsTouchDevice()

  // Compute assigned columns from all zones
  const assignedColumns = useMemo(() => {
    const set = new Set<string>()
    zones.forEach(zone => zone.items.forEach(item => set.add(item.column)))
    return set
  }, [zones])

  const handleDragStart = useCallback((e: React.DragEvent, column: string) => {
    setDraggedColumn(column)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', column)
  }, [])

  const handleDragEnd = useCallback(() => {
    setDraggedColumn(null)
  }, [])

  const handleMobileSelect = useCallback((column: string) => {
    setSelectedColumnForMobile(prev => prev === column ? null : column)
  }, [])

  const handleZoneDrop = useCallback((zone: AxisZone) => {
    const col = draggedColumn || selectedColumnForMobile
    if (col) {
      zone.onDrop(col)
    }
    setDraggedColumn(null)
    setSelectedColumnForMobile(null)
  }, [draggedColumn, selectedColumnForMobile])

  // Determine which zones get axis settings (X axis for scatter only, Y axis always)
  const getZoneAxis = (label: string): 'x' | 'y' | null => {
    if (label === 'X Axis' && chartType === 'scatter') return 'x'
    if (label === 'Y Axis') return 'y'
    return null
  }

  return (
    <Box display="flex" flexDirection="column" gap={3} width="100%" p={3} bg="bg.canvas" borderBottom="1px solid" borderColor="border.muted">
      {/* Column palette */}
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

      {/* Mobile instruction */}
      {isTouchDevice && selectedColumnForMobile && (
        <Box p={2} bg="accent.teal/10" borderRadius="md" textAlign="center">
          <Text fontSize="xs" fontWeight="600" color="accent.teal">
            Tap a zone below to add &quot;{selectedColumnForMobile}&quot;
          </Text>
        </Box>
      )}

      {/* Drop zones */}
      <Box display="flex" flexDirection="row" gap={3}>
        {zones.map(zone => {
          const axis = getZoneAxis(zone.label)
          return (
            <DropZone
              key={zone.label}
              label={zone.label}
              onDrop={() => handleZoneDrop(zone)}
              isTouchDevice={isTouchDevice}
              labelExtra={axis && onAxisConfigChange ? (
                <ZoneSettings axis={axis} axisConfig={axisConfig ?? {}} onChange={onAxisConfigChange} />
              ) : undefined}
            >
              <HStack gap={1.5} flexWrap="wrap">
                {zone.items.map(item => (
                  <ZoneChip
                    key={item.column}
                    column={item.column}
                    type={resolveColumnType(item.column, columns, types)}
                    onRemove={() => zone.onRemove(item.column)}
                    extra={item.extra}
                    formatConfig={columnFormats?.[item.column]}
                    onFormatChange={onColumnFormatChange ? (config) => onColumnFormatChange(item.column, config) : undefined}
                  />
                ))}
              </HStack>
              {zone.items.length === 0 && (
                <Text fontSize="xs" color="fg.subtle" fontStyle="italic">{zone.emptyText || 'Drop columns here'}</Text>
              )}
            </DropZone>
          )
        })}
      </Box>

    </Box>
  )
}
