'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import { Box, HStack, VStack, Text } from '@chakra-ui/react'
import { LuChevronDown } from 'react-icons/lu'
import { ColumnChip, DropZone, ZoneChip, resolveColumnType, useIsTouchDevice } from './AxisComponents'
import { FormulaBuilder } from './FormulaBuilder'
import type { PivotConfig, PivotValueConfig, PivotFormula, AggregationFunction } from '@/lib/types'

const AGG_FUNCTIONS: AggregationFunction[] = ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX']

interface PivotAxisBuilderProps {
  columns: string[]
  types: string[]
  pivotConfig?: PivotConfig
  onPivotConfigChange: (config: PivotConfig) => void
  useCompactView?: boolean
  availableRowValues?: string[]
  availableColumnValues?: string[]
}

export const PivotAxisBuilder = ({
  columns,
  types,
  pivotConfig,
  onPivotConfigChange,
  availableRowValues,
  availableColumnValues,
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
    const newRows = [...config.rows, col]
    // Clear row formulas if first row dimension changes (new dim added to position 0 when empty)
    const clearRowFormulas = config.rows.length === 0
    onPivotConfigChange({ ...config, rows: newRows, columns: newCols, values: newVals, ...(clearRowFormulas ? { rowFormulas: [] } : {}) })
    setDraggedColumn(null)
    setSelectedColumnForMobile(null)
  }, [draggedColumn, selectedColumnForMobile, config, onPivotConfigChange])

  const handleDropColumns = useCallback(() => {
    const col = draggedColumn || selectedColumnForMobile
    if (!col || config.columns.includes(col)) { setDraggedColumn(null); setSelectedColumnForMobile(null); return }
    const newRows = config.rows.filter(c => c !== col)
    const newVals = config.values.filter(v => v.column !== col)
    const newColumns = [...config.columns, col]
    // Clear column formulas if first column dimension changes (new dim added to position 0 when empty)
    const clearColFormulas = config.columns.length === 0
    onPivotConfigChange({ ...config, rows: newRows, columns: newColumns, values: newVals, ...(clearColFormulas ? { columnFormulas: [] } : {}) })
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
    const newRows = config.rows.filter(c => c !== col)
    // Clear row formulas if first dimension is being removed (or was the first and now changes)
    const clearRowFormulas = config.rows[0] === col
    onPivotConfigChange({ ...config, rows: newRows, ...(clearRowFormulas ? { rowFormulas: [] } : {}) })
  }, [config, onPivotConfigChange])

  const removeFromColumns = useCallback((col: string) => {
    const newCols = config.columns.filter(c => c !== col)
    // Clear column formulas if first dimension is being removed
    const clearColFormulas = config.columns[0] === col
    onPivotConfigChange({ ...config, columns: newCols, ...(clearColFormulas ? { columnFormulas: [] } : {}) })
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

      {/* Row Formulas */}
      {config.rows.length > 0 && availableRowValues && availableRowValues.length >= 2 && (
        <FormulaBuilder
          axis="row"
          formulas={config.rowFormulas || []}
          availableValues={availableRowValues}
          dimensionName={config.rows[0]}
          onChange={(formulas: PivotFormula[]) => onPivotConfigChange({ ...config, rowFormulas: formulas })}
        />
      )}

      {/* Column Formulas */}
      {config.columns.length > 0 && availableColumnValues && availableColumnValues.length >= 2 && (
        <FormulaBuilder
          axis="column"
          formulas={config.columnFormulas || []}
          availableValues={availableColumnValues}
          dimensionName={config.columns[0]}
          onChange={(formulas: PivotFormula[]) => onPivotConfigChange({ ...config, columnFormulas: formulas })}
        />
      )}

    </Box>
  )
}
