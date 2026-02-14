'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import { Box, HStack, VStack, Text } from '@chakra-ui/react'
import { Checkbox } from '@/components/ui/checkbox'
import { LuHash, LuCalendar, LuType, LuX, LuChevronDown } from 'react-icons/lu'
import { getColumnType } from '@/lib/database/duckdb'
import type { PivotConfig, PivotValueConfig, AggregationFunction } from '@/lib/types'

type ColumnType = 'date' | 'number' | 'text'

const getTypeIcon = (type: ColumnType) => {
  switch (type) {
    case 'number': return LuHash
    case 'date': return LuCalendar
    case 'text': return LuType
  }
}

const getTypeColor = (type: ColumnType) => {
  switch (type) {
    case 'number': return '#2980b9'
    case 'date': return '#9b59b6'
    case 'text': return '#f39c12'
  }
}

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
  useCompactView = false,
}: PivotAxisBuilderProps) => {
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null)
  const [isTouchDevice, setIsTouchDevice] = useState(false)
  const [selectedColumnForMobile, setSelectedColumnForMobile] = useState<string | null>(null)

  useEffect(() => {
    setIsTouchDevice('ontouchstart' in window || navigator.maxTouchPoints > 0)
  }, [])

  // Classify columns
  const groupedColumns = useMemo(() => {
    const groups: { dates: string[]; numbers: string[]; categories: string[] } = {
      dates: [],
      numbers: [],
      categories: [],
    }
    columns.forEach((col, index) => {
      const type = types?.[index] ? getColumnType(types[index]) : 'text'
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

    // First date/category → rows
    if (groupedColumns.dates.length > 0) {
      rowCols.push(groupedColumns.dates[0])
    } else if (groupedColumns.categories.length > 0) {
      rowCols.push(groupedColumns.categories[0])
    }

    // Second category → columns (or second date if no categories)
    const remainingCats = groupedColumns.categories.filter(c => !rowCols.includes(c))
    const remainingDates = groupedColumns.dates.filter(c => !rowCols.includes(c))
    if (remainingCats.length > 0) {
      colCols.push(remainingCats[0])
    } else if (remainingDates.length > 0) {
      colCols.push(remainingDates[0])
    }

    // First number → values with SUM
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
    // Remove from other zones if present
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

  const handleDragStart = useCallback((column: string, isMobile?: boolean) => {
    setDraggedColumn(column)
    if (isMobile) {
      setSelectedColumnForMobile(prev => prev === column ? null : column)
    }
  }, [])

  // Column chip (source)
  const ColumnChip = ({ col, type }: { col: string; type: ColumnType }) => {
    const Icon = getTypeIcon(type)
    const color = getTypeColor(type)
    const isAssigned = assignedColumns.has(col)
    const isMobileSelected = selectedColumnForMobile === col

    return (
      <HStack
        gap={1}
        p={1.5}
        bg={isMobileSelected ? 'accent.teal' : isAssigned ? 'bg.muted' : 'transparent'}
        borderRadius="sm"
        border="2px solid"
        borderColor={isMobileSelected ? 'accent.teal' : isAssigned ? 'accent.teal' : 'transparent'}
        cursor={isTouchDevice ? 'pointer' : 'grab'}
        opacity={isAssigned ? 1 : 0.7}
        _hover={{ bg: 'bg.muted', borderColor: 'border.muted' }}
        _active={{ cursor: isTouchDevice ? 'pointer' : 'grabbing' }}
        draggable={!isTouchDevice}
        onDragStart={() => !isTouchDevice && handleDragStart(col)}
        onClick={() => isTouchDevice && handleDragStart(col, true)}
        transition="all 0.2s"
        userSelect="none"
      >
        <Box as={Icon} fontSize="xs" color={isMobileSelected ? 'white' : color} flexShrink={0} />
        <Text fontSize="2xs" fontFamily="mono" color={isMobileSelected ? 'white' : 'fg.default'} lineClamp={1} wordBreak="break-all" userSelect="none">
          {col}
        </Text>
      </HStack>
    )
  }

  // Drop zone
  const PivotDropZone = ({ label, onDrop, children }: { label: string; onDrop: () => void; children: React.ReactNode }) => {
    const [isDragOver, setIsDragOver] = useState(false)

    return (
      <VStack
        flex="1"
        align="stretch"
        gap={1}
        p={2}
        bg={isDragOver ? 'accent.teal/10' : 'bg.surface'}
        borderRadius="md"
        border="2px dashed"
        borderColor={isDragOver ? 'accent.teal' : 'border.muted'}
        position="relative"
        minH="40px"
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setIsDragOver(false); onDrop() }}
        onClick={() => isTouchDevice && onDrop()}
        cursor={isTouchDevice ? 'pointer' : 'default'}
        transition="all 0.2s"
      >
        <Text
          fontSize="2xs"
          fontWeight="700"
          color="fg.subtle"
          textTransform="uppercase"
          letterSpacing="0.05em"
          position="absolute"
          top={-2.5}
          bg="bg.muted"
          px={1.5}
          borderRadius="sm"
          border="1px dashed"
          borderColor={isDragOver ? 'accent.teal' : 'border.muted'}
        >
          {label}
        </Text>
        {children}
      </VStack>
    )
  }

  // Chip inside a drop zone (removable, with optional agg selector for values)
  const ZoneChip = ({ col, onRemove, aggFunction, onAggChange }: {
    col: string
    onRemove: () => void
    aggFunction?: AggregationFunction
    onAggChange?: (fn: AggregationFunction) => void
  }) => {
    const [showAggMenu, setShowAggMenu] = useState(false)
    const colIndex = columns.indexOf(col)
    const type = types?.[colIndex] ? getColumnType(types[colIndex]) : 'text'
    const Icon = getTypeIcon(type)
    const color = getTypeColor(type)

    return (
      <HStack
        gap={1}
        px={2}
        py={1}
        bg="bg.muted"
        borderRadius="sm"
        border="1px solid"
        borderColor="border.muted"
        minWidth={0}
        position="relative"
      >
        <Box as={Icon} fontSize="xs" color={color} flexShrink={0} />
        <Text fontSize="xs" fontFamily="mono" color="fg.default" lineClamp={1} flex="1" minWidth={0}>
          {col}
        </Text>
        {/* Aggregation selector for values */}
        {aggFunction && onAggChange && (
          <Box position="relative">
            <HStack
              gap={0.5}
              px={1.5}
              py={0.5}
              bg="accent.teal/15"
              borderRadius="sm"
              cursor="pointer"
              onClick={(e) => { e.stopPropagation(); setShowAggMenu(!showAggMenu) }}
              _hover={{ bg: 'accent.teal/25' }}
              transition="all 0.15s"
            >
              <Text fontSize="2xs" fontWeight="700" color="accent.teal">
                {aggFunction}
              </Text>
              <Box as={LuChevronDown} fontSize="2xs" color="accent.teal" />
            </HStack>
            {showAggMenu && (
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
                    onClick={(e) => { e.stopPropagation(); onAggChange(fn); setShowAggMenu(false) }}
                  >
                    <Text fontSize="xs" fontWeight={fn === aggFunction ? '700' : '500'} color={fn === aggFunction ? 'accent.teal' : 'fg.default'}>
                      {fn}
                    </Text>
                  </Box>
                ))}
              </VStack>
            )}
          </Box>
        )}
        <Box
          as="button"
          onClick={(e: React.MouseEvent) => { e.stopPropagation(); onRemove() }}
          ml={0.5}
          _hover={{ color: 'accent.danger' }}
          transition="color 0.2s"
          flexShrink={0}
        >
          <LuX size={12} />
        </Box>
      </HStack>
    )
  }

  return (
    <Box display="flex" flexDirection="column" gap={3} width="100%" p={3} bg="bg.muted" borderBottom="1px solid" borderColor="border.muted">
      {/* Column source palette */}
      <Box display="flex" flexDirection="row" gap={3} flexWrap="wrap" alignItems="start">
        {groupedColumns.dates.length > 0 && (
          <VStack align="start" gap={0.5}>
            <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em">Dates</Text>
            <HStack gap={1} flexWrap="wrap">
              {groupedColumns.dates.map(col => <ColumnChip key={col} col={col} type="date" />)}
            </HStack>
          </VStack>
        )}
        {groupedColumns.categories.length > 0 && (
          <VStack align="start" gap={0.5}>
            <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em">Categories</Text>
            <HStack gap={1} flexWrap="wrap">
              {groupedColumns.categories.map(col => <ColumnChip key={col} col={col} type="text" />)}
            </HStack>
          </VStack>
        )}
        {groupedColumns.numbers.length > 0 && (
          <VStack align="start" gap={0.5}>
            <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em">Numbers</Text>
            <HStack gap={1} flexWrap="wrap">
              {groupedColumns.numbers.map(col => <ColumnChip key={col} col={col} type="number" />)}
            </HStack>
          </VStack>
        )}
      </Box>

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
        <PivotDropZone label="Rows" onDrop={handleDropRows}>
          <HStack gap={1} flexWrap="wrap" mt={1}>
            {config.rows.map(col => (
              <ZoneChip key={col} col={col} onRemove={() => removeFromRows(col)} />
            ))}
          </HStack>
          {config.rows.length === 0 && (
            <Text fontSize="2xs" color="fg.subtle" fontStyle="italic">Drop dimensions here</Text>
          )}
        </PivotDropZone>

        <PivotDropZone label="Columns" onDrop={handleDropColumns}>
          <HStack gap={1} flexWrap="wrap" mt={1}>
            {config.columns.map(col => (
              <ZoneChip key={col} col={col} onRemove={() => removeFromColumns(col)} />
            ))}
          </HStack>
          {config.columns.length === 0 && (
            <Text fontSize="2xs" color="fg.subtle" fontStyle="italic">Drop dimensions here</Text>
          )}
        </PivotDropZone>

        <PivotDropZone label="Values" onDrop={handleDropValues}>
          <HStack gap={1} flexWrap="wrap" mt={1}>
            {config.values.map(v => (
              <ZoneChip
                key={v.column}
                col={v.column}
                onRemove={() => removeFromValues(v.column)}
                aggFunction={v.aggFunction}
                onAggChange={(fn) => changeAggFunction(v.column, fn)}
              />
            ))}
          </HStack>
          {config.values.length === 0 && (
            <Text fontSize="2xs" color="fg.subtle" fontStyle="italic">Drop measures here</Text>
          )}
        </PivotDropZone>
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
