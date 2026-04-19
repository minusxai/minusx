'use client'

import { useState, useCallback } from 'react'
import { Box, HStack, VStack, Text } from '@chakra-ui/react'
import { ColumnChip, DropZone, ZoneChip, resolveColumnType, useIsTouchDevice } from './AxisComponents'
import type { ColumnFormatConfig, TrendConfig, TrendCompareMode } from '@/lib/types'

interface TrendAxisBuilderProps {
  columns: string[]
  types: string[]
  xAxisColumns: string[]
  yAxisColumns: string[]
  onAxisChange: (xCols: string[], yCols: string[]) => void
  columnFormats?: Record<string, ColumnFormatConfig>
  onColumnFormatChange?: (column: string, config: ColumnFormatConfig) => void
  trendConfig?: TrendConfig
  onTrendConfigChange?: (config: TrendConfig) => void
}

const COMPARE_OPTIONS: { value: TrendCompareMode; label: string }[] = [
  { value: 'last', label: 'Latest vs Previous' },
  { value: 'previous', label: 'Previous vs Before (skip latest)' },
]

export const TrendAxisBuilder = ({
  columns, types, xAxisColumns, yAxisColumns, onAxisChange,
  columnFormats, onColumnFormatChange, trendConfig, onTrendConfigChange,
}: TrendAxisBuilderProps) => {
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null)
  const isTouchDevice = useIsTouchDevice()
  const [selectedColumnForMobile, setSelectedColumnForMobile] = useState<string | null>(null)

  const assignedColumns = new Set([...xAxisColumns, ...yAxisColumns])
  const compareMode = trendConfig?.compareMode ?? 'last'

  const handleDragStart = useCallback((e: React.DragEvent, col: string) => {
    setDraggedColumn(col)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', col)
  }, [])

  const handleDragEnd = useCallback(() => { setDraggedColumn(null) }, [])

  const handleXDrop = useCallback((col: string) => {
    if (!xAxisColumns.includes(col)) onAxisChange([...xAxisColumns, col], yAxisColumns)
  }, [xAxisColumns, yAxisColumns, onAxisChange])

  const handleYDrop = useCallback((col: string) => {
    if (!yAxisColumns.includes(col)) onAxisChange(xAxisColumns, [...yAxisColumns, col])
  }, [xAxisColumns, yAxisColumns, onAxisChange])

  const handleXRemove = useCallback((col: string) => {
    onAxisChange(xAxisColumns.filter(c => c !== col), yAxisColumns)
  }, [xAxisColumns, yAxisColumns, onAxisChange])

  const handleYRemove = useCallback((col: string) => {
    onAxisChange(xAxisColumns, yAxisColumns.filter(c => c !== col))
  }, [xAxisColumns, yAxisColumns, onAxisChange])

  return (
    <Box display="flex" flexDirection="column" gap={4} width="100%" p={3} bg="bg.canvas" border="1px dashed" borderColor="border.muted" borderRadius="md">
      {/* Column chips */}
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
            onMobileSelect={() => setSelectedColumnForMobile(prev => prev === col ? null : col)}
          />
        ))}
      </HStack>

      {/* Drop zones */}
      <Box display="flex" gap={3} alignItems="stretch" minWidth={0}>
        <Box minW={0} flex={1} display="flex" alignItems="stretch">
          <DropZone
            label="Time Axis"
            onDrop={() => {
              const col = draggedColumn || selectedColumnForMobile
              if (col) handleXDrop(col)
              setDraggedColumn(null)
              setSelectedColumnForMobile(null)
            }}
            isTouchDevice={isTouchDevice}
          >
            <HStack gap={1.5} flexWrap="wrap" minW={0} width="100%">
              {xAxisColumns.map(col => (
                <ZoneChip
                  key={col}
                  column={col}
                  type={resolveColumnType(col, columns, types)}
                  onRemove={() => handleXRemove(col)}
                  formatConfig={columnFormats?.[col]}
                  onFormatChange={onColumnFormatChange ? (config) => onColumnFormatChange(col, config) : undefined}
                />
              ))}
            </HStack>
            {xAxisColumns.length === 0 && (
              <Text fontSize="xs" color="fg.subtle" fontStyle="italic">Drop a date/time column</Text>
            )}
          </DropZone>
        </Box>
        <Box minW={0} flex={2} display="flex" alignItems="stretch">
          <DropZone
            label="Metrics"
            onDrop={() => {
              const col = draggedColumn || selectedColumnForMobile
              if (col) handleYDrop(col)
              setDraggedColumn(null)
              setSelectedColumnForMobile(null)
            }}
            isTouchDevice={isTouchDevice}
          >
            <HStack gap={1.5} flexWrap="wrap" minW={0} width="100%">
              {yAxisColumns.map(col => (
                <ZoneChip
                  key={col}
                  column={col}
                  type={resolveColumnType(col, columns, types)}
                  onRemove={() => handleYRemove(col)}
                  formatConfig={columnFormats?.[col]}
                  onFormatChange={onColumnFormatChange ? (config) => onColumnFormatChange(col, config) : undefined}
                />
              ))}
            </HStack>
            {yAxisColumns.length === 0 && (
              <Text fontSize="xs" color="fg.subtle" fontStyle="italic">Drop metric columns</Text>
            )}
          </DropZone>
        </Box>
      </Box>

      {/* Comparison mode */}
      {onTrendConfigChange && (
        <HStack gap={3} align="center">
          <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em" fontFamily="mono">
            Compare
          </Text>
          <HStack gap={1}>
            {COMPARE_OPTIONS.map(opt => (
              <Box
                key={opt.value}
                as="button"
                px={2}
                py={1}
                fontSize="xs"
                fontFamily="mono"
                fontWeight={compareMode === opt.value ? '700' : '500'}
                bg={compareMode === opt.value ? 'accent.teal' : 'transparent'}
                color={compareMode === opt.value ? 'white' : 'fg.subtle'}
                borderRadius="md"
                cursor="pointer"
                _hover={{ bg: compareMode === opt.value ? 'accent.teal' : 'bg.muted' }}
                transition="all 0.15s"
                onClick={() => onTrendConfigChange({ ...trendConfig, compareMode: opt.value })}
              >
                {opt.label}
              </Box>
            ))}
          </HStack>
        </HStack>
      )}
    </Box>
  )
}
