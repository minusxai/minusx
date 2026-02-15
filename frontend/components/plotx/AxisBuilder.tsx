'use client'

import { useState, useCallback, useMemo } from 'react'
import { Box, HStack, Text } from '@chakra-ui/react'
import { ColumnChip, DropZone, ZoneChip, resolveColumnType, useIsTouchDevice } from './AxisComponents'
import type { ColumnFormatConfig } from '@/lib/types'

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
}

export const AxisBuilder = ({ columns, types, zones, columnFormats, onColumnFormatChange, children }: AxisBuilderProps) => {
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

  return (
    <Box display="flex" flexDirection="column" gap={3} width="100%" p={3} bg="bg.canvas" borderBottom="1px solid" borderColor="border.muted">
      {/* Column palette */}
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
        {zones.map(zone => (
          <DropZone key={zone.label} label={zone.label} onDrop={() => handleZoneDrop(zone)} isTouchDevice={isTouchDevice}>
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
        ))}
      </Box>

      {children}
    </Box>
  )
}
