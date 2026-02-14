'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import { Box, HStack, VStack, Text } from '@chakra-ui/react'
import { Checkbox } from '@/components/ui/checkbox'
import { LuChevronDown } from 'react-icons/lu'
import { ColumnChip, DropZone, ZoneChip, resolveColumnType, useIsTouchDevice } from './AxisComponents'
import type { PivotConfig, PivotValueConfig, AggregationFunction } from '@/lib/types'

const AGG_FUNCTIONS: AggregationFunction[] = ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX']

interface PivotAxisBuilderProps {
  columns: string[]
  types: string[]
  pivotConfig?: PivotConfig
  onPivotConfigChange: (config: PivotConfig) => void
  useCompactView?: boolean
}

export const PivotAxisBuilder = ({
  columns,
  types,
  pivotConfig,
  onPivotConfigChange,
}: PivotAxisBuilderProps) => {
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null)
  const isTouchDevice = useIsTouchDevice()
  const [selectedColumnForMobile, setSelectedColumnForMobile] = useState<string | null>(null)

  // All columns with their types, in a flat list
  const allColumns = useMemo(() => {
    return columns.map(col => ({ col, type: resolveColumnType(col, columns, types) }))
  }, [columns, types])

  // Classify columns for auto-init
  const groupedColumns = useMemo(() => {
    const groups: { dates: string[]; numbers: string[]; categories: string[] } = {
      dates: [], numbers: [], categories: [],
    }
    columns.forEach((col) => {
      const type = resolveColumnType(col, columns, types)
      if (type === 'date') groups.dates.push(col)
      else if (type === 'number') groups.numbers.push(col)
      else groups.categories.push(col)
    })
    return groups
  }, [columns, types])

  // Auto-initialize when no pivotConfig
  const config: PivotConfig = useMemo(() => {
    if (pivotConfig) return pivotConfig

    const rowCols: string[] = []
    const colCols: string[] = []
    const vals: PivotValueConfig[] = []

    if (groupedColumns.dates.length > 0) {
      rowCols.push(groupedColumns.dates[0])
    } else if (groupedColumns.categories.length > 0) {
      rowCols.push(groupedColumns.categories[0])
    }

    const remainingCats = groupedColumns.categories.filter(c => !rowCols.includes(c))
    const remainingDates = groupedColumns.dates.filter(c => !rowCols.includes(c))
    if (remainingCats.length > 0) {
      colCols.push(remainingCats[0])
    } else if (remainingDates.length > 0) {
      colCols.push(remainingDates[0])
    }

    if (groupedColumns.numbers.length > 0) {
      vals.push({ column: groupedColumns.numbers[0], aggFunction: 'SUM' })
    }

    return { rows: rowCols, columns: colCols, values: vals, showRowTotals: true, showColumnTotals: true, showHeatmap: true }
  }, [pivotConfig, groupedColumns])

  // Fire initial config if auto-initialized
  useEffect(() => {
    if (!pivotConfig && config.values.length > 0) {
      onPivotConfigChange(config)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Which columns are already assigned
  const assignedColumns = useMemo(() => {
    const set = new Set<string>()
    config.rows.forEach(c => set.add(c))
    config.columns.forEach(c => set.add(c))
    config.values.forEach(v => set.add(v.column))
    return set
  }, [config])

  // Drop handlers
  const handleDropRows = useCallback(() => {
    const col = draggedColumn || selectedColumnForMobile
    if (!col || config.rows.includes(col)) { setDraggedColumn(null); setSelectedColumnForMobile(null); return }
    const newCols = config.columns.filter(c => c !== col)
    const newVals = config.values.filter(v => v.column !== col)
    onPivotConfigChange({ ...config, rows: [...config.rows, col], columns: newCols, values: newVals })
    setDraggedColumn(null)
    setSelectedColumnForMobile(null)
  }, [draggedColumn, selectedColumnForMobile, config, onPivotConfigChange])

  const handleDropColumns = useCallback(() => {
    const col = draggedColumn || selectedColumnForMobile
    if (!col || config.columns.includes(col)) { setDraggedColumn(null); setSelectedColumnForMobile(null); return }
    const newRows = config.rows.filter(c => c !== col)
    const newVals = config.values.filter(v => v.column !== col)
    onPivotConfigChange({ ...config, rows: newRows, columns: [...config.columns, col], values: newVals })
    setDraggedColumn(null)
    setSelectedColumnForMobile(null)
  }, [draggedColumn, selectedColumnForMobile, config, onPivotConfigChange])

  const handleDropValues = useCallback(() => {
    const col = draggedColumn || selectedColumnForMobile
    if (!col || config.values.some(v => v.column === col)) { setDraggedColumn(null); setSelectedColumnForMobile(null); return }
    const newRows = config.rows.filter(c => c !== col)
    const newCols = config.columns.filter(c => c !== col)
    onPivotConfigChange({ ...config, rows: newRows, columns: newCols, values: [...config.values, { column: col, aggFunction: 'SUM' }] })
    setDraggedColumn(null)
    setSelectedColumnForMobile(null)
  }, [draggedColumn, selectedColumnForMobile, config, onPivotConfigChange])

  // Remove handlers
  const removeFromRows = useCallback((col: string) => {
    onPivotConfigChange({ ...config, rows: config.rows.filter(c => c !== col) })
  }, [config, onPivotConfigChange])

  const removeFromColumns = useCallback((col: string) => {
    onPivotConfigChange({ ...config, columns: config.columns.filter(c => c !== col) })
  }, [config, onPivotConfigChange])

  const removeFromValues = useCallback((col: string) => {
    onPivotConfigChange({ ...config, values: config.values.filter(v => v.column !== col) })
  }, [config, onPivotConfigChange])

  // Change aggregation function
  const changeAggFunction = useCallback((col: string, fn: AggregationFunction) => {
    onPivotConfigChange({
      ...config,
      values: config.values.map(v => v.column === col ? { ...v, aggFunction: fn } : v),
    })
  }, [config, onPivotConfigChange])

  // Toggle totals
  const toggleRowTotals = useCallback((checked: boolean) => {
    onPivotConfigChange({ ...config, showRowTotals: checked })
  }, [config, onPivotConfigChange])

  const toggleColumnTotals = useCallback((checked: boolean) => {
    onPivotConfigChange({ ...config, showColumnTotals: checked })
  }, [config, onPivotConfigChange])

  const toggleHeatmap = useCallback((checked: boolean) => {
    onPivotConfigChange({ ...config, showHeatmap: checked })
  }, [config, onPivotConfigChange])

  // Drag handlers
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

  // Aggregation selector component for value zone chips
  const AggSelector = ({ column, aggFunction }: { column: string; aggFunction: AggregationFunction }) => {
    const [showMenu, setShowMenu] = useState(false)

    return (
      <Box position="relative">
        <HStack
          gap={0.5}
          px={1.5}
          py={0.5}
          bg="accent.teal/15"
          borderRadius="sm"
          cursor="pointer"
          onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu) }}
          _hover={{ bg: 'accent.teal/25' }}
          transition="all 0.15s"
        >
          <Text fontSize="2xs" fontWeight="700" color="accent.teal">
            {aggFunction}
          </Text>
          <Box as={LuChevronDown} fontSize="2xs" color="accent.teal" />
        </HStack>
        {showMenu && (
          <VStack
            position="absolute"
            top="100%"
            left={0}
            mt={1}
            bg="bg.panel"
            border="1px solid"
            borderColor="border.muted"
            borderRadius="md"
            boxShadow="md"
            zIndex={10}
            p={1}
            gap={0}
            minW="70px"
          >
            {AGG_FUNCTIONS.map(fn => (
              <Box
                key={fn}
                px={2}
                py={1}
                cursor="pointer"
                borderRadius="sm"
                bg={fn === aggFunction ? 'accent.teal/15' : 'transparent'}
                _hover={{ bg: 'accent.teal/10' }}
                onClick={(e) => { e.stopPropagation(); changeAggFunction(column, fn); setShowMenu(false) }}
              >
                <Text fontSize="xs" fontWeight={fn === aggFunction ? '700' : '500'} color={fn === aggFunction ? 'accent.teal' : 'fg.default'}>
                  {fn}
                </Text>
              </Box>
            ))}
          </VStack>
        )}
      </Box>
    )
  }

  return (
    <Box display="flex" flexDirection="column" gap={3} width="100%" p={3} bg="bg.muted" borderBottom="1px solid" borderColor="border.muted">
      {/* Column source palette - flat list */}
      <HStack gap={2} flexWrap="wrap">
        {allColumns.map(({ col, type }) => (
          <ColumnChip
            key={col}
            column={col}
            type={type}
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
        <DropZone label="Rows" onDrop={handleDropRows} isTouchDevice={isTouchDevice}>
          <HStack gap={1.5} flexWrap="wrap">
            {config.rows.map(col => (
              <ZoneChip
                key={col}
                column={col}
                type={resolveColumnType(col, columns, types)}
                onRemove={() => removeFromRows(col)}
              />
            ))}
          </HStack>
          {config.rows.length === 0 && (
            <Text fontSize="xs" color="fg.subtle" fontStyle="italic">Drop dimensions here</Text>
          )}
        </DropZone>

        <DropZone label="Columns" onDrop={handleDropColumns} isTouchDevice={isTouchDevice}>
          <HStack gap={1.5} flexWrap="wrap">
            {config.columns.map(col => (
              <ZoneChip
                key={col}
                column={col}
                type={resolveColumnType(col, columns, types)}
                onRemove={() => removeFromColumns(col)}
              />
            ))}
          </HStack>
          {config.columns.length === 0 && (
            <Text fontSize="xs" color="fg.subtle" fontStyle="italic">Drop dimensions here</Text>
          )}
        </DropZone>

        <DropZone label="Values" onDrop={handleDropValues} isTouchDevice={isTouchDevice}>
          <HStack gap={1.5} flexWrap="wrap">
            {config.values.map(v => (
              <ZoneChip
                key={v.column}
                column={v.column}
                type={resolveColumnType(v.column, columns, types)}
                onRemove={() => removeFromValues(v.column)}
                extra={<AggSelector column={v.column} aggFunction={v.aggFunction} />}
              />
            ))}
          </HStack>
          {config.values.length === 0 && (
            <Text fontSize="xs" color="fg.subtle" fontStyle="italic">Drop measures here</Text>
          )}
        </DropZone>
      </Box>

      {/* Options toggles */}
      <HStack gap={4}>
        <Checkbox
          size="sm"
          checked={config.showRowTotals !== false}
          onCheckedChange={({ checked }) => toggleRowTotals(!!checked)}
        >
          <Text fontSize="xs" color="fg.muted">Row totals</Text>
        </Checkbox>
        <Checkbox
          size="sm"
          checked={config.showColumnTotals !== false}
          onCheckedChange={({ checked }) => toggleColumnTotals(!!checked)}
        >
          <Text fontSize="xs" color="fg.muted">Column totals</Text>
        </Checkbox>
        <Checkbox
          size="sm"
          checked={config.showHeatmap !== false}
          onCheckedChange={({ checked }) => toggleHeatmap(!!checked)}
        >
          <Text fontSize="xs" color="fg.muted">Heatmap</Text>
        </Checkbox>
      </HStack>
    </Box>
  )
}
