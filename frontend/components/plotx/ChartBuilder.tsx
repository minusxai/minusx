'use client'

import { useState, useCallback, useMemo, useRef, useEffect, use } from 'react'
import { Box, HStack, VStack, Text, IconButton } from '@chakra-ui/react'
import { LuHash, LuCalendar, LuType, LuX, LuGripVertical, LuChevronDown, LuChevronUp } from 'react-icons/lu'
import { LinePlot } from './LinePlot'
import { BarPlot } from './BarPlot'
import { AreaPlot } from './AreaPlot'
import { ScatterPlot } from './ScatterPlot'
import { FunnelPlot } from './FunnelPlot'
import { PiePlot } from './PiePlot'
import { PivotTable } from './PivotTable'
import { PivotAxisBuilder } from './PivotAxisBuilder'
import { SingleValue } from './SingleValue'
import { TrendPlot } from './TrendPlot'
import { getColumnType } from '@/lib/database/duckdb'
import { aggregatePivotData } from '@/lib/chart/pivot-utils'
import type { PivotConfig } from '@/lib/types'

interface ChartBuilderProps {
  columns: string[]
  types: string[]
  rows: Record<string, any>[]
  chartType: 'line' | 'bar' | 'area' | 'scatter' | 'funnel' | 'pie' | 'pivot' | 'trend'
  initialXCols?: string[]
  initialYCols?: string[]
  onAxisChange?: (xCols: string[], yCols: string[]) => void
  showAxisBuilder?: boolean  // Whether to show axis selection UI (default: true)
  useCompactView?: boolean  // Whether to use compact layout (passed from parent)
  fillHeight?: boolean  // Whether chart should fill available height (default: false)
  initialPivotConfig?: PivotConfig
  onPivotConfigChange?: (config: PivotConfig) => void
}

type ColumnType = 'date' | 'number' | 'text'

interface GroupedColumns {
  dates: string[]
  numbers: string[]
  categories: string[]
}

interface AggregatedData {
  xAxisData: string[]
  series: Array<{
    name: string
    data: number[]
  }>
}

const getTypeIcon = (type: ColumnType) => {
  switch (type) {
    case 'number': return LuHash
    case 'date': return LuCalendar
    case 'text': return LuType
  }
}

const getTypeColor = (type: ColumnType) => {
  switch (type) {
    case 'number': return '#2980b9' // Primary blue
    case 'date': return '#9b59b6'   // Purple
    case 'text': return '#f39c12'   // Orange
  }
}

// Aggregate data based on X and Y axis selections
const aggregateData = (
  rows: Record<string, any>[],
  xAxisColumns: string[],
  yAxisColumns: string[],
  chartType: 'line' | 'bar' | 'area' | 'scatter' | 'funnel' | 'pie' | 'pivot' | 'trend'
): AggregatedData => {
  if (yAxisColumns.length === 0) {
    return { xAxisData: [], series: [] }
  }

  // Handle case when no X axis columns (show total aggregation)
  if (xAxisColumns.length === 0) {
    const series = yAxisColumns.map(yCol => {
      const values: number[] = []
      rows.forEach(row => {
        const val = row[yCol]
        if (val !== null && val !== undefined && !isNaN(Number(val))) {
          values.push(Number(val))
        }
      })
      const total = values.reduce((acc, v) => acc + v, 0)
      return {
        name: yCol,
        data: [total]
      }
    })

    return {
      xAxisData: ['Total'],
      series
    }
  }

  // Group data by X axis columns
  const grouped = new Map<string, Record<string, number[]>>()

  rows.forEach(row => {
    // Create key from X axis columns (e.g., "2023-01-01" or "2023-01-01|Electronics")
    const xKey = xAxisColumns.map(col => {
      const val = row[col]
      if (val instanceof Date) {
        return val.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      }
      return String(val)
    }).join(' | ')

    if (!grouped.has(xKey)) {
      grouped.set(xKey, {})
    }

    const group = grouped.get(xKey)!

    // For each Y column, accumulate values
    yAxisColumns.forEach(yCol => {
      if (!group[yCol]) {
        group[yCol] = []
      }
      const val = row[yCol]
      if (val !== null && val !== undefined && !isNaN(Number(val))) {
        group[yCol].push(Number(val))
      }
    })
  })

  // Convert grouped data to series format
  const xAxisData = Array.from(grouped.keys())

  // If we have multiple X columns (e.g., date + category), we need to create series per category
  if (xAxisColumns.length > 1) {
    // For line/bar/area/scatter: reorder columns by cardinality (highest cardinality becomes x-axis)
    // For pie/funnel/pivot: honor the original column order as specified by the user
    const shouldReorderByCardinality = ['line', 'bar', 'area', 'scatter'].includes(chartType)

    let xAxisCol: string
    let groupingCols: string[]

    if (shouldReorderByCardinality) {
      // Calculate cardinality for each X column
      const cardinalities = xAxisColumns.map(col => {
        const uniqueValues = new Set(rows.map(row => String(row[col])))
        return { col, cardinality: uniqueValues.size }
      })

      // Sort by cardinality descending (highest cardinality first)
      // If cardinality is equal, preserve original order
      cardinalities.sort((a, b) => {
        if (b.cardinality !== a.cardinality) {
          return b.cardinality - a.cardinality
        }
        // Preserve original order when cardinality is equal
        return xAxisColumns.indexOf(a.col) - xAxisColumns.indexOf(b.col)
      })

      // Highest cardinality column(s) become x-axis, rest become grouping
      xAxisCol = cardinalities[0].col
      groupingCols = cardinalities.slice(1).map(c => c.col)
    } else {
      // Honor original order: first column is x-axis, rest are grouping
      xAxisCol = xAxisColumns[0]
      groupingCols = xAxisColumns.slice(1)
    }

    // Extract unique values for the grouping columns
    const uniqueGroups = new Set<string>()

    rows.forEach(row => {
      const groupVal = groupingCols.map(col => String(row[col])).join(' | ')
      uniqueGroups.add(groupVal)
    })

    // Create nested grouping structure
    const nestedGrouped = new Map<string, Map<string, number[]>>()

    rows.forEach(row => {
      // Primary key (highest cardinality column - the x-axis)
      const val = row[xAxisCol]
      const primaryKey = val instanceof Date
        ? val.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : String(val)

      // Secondary key (grouping columns)
      const secondaryKey = groupingCols.map(col => String(row[col])).join(' | ')

      if (!nestedGrouped.has(primaryKey)) {
        nestedGrouped.set(primaryKey, new Map())
      }

      const primaryGroup = nestedGrouped.get(primaryKey)!

      if (!primaryGroup.has(secondaryKey)) {
        primaryGroup.set(secondaryKey, [])
      }

      // Accumulate Y values
      yAxisColumns.forEach(yCol => {
        const val = row[yCol]
        if (val !== null && val !== undefined && !isNaN(Number(val))) {
          const key = `${secondaryKey}|${yCol}`
          if (!primaryGroup.has(key)) {
            primaryGroup.set(key, [])
          }
          primaryGroup.get(key)!.push(Number(val))
        }
      })
    })

    // Build series
    const seriesMap = new Map<string, number[]>()
    const primaryKeys = Array.from(nestedGrouped.keys())

    // For each combination of group + yColumn, create a series
    uniqueGroups.forEach(group => {
      yAxisColumns.forEach(yCol => {
        const seriesName = yAxisColumns.length > 1 ? `${group} - ${yCol}` : group
        const data: number[] = []

        primaryKeys.forEach(primaryKey => {
          const primaryGroup = nestedGrouped.get(primaryKey)!
          const key = `${group}|${yCol}`
          const values = primaryGroup.get(key) || []
          // Sum the values (default aggregation)
          const sum = values.reduce((acc, v) => acc + v, 0)
          data.push(sum)
        })

        seriesMap.set(seriesName, data)
      })
    })

    return {
      xAxisData: primaryKeys,
      series: Array.from(seriesMap.entries()).map(([name, data]) => ({ name, data }))
    }
  }

  // Simple case: single X column
  const series = yAxisColumns.map(yCol => ({
    name: yCol,
    data: xAxisData.map(xKey => {
      const values = grouped.get(xKey)?.[yCol] || []
      // Sum the values (default aggregation)
      return values.reduce((acc, v) => acc + v, 0)
    })
  }))

  return { xAxisData, series }
}

export const ChartBuilder = ({ columns, types, rows, chartType, initialXCols, initialYCols, onAxisChange, showAxisBuilder = true, useCompactView: useCompactViewProp = false, fillHeight = false, initialPivotConfig, onPivotConfigChange }: ChartBuilderProps) => {
  // Group columns by type
  
  const groupedColumns: GroupedColumns = useMemo(() => {
    const groups: GroupedColumns = {
      dates: [],
      numbers: [],
      categories: [],
    }

    columns.forEach((col, index) => {
      const type = types?.[index] ? getColumnType(types[index]) : 'text'
      if (type === 'date') {
        groups.dates.push(col)
      } else if (type === 'number') {
        groups.numbers.push(col)
      } else {
        groups.categories.push(col)
      }
    })

    return groups
  }, [columns, types])

  // Track column conflicts
  const columnConflicts = useMemo(() => {
    const conflicts: string[] = []

    if (initialXCols && initialXCols.length > 0) {
      const missingX = initialXCols.filter(col => !columns.includes(col))
      if (missingX.length > 0) {
        conflicts.push(`X-axis columns not found in results: ${missingX.join(', ')}`)
      }
    }

    if (initialYCols && initialYCols.length > 0) {
      const missingY = initialYCols.filter(col => !columns.includes(col))
      if (missingY.length > 0) {
        conflicts.push(`Y-axis columns not found in results: ${missingY.join(', ')}`)
      }
    }

    return conflicts
  }, [initialXCols, initialYCols, columns])

  // Auto-select columns: use initialXCols/initialYCols if provided, otherwise auto-select
  const [xAxisColumns, setXAxisColumns] = useState<string[]>(() => {
    if (initialXCols && initialXCols.length > 0) {
      // Filter to only include columns that actually exist in the data
      const validCols = initialXCols.filter(col => columns.includes(col))
      if (validCols.length > 0) return validCols
    }
    return groupedColumns.dates.length > 0 ? [groupedColumns.dates[0]] : []
  })

  const [yAxisColumns, setYAxisColumns] = useState<string[]>(() => {
    if (initialYCols && initialYCols.length > 0) {
      // Filter to only include columns that actually exist in the data
      const validCols = initialYCols.filter(col => columns.includes(col))
      if (validCols.length > 0) return validCols
    }
    return groupedColumns.numbers.length > 0 ? [groupedColumns.numbers[0]] : []
  })

  // Track if user has manually changed column selection
  const [hasUserModifiedColumns, setHasUserModifiedColumns] = useState(false)

  const [draggedColumn, setDraggedColumn] = useState<string | null>(null)
  const [selectedColumnForMobile, setSelectedColumnForMobile] = useState<string | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState(240) // default width in pixels
  const [isResizing, setIsResizing] = useState(false)
  const [mobileSettingsExpanded, setMobileSettingsExpanded] = useState(false)
  const dragStartX = useRef<number>(0)
  const dragStartWidth = useRef<number>(240)

  // Handle drag start (both mouse and mobile click)
  const handleDragStart = useCallback((column: string, isMobile?: boolean) => {
    setDraggedColumn(column)
    if (isMobile) {
      // Toggle selection on mobile
      setSelectedColumnForMobile(prev => prev === column ? null : column)
    }
  }, [])

  // Handle drop on X axis
  const handleDropX = useCallback(() => {
    const colToAdd = draggedColumn || selectedColumnForMobile
    if (colToAdd && !xAxisColumns.includes(colToAdd)) {
      const newXCols = [...xAxisColumns, colToAdd]
      setXAxisColumns(newXCols)
      setHasUserModifiedColumns(true)
      onAxisChange?.(newXCols, yAxisColumns)
    }
    setDraggedColumn(null)
    setSelectedColumnForMobile(null)
  }, [draggedColumn, selectedColumnForMobile, xAxisColumns, yAxisColumns, onAxisChange])

  // Handle drop on Y axis
  const handleDropY = useCallback(() => {
    const colToAdd = draggedColumn || selectedColumnForMobile
    if (colToAdd && !yAxisColumns.includes(colToAdd)) {
      const newYCols = [...yAxisColumns, colToAdd]
      setYAxisColumns(newYCols)
      setHasUserModifiedColumns(true)
      onAxisChange?.(xAxisColumns, newYCols)
    }
    setDraggedColumn(null)
    setSelectedColumnForMobile(null)
  }, [draggedColumn, selectedColumnForMobile, yAxisColumns, xAxisColumns, onAxisChange])

  // Remove column from axis
  const removeFromX = useCallback((column: string) => {
    const newXCols = xAxisColumns.filter(c => c !== column)
    setXAxisColumns(newXCols)
    setHasUserModifiedColumns(true)
    onAxisChange?.(newXCols, yAxisColumns)
  }, [xAxisColumns, yAxisColumns, onAxisChange])

  const removeFromY = useCallback((column: string) => {
    const newYCols = yAxisColumns.filter(c => c !== column)
    setYAxisColumns(newYCols)
    setHasUserModifiedColumns(true)
    onAxisChange?.(xAxisColumns, newYCols)
  }, [yAxisColumns, xAxisColumns, onAxisChange])

  // Aggregate data
  const aggregatedData = useMemo(() => {
    return aggregateData(rows, xAxisColumns, yAxisColumns, chartType)
  }, [rows, xAxisColumns, yAxisColumns, chartType])

  const hasData = yAxisColumns.length > 0

  // Handle sidebar resize
  const handleResizeStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsResizing(true)
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    dragStartX.current = clientX
    dragStartWidth.current = sidebarWidth
  }, [sidebarWidth])

  const handleResizeMove = useCallback((clientX: number) => {
    if (!isResizing) return

    const deltaX = clientX - dragStartX.current
    const newWidth = Math.max(100, Math.min(300, dragStartWidth.current + deltaX))
    setSidebarWidth(newWidth)
  }, [isResizing])

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false)
  }, [])

  // Mouse and touch event handlers for resize
  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => handleResizeMove(e.clientX)
    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault()
      handleResizeMove(e.touches[0].clientX)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('touchmove', handleTouchMove, { passive: false })
    document.addEventListener('mouseup', handleResizeEnd)
    document.addEventListener('touchend', handleResizeEnd)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('touchmove', handleTouchMove)
      document.removeEventListener('mouseup', handleResizeEnd)
      document.removeEventListener('touchend', handleResizeEnd)
    }
  }, [isResizing, handleResizeMove, handleResizeEnd])

  // Use the compact view flag passed from parent
  const useCompactView = useCompactViewProp

  // Pivot-specific state
  const [pivotConfig, setPivotConfig] = useState<PivotConfig | undefined>(initialPivotConfig)

  const handlePivotConfigChange = useCallback((config: PivotConfig) => {
    setPivotConfig(config)
    onPivotConfigChange?.(config)
  }, [onPivotConfigChange])

  const pivotData = useMemo(() => {
    if (chartType !== 'pivot' || !pivotConfig) return null
    return aggregatePivotData(rows, pivotConfig)
  }, [rows, pivotConfig, chartType])

  // For pivot, we consider having data when pivotConfig has values
  const isPivot = chartType === 'pivot'
  const pivotHasData = isPivot && pivotData && pivotData.cells.length > 0

  // Pivot mode: completely different layout
  const [pivotSettingsExpanded, setPivotSettingsExpanded] = useState(true)

  if (isPivot) {
    return (
      <Box display="flex" flexDirection="column" gap={0} height="100%" width="100%">
        {/* Collapsible header */}
        {showAxisBuilder && (
          <>
            <Box
              display="flex"
              alignItems="center"
              justifyContent="space-between"
              px={3}
              py={1}
              bg="bg.elevated"
              borderBottom="1px solid"
              borderColor="border.default"
              cursor="pointer"
              onClick={() => setPivotSettingsExpanded(!pivotSettingsExpanded)}
              _hover={{ bg: "bg.muted" }}
            >
              <Text fontSize="sm" fontWeight="700" color="fg.default">
                Visualization Settings
              </Text>
              <IconButton
                aria-label="Toggle pivot settings"
                size="xs"
                variant="ghost"
              >
                {pivotSettingsExpanded ? <LuChevronUp /> : <LuChevronDown />}
              </IconButton>
            </Box>

            {/* Pivot Axis Builder - collapsible */}
            {pivotSettingsExpanded && (
              <PivotAxisBuilder
                columns={columns}
                types={types}
                pivotConfig={pivotConfig}
                onPivotConfigChange={handlePivotConfigChange}
                useCompactView={useCompactView}
              />
            )}
          </>
        )}

        {/* Pivot Table */}
        <Box flex="1" overflow="hidden" display="flex" minHeight="0">
          {pivotHasData ? (
            <PivotTable
              pivotData={pivotData!}
              showRowTotals={pivotConfig?.showRowTotals !== false}
              showColTotals={pivotConfig?.showColumnTotals !== false}
              showHeatmap={pivotConfig?.showHeatmap !== false}
              rowDimNames={pivotConfig?.rows}
            />
          ) : (
            <Box
              display="flex"
              alignItems="center"
              justifyContent="center"
              width="100%"
              color="fg.muted"
              fontSize="sm"
            >
              <VStack gap={2}>
                <Text fontWeight="600">No data to display</Text>
                <Text fontSize="xs" color="fg.subtle">
                  Drag columns to Rows, Columns, and Values to build your pivot table
                </Text>
              </VStack>
            </Box>
          )}
        </Box>
      </Box>
    )
  }

  return (
    <Box display="flex" flexDirection={useCompactView ? "column" : "row"} gap={0} height={'100%'} width="100%" position="relative">
      {/* Compact View Toggle - Shows when container is narrow */}
      {showAxisBuilder && useCompactView && (
        <Box
          display="flex"
          alignItems="center"
          justifyContent="space-between"
          px={3}
          py={1}
          bg="bg.elevated"
          borderBottom="1px solid"
          borderColor="border.default"
          cursor="pointer"
          onClick={() => setMobileSettingsExpanded(!mobileSettingsExpanded)}
          _hover={{ bg: "bg.muted" }}
        >
          <HStack gap={2}>
            <Text fontSize="sm" fontWeight="700" color="fg.default">
              Visualization Settings
            </Text>
            {selectedColumnForMobile && (
              <Box
                px={2}
                py={0.5}
                bg="accent.teal"
                borderRadius="full"
                fontSize="xs"
                color="white"
                fontWeight="600"
              >
                1 selected
              </Box>
            )}
          </HStack>
          <IconButton
            aria-label="Toggle viz settings"
            size="xs"
            variant="ghost"
          >
            {mobileSettingsExpanded ? <LuChevronUp /> : <LuChevronDown />}
          </IconButton>
        </Box>
      )}

      {/* Sidebar - Column Selector */}
      {showAxisBuilder && (
        <Box position="relative" flexShrink={0} display={useCompactView ? (mobileSettingsExpanded ? "block" : "none") : "block"}>
          <Box
            width={useCompactView ? "100%" : `${sidebarWidth}px`}
            minWidth={useCompactView ? "100%" : `${sidebarWidth}px`}
            height={useCompactView ? "auto" : "100%"}
            maxHeight={useCompactView ? "none" : "100%"}
            flexShrink={0}
            bg="bg.surface"
            borderRight={useCompactView ? "none" : "1px solid"}
            borderRightColor="border.default"
            borderBottom={useCompactView ? "1px solid" : "none"}
            borderBottomColor="border.default"
            p={useCompactView ? 2 : 4}
            overflowY={useCompactView ? "visible" : "auto"}
            overflowX="hidden"
          >
            <Box
              display="flex"
              flexDirection={useCompactView ? "row" : "column"}
            //   flexWrap="wrap"
              gap={4}
              alignItems="start"
              justifyContent={"flex-start"}
            >
              {/* Dates Section */}
              {groupedColumns.dates.length > 0 && (
                <VStack align="start" gap={1} borderBottom={useCompactView ? "none" : "1px solid"} borderBottomColor="border.default" pb={useCompactView ? 0 : 5}>
                  <Text fontSize={useCompactView ? "2xs" : "xs"} fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em">
                    Dates
                  </Text>
                  <HStack gap={2} flexWrap="wrap">
                    {groupedColumns.dates.map(col => (
                      <ColumnItem
                        key={col}
                        column={col}
                        type="date"
                        onDragStart={handleDragStart}
                        isSelected={xAxisColumns.includes(col) || yAxisColumns.includes(col)}
                        isMobileSelected={selectedColumnForMobile === col}
                      />
                    ))}
                  </HStack>
                </VStack>
              )}

              {/* Categories Section */}
              {groupedColumns.categories.length > 0 && (
                <VStack align="start" gap={1} borderBottom={useCompactView ? "none" : "1px solid"} borderBottomColor="border.default" pb={useCompactView ? 0 : 5}>
                  <Text fontSize={useCompactView ? "2xs" : "xs"} fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em">
                    Categories
                  </Text>
                  <HStack gap={2} flexWrap="wrap">
                    {groupedColumns.categories.map(col => (
                      <ColumnItem
                        key={col}
                        column={col}
                        type="text"
                        onDragStart={handleDragStart}
                        isSelected={xAxisColumns.includes(col) || yAxisColumns.includes(col)}
                        isMobileSelected={selectedColumnForMobile === col}
                      />
                    ))}
                  </HStack>
                </VStack>
              )}

              {/* Numbers Section */}
              {groupedColumns.numbers.length > 0 && (
                <VStack align="start" gap={1} borderBottom={useCompactView ? "none" : "1px solid"} borderBottomColor="border.default" pb={useCompactView ? 0 : 5}>
                  <Text fontSize={useCompactView ? "2xs" : "xs"} fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em">
                    Numbers
                  </Text>
                  <HStack gap={2} flexWrap="wrap">
                    {groupedColumns.numbers.map(col => (
                      <ColumnItem
                        key={col}
                        column={col}
                        type="number"
                        onDragStart={handleDragStart}
                        isSelected={xAxisColumns.includes(col) || yAxisColumns.includes(col)}
                        isMobileSelected={selectedColumnForMobile === col}
                      />
                    ))}
                  </HStack>
                </VStack>
              )}
            </Box>
          </Box>

          {/* Resize Handle - Full view only */}
          {!useCompactView && (
          <Box
            display="flex"
            position="absolute"
            right={0}
            top={0}
            bottom={0}
            width="10px"
            cursor="col-resize"
            onMouseDown={handleResizeStart}
            onTouchStart={handleResizeStart}
            _hover={{
              bg: 'accent.teal/20',
            }}
            bg={isResizing ? 'accent.teal/30' : 'transparent'}
            transition="background 0.2s"
            alignItems="center"
            justifyContent="center"
            userSelect="none"
          >
            <Box
              as={LuGripVertical}
              fontSize="xl"
              color={isResizing ? 'accent.teal' : 'accent.teal'}
              opacity={1}
            />
          </Box>
          )}
        </Box>
      )}

      {/* Chart Area */}
      <VStack flex="1" align="stretch" gap={0} minWidth={0} overflow="hidden" minHeight="0" height={useCompactView ? "auto" : undefined}>
        {/* Column Conflict Warning */}
        {columnConflicts.length > 0 && !hasUserModifiedColumns && (
          <Box
            p={3}
            bg="accent.warning/10"
            borderBottom="1px solid"
            borderColor="accent.warning"
          >
            <VStack align="stretch" gap={1}>
              <Text fontSize="xs" fontWeight="700" color="accent.warning" textTransform="uppercase" letterSpacing="0.05em">
                Column Configuration Warning
              </Text>
              {columnConflicts.map((conflict, idx) => (
                <Text key={idx} fontSize="xs" color="fg.default" fontFamily="mono">
                  {conflict}
                </Text>
              ))}
              <Text fontSize="xs" color="fg.muted" mt={1}>
                Using default column selection instead.
              </Text>
            </VStack>
          </Box>
        )}

        {/* Mobile instruction text */}
        {showAxisBuilder && selectedColumnForMobile && (
          <Box
            p={3}
            bg="accent.teal/10"
            borderBottom="1px solid"
            borderColor="accent.teal"
            textAlign="center"
            display={useCompactView ? (mobileSettingsExpanded ? "block" : "none") : "block"}
          >
            <Text fontSize="sm" fontWeight="600" color="accent.teal">
              Tap on X Axis or Y Axis below to add "{selectedColumnForMobile}"
            </Text>
          </Box>
        )}

        {/* Axis Drop Zones */}
        {showAxisBuilder && (
          <Box
            display={useCompactView ? (mobileSettingsExpanded ? "flex" : "none") : "flex"}
            flexDirection={"row"}
            gap={4}
            p={4}
            bg="bg.muted"
            borderBottom="1px solid"
            borderColor="border.muted"
            justifyContent="center"
            alignItems="stretch"
          >
          {/* X Axis Drop Zone */}
          <DropZone
            label="X Axis"
            columns={xAxisColumns}
            onDrop={handleDropX}
            onRemove={removeFromX}
            types={types}
            allColumns={columns}
          />

          {/* Y Axis Drop Zone */}
          <DropZone
            label="Y Axis"
            columns={yAxisColumns}
            onDrop={handleDropY}
            onRemove={removeFromY}
            types={types}
            allColumns={columns}
          />
          </Box>
        )}

        {/* Chart Display */}
        <Box flex="1" px={showAxisBuilder && !useCompactView ? 6 : 0} overflow="hidden" display="flex" flexDirection="column" minHeight="0">
          {hasData ? (
            <>
              {/* Show SingleValue when no X-axis columns selected */}
              {xAxisColumns.length === 0 ? (
                <SingleValue series={aggregatedData.series} />
              ) : (
                <Box width="100%" flex="1" display="flex" alignItems="center" justifyContent="center" minWidth="200px" minHeight="0">
                  {chartType === 'line' && (
                    <LinePlot
                      xAxisData={aggregatedData.xAxisData}
                      series={aggregatedData.series}
                      xAxisLabel={xAxisColumns.join(' | ')}
                      yAxisLabel={yAxisColumns.join(' | ')}
                      yAxisColumns={yAxisColumns}
                      height={useCompactView && !fillHeight ? 300 : undefined}
                    />
                  )}
                  {chartType === 'bar' && (
                    <BarPlot
                      xAxisData={aggregatedData.xAxisData}
                      series={aggregatedData.series}
                      xAxisLabel={xAxisColumns.join(' | ')}
                      yAxisLabel={yAxisColumns.join(' | ')}
                      yAxisColumns={yAxisColumns}
                      height={useCompactView && !fillHeight ? 300 : undefined}
                    />
                  )}
                  {chartType === 'area' && (
                    <AreaPlot
                      xAxisData={aggregatedData.xAxisData}
                      series={aggregatedData.series}
                      xAxisLabel={xAxisColumns.join(' | ')}
                      yAxisLabel={yAxisColumns.join(' | ')}
                      yAxisColumns={yAxisColumns}
                      height={useCompactView && !fillHeight ? 300 : undefined}
                    />
                  )}
                  {chartType === 'scatter' && (
                    <ScatterPlot
                      xAxisData={aggregatedData.xAxisData}
                      series={aggregatedData.series}
                      xAxisLabel={xAxisColumns.join(' | ')}
                      yAxisLabel={yAxisColumns.join(' | ')}
                      yAxisColumns={yAxisColumns}
                      height={useCompactView && !fillHeight ? 300 : undefined}
                    />
                  )}
                  {chartType === 'funnel' && (
                    <FunnelPlot
                      xAxisData={aggregatedData.xAxisData}
                      series={aggregatedData.series}
                      xAxisLabel={xAxisColumns.join(' | ')}
                      yAxisLabel={yAxisColumns.join(' | ')}
                      yAxisColumns={yAxisColumns}
                      height={useCompactView && !fillHeight ? 300 : undefined}
                    />
                  )}
                  {chartType === 'pie' && (
                    <PiePlot
                      xAxisData={aggregatedData.xAxisData}
                      series={aggregatedData.series}
                      xAxisLabel={xAxisColumns.join(' | ')}
                      yAxisLabel={yAxisColumns.join(' | ')}
                      yAxisColumns={yAxisColumns}
                      height={useCompactView && !fillHeight ? 300 : undefined}
                    />
                  )}
                  {chartType === 'trend' && (
                    <TrendPlot series={aggregatedData.series} />
                  )}
                </Box>
              )}
            </>
          ) : (
            <Box
              display="flex"
              alignItems="center"
              justifyContent="center"
              height="100%"
              color="fg.muted"
              fontSize="sm"
            >
              <VStack gap={2}>
                <Text fontWeight="600">No data to display</Text>
                <Text fontSize="xs" color="fg.subtle">
                  Drag at least one column to Y axis to see aggregated values
                </Text>
              </VStack>
            </Box>
          )}
        </Box>
      </VStack>
    </Box>
  )
}

// Column Item Component (draggable)
interface ColumnItemProps {
  column: string
  type: ColumnType
  onDragStart: (column: string, isMobile?: boolean) => void
  isSelected: boolean
  isMobileSelected?: boolean
}

const ColumnItem = ({ column, type, onDragStart, isSelected, isMobileSelected }: ColumnItemProps) => {
  const Icon = getTypeIcon(type)
  const color = getTypeColor(type)
  const [isTouchDevice, setIsTouchDevice] = useState(false)

  // Detect if this is a touch device
  useEffect(() => {
    setIsTouchDevice('ontouchstart' in window || navigator.maxTouchPoints > 0)
  }, [])

  const handleClick = (e: React.MouseEvent) => {
    // On touch devices, use click to select
    if (isTouchDevice) {
      e.preventDefault()
      e.stopPropagation()
      onDragStart(column, true)
    }
  }

  return (
    <HStack
      gap={{ base: 1, md: 2 }}
      p={{ base: 1.5, md: 2 }}
      bg={isMobileSelected ? 'accent.teal' : isSelected ? 'bg.muted' : 'transparent'}
      borderRadius="sm"
      border="2px solid"
      borderColor={isMobileSelected ? 'accent.teal' : isSelected ? 'accent.teal' : 'transparent'}
      cursor={{ base: "pointer", md: "grab" }}
      opacity={isSelected ? 1 : 0.7}
      _hover={{ bg: 'bg.muted', borderColor: 'border.muted' }}
      _active={{ cursor: { base: "pointer", md: "grabbing" } }}
      draggable={!isTouchDevice}
      onDragStart={() => !isTouchDevice && onDragStart(column)}
      onClick={handleClick}
      transition="all 0.2s"
      userSelect="none"
      boxShadow={isMobileSelected ? '0 0 0 3px rgba(22, 160, 133, 0.3)' : 'none'}
    >
      <Box as={Icon} fontSize={{ base: "xs", md: "sm" }} color={isMobileSelected ? 'white' : color} flexShrink={0} />
      <Text fontSize={{ base: "2xs", md: "xs" }} fontFamily="mono" color={isMobileSelected ? 'white' : 'fg.default'} lineClamp={1} wordBreak="break-all" userSelect="none">
        {column}
      </Text>
    </HStack>
  )
}

// Drop Zone Component
interface DropZoneProps {
  label: string
  columns: string[]
  onDrop: () => void
  onRemove: (column: string) => void
  types: string[]
  allColumns: string[]
}

const DropZone = ({ label, columns, onDrop, onRemove, types, allColumns }: DropZoneProps) => {
  const [isDragOver, setIsDragOver] = useState(false)
  const [isTouchDevice, setIsTouchDevice] = useState(false)

  // Detect if this is a touch device
  useEffect(() => {
    setIsTouchDevice('ontouchstart' in window || navigator.maxTouchPoints > 0)
  }, [])

  const handleClick = () => {
    // On touch devices, clicking the drop zone will drop the selected column
    if (isTouchDevice) {
      onDrop()
    }
  }

  return (
    <VStack
      flex="1"
      maxWidth={{ base: "100%", md: "400px" }}
      align="stretch"
      gap={2}
      p={3}
      bg={isDragOver ? 'accent.teal/10' : 'bg.surface'}
      borderRadius="md"
      border="2px dashed"
      borderColor={isDragOver ? 'accent.teal' : 'border.muted'}
      cursor={{ base: "pointer", md: "default" }}
      position={"relative"}
      onDragOver={(e) => {
        e.preventDefault()
        setIsDragOver(true)
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setIsDragOver(false)
        onDrop()
      }}
      onClick={handleClick}
      transition="all 0.2s"
    >
      <Text fontSize="xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em" position={"absolute"} top={-3} bg="bg.muted" px={2} py={0} borderRadius="sm"
      border="1px dashed" borderColor={isDragOver ? 'accent.teal' : 'border.muted'}>
        {label}
      </Text>
      {columns.length > 0 ? (
        <HStack gap={2} flexWrap="wrap">
          {columns.map(col => {
            const index = allColumns.indexOf(col)
            const type = types?.[index] ? getColumnType(types[index]) : 'text'
            const Icon = getTypeIcon(type)
            const color = getTypeColor(type)

            return (
              <HStack
                key={col}
                gap={1.5}
                px={2}
                py={1}
                bg="bg.muted"
                borderRadius="sm"
                border="1px solid"
                borderColor="border.muted"
                maxWidth={{ base: "100%", md: "200px" }}
                minWidth={0}
              >
                <Box as={Icon} fontSize="xs" color={color} flexShrink={0} />
                <Text
                  fontSize="xs"
                  fontFamily="mono"
                  color="fg.default"
                  overflow="hidden"
                  textOverflow="ellipsis"
                  whiteSpace="nowrap"
                  flex="1"
                  minWidth={0}
                >
                  {col}
                </Text>
                <Box
                  as="button"
                  onClick={() => onRemove(col)}
                  ml={1}
                  _hover={{ color: 'accent.danger' }}
                  transition="color 0.2s"
                  flexShrink={0}
                >
                  <LuX size={12} />
                </Box>
              </HStack>
            )
          })}
        </HStack>
      ) : (
        <Text fontSize="xs" color="fg.subtle" fontStyle="italic" display={{ base: "none", md: "block" }}>
          Drop columns here
        </Text>
      )}
      {columns.length === 0 && (
        <Text fontSize="xs" color="fg.subtle" fontStyle="italic" display={{ base: "block", md: "none" }}>
          Click on any column to add
        </Text>
      )}
    </VStack>
  )
}
