'use client'

import { useState, useCallback, useMemo } from 'react'
import { Box, HStack, VStack, Text, IconButton } from '@chakra-ui/react'
import { LuChevronDown, LuChevronUp } from 'react-icons/lu'
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
import { DrillDownCard, type DrillDownState } from './DrillDownCard'
import { ColumnChip, DropZone, ZoneChip, resolveColumnType, useIsTouchDevice } from './AxisComponents'
import { aggregateData } from '@/lib/chart/aggregate-data'
import { aggregatePivotData, computeFormulas, getUniqueTopLevelRowValues, getUniqueTopLevelColumnValues } from '@/lib/chart/pivot-utils'
import type { PivotConfig } from '@/lib/types'

interface ChartBuilderProps {
  columns: string[]
  types: string[]
  rows: Record<string, any>[]
  chartType: 'line' | 'bar' | 'area' | 'scatter' | 'funnel' | 'pie' | 'pivot' | 'trend'
  initialXCols?: string[]
  initialYCols?: string[]
  onAxisChange?: (xCols: string[], yCols: string[]) => void
  showAxisBuilder?: boolean
  useCompactView?: boolean
  fillHeight?: boolean
  initialPivotConfig?: PivotConfig
  onPivotConfigChange?: (config: PivotConfig) => void
  sql?: string
  databaseName?: string
}

interface GroupedColumns {
  dates: string[]
  numbers: string[]
  categories: string[]
}

export const ChartBuilder = ({ columns, types, rows, chartType, initialXCols, initialYCols, onAxisChange, showAxisBuilder = true, useCompactView: useCompactViewProp = false, fillHeight = false, initialPivotConfig, onPivotConfigChange, sql, databaseName }: ChartBuilderProps) => {
  // Group columns by type
  const groupedColumns: GroupedColumns = useMemo(() => {
    const groups: GroupedColumns = {
      dates: [],
      numbers: [],
      categories: [],
    }

    columns.forEach((col) => {
      const type = resolveColumnType(col, columns, types)
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
      const validCols = initialXCols.filter(col => columns.includes(col))
      if (validCols.length > 0) return validCols
    }
    return groupedColumns.dates.length > 0 ? [groupedColumns.dates[0]] : []
  })

  const [yAxisColumns, setYAxisColumns] = useState<string[]>(() => {
    if (initialYCols && initialYCols.length > 0) {
      const validCols = initialYCols.filter(col => columns.includes(col))
      if (validCols.length > 0) return validCols
    }
    return groupedColumns.numbers.length > 0 ? [groupedColumns.numbers[0]] : []
  })

  // Track if user has manually changed column selection
  const [hasUserModifiedColumns, setHasUserModifiedColumns] = useState(false)

  const [draggedColumn, setDraggedColumn] = useState<string | null>(null)
  const [selectedColumnForMobile, setSelectedColumnForMobile] = useState<string | null>(null)
  const [mobileSettingsExpanded, setMobileSettingsExpanded] = useState(false)

  const isTouchDevice = useIsTouchDevice()

  // Handle drag start
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

  // Compute axis mapping for multi-X-column charts (needed for drill-down click handler)
  const axisMapping = useMemo(() => {
    if (xAxisColumns.length <= 1) return null

    const shouldReorderByCardinality = ['line', 'bar', 'area', 'scatter'].includes(chartType)

    if (shouldReorderByCardinality) {
      const cardinalities = xAxisColumns.map(col => {
        const uniqueValues = new Set(rows.map(row => String(row[col])))
        return { col, cardinality: uniqueValues.size }
      })
      cardinalities.sort((a, b) => {
        if (b.cardinality !== a.cardinality) return b.cardinality - a.cardinality
        return xAxisColumns.indexOf(a.col) - xAxisColumns.indexOf(b.col)
      })
      return {
        primaryXCol: cardinalities[0].col,
        groupingCols: cardinalities.slice(1).map(c => c.col),
      }
    } else {
      return {
        primaryXCol: xAxisColumns[0],
        groupingCols: xAxisColumns.slice(1),
      }
    }
  }, [xAxisColumns, rows, chartType])

  // Drill-down state
  const [drillDown, setDrillDown] = useState<DrillDownState | null>(null)

  const closeDrillDown = useCallback(() => setDrillDown(null), [])

  // Pivot cell click handler (called from PivotTable)
  const handlePivotCellClick = useCallback((filters: Record<string, string>, valueLabel: string, event: React.MouseEvent) => {
    console.log('Pivot drill-down:', { filters, value: valueLabel, sql })
    setDrillDown({
      filters,
      yColumn: valueLabel,
      position: { x: event.clientX, y: event.clientY },
    })
  }, [sql])

  // Drill-down click handler: translates ECharts click params to column filters
  const handleChartClick = useCallback((rawParams: unknown) => {
    const params = rawParams as { seriesName?: string; dataIndex?: number; name?: string }
    const filters: Record<string, string> = {}
    let yColumn: string | undefined

    if (chartType === 'pie' || chartType === 'funnel') {
      const xValue = params.name as string

      if (xAxisColumns.length === 1) {
        filters[xAxisColumns[0]] = xValue
      } else if (xAxisColumns.length > 1) {
        if (axisMapping) {
          filters[axisMapping.primaryXCol] = xValue
        }
      }
      yColumn = yAxisColumns.length === 1 ? yAxisColumns[0] : yAxisColumns.join(', ')
    } else {
      const dataIndex: number = params.dataIndex ?? 0
      const cleanSeriesName = (params.seriesName || '').replace(/ \([LR]\)$/, '')

      if (xAxisColumns.length === 0) {
        yColumn = cleanSeriesName
      } else if (xAxisColumns.length === 1) {
        filters[xAxisColumns[0]] = aggregatedData.xAxisData[dataIndex]
        if (yAxisColumns.length === 1) {
          yColumn = yAxisColumns[0]
        } else {
          yColumn = cleanSeriesName
        }
      } else if (axisMapping) {
        filters[axisMapping.primaryXCol] = aggregatedData.xAxisData[dataIndex]

        let groupPart = cleanSeriesName

        if (yAxisColumns.length > 1) {
          for (const yCol of yAxisColumns) {
            if (groupPart.endsWith(` - ${yCol}`)) {
              yColumn = yCol
              groupPart = groupPart.slice(0, -(` - ${yCol}`.length))
              break
            }
          }
        } else {
          yColumn = yAxisColumns[0]
        }

        const groupValues = groupPart.split(' | ')
        axisMapping.groupingCols.forEach((col, i) => {
          if (i < groupValues.length) {
            filters[col] = groupValues[i]
          }
        })
      }
    }

    if (!yColumn) yColumn = yAxisColumns[0] || ''

    // Extract mouse position from ECharts event
    const echartsParams = rawParams as { event?: { event?: MouseEvent } }
    const mouseEvent = echartsParams?.event?.event
    const x = mouseEvent?.clientX ?? 0
    const y = mouseEvent?.clientY ?? 0

    console.log('Chart drill-down:', { filters, yColumn, sql })
    setDrillDown({ filters, yColumn, position: { x, y } })
  }, [chartType, xAxisColumns, yAxisColumns, aggregatedData, axisMapping, sql])

  const hasData = yAxisColumns.length > 0

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

  // Compute formula results from pivotData + pivotConfig
  const formulaResults = useMemo(() => {
    if (!pivotData || !pivotConfig) return null
    const hasFormulas = (pivotConfig.rowFormulas?.length ?? 0) > 0 || (pivotConfig.columnFormulas?.length ?? 0) > 0
    if (!hasFormulas) return null
    return computeFormulas(pivotData, pivotConfig)
  }, [pivotData, pivotConfig])

  // Extract available top-level values for formula builder dropdowns
  const availableRowValues = useMemo(() => {
    if (!pivotData) return []
    return getUniqueTopLevelRowValues(pivotData)
  }, [pivotData])

  const availableColumnValues = useMemo(() => {
    if (!pivotData) return []
    return getUniqueTopLevelColumnValues(pivotData)
  }, [pivotData])

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
                availableRowValues={availableRowValues}
                availableColumnValues={availableColumnValues}
              />
            )}
          </>
        )}

        {/* Pivot Table */}
        <Box flex="1" overflow="hidden" display="flex" minHeight="0">
          {pivotHasData ? (
            <PivotTable
              pivotData={pivotData!}
              showHeatmap={pivotConfig?.showHeatmap !== false}
              rowDimNames={pivotConfig?.rows}
              colDimNames={pivotConfig?.columns}
              formulaResults={formulaResults}
              onCellClick={handlePivotCellClick}
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

        <DrillDownCard drillDown={drillDown} onClose={closeDrillDown} sql={sql} databaseName={databaseName} />
      </Box>
    )
  }

  return (
    <Box display="flex" flexDirection="column" gap={0} height={'100%'} width="100%">
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

      {/* Column Selector */}
      {showAxisBuilder && (
        <Box
          display={useCompactView ? (mobileSettingsExpanded ? "block" : "none") : "block"}
          flexShrink={0}
          bg="bg.muted"
          borderBottom="1px solid"
          borderColor="border.muted"
          p={3}
        >
          <HStack gap={2} flexWrap="wrap">
            {columns.map(col => (
              <ColumnChip
                key={col}
                column={col}
                type={resolveColumnType(col, columns, types)}
                isAssigned={xAxisColumns.includes(col) || yAxisColumns.includes(col)}
                isDragging={draggedColumn === col}
                isMobileSelected={selectedColumnForMobile === col}
                isTouchDevice={isTouchDevice}
                onDragStart={(e) => handleDragStart(e, col)}
                onDragEnd={handleDragEnd}
                onMobileSelect={() => handleMobileSelect(col)}
              />
            ))}
          </HStack>
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
            gap={3}
            px={3}
            pt={2}
            pb={3}
            bg="bg.muted"
            borderBottom="1px solid"
            borderColor="border.muted"
            justifyContent="center"
            alignItems="stretch"
          >
          {/* X Axis Drop Zone */}
          <DropZone label="X Axis" onDrop={handleDropX} isTouchDevice={isTouchDevice}>
            <HStack gap={1.5} flexWrap="wrap">
              {xAxisColumns.map(col => (
                <ZoneChip
                  key={col}
                  column={col}
                  type={resolveColumnType(col, columns, types)}
                  onRemove={() => removeFromX(col)}
                />
              ))}
            </HStack>
            {xAxisColumns.length === 0 && (
              <Text fontSize="xs" color="fg.subtle" fontStyle="italic">Drop columns here</Text>
            )}
          </DropZone>

          {/* Y Axis Drop Zone */}
          <DropZone label="Y Axis" onDrop={handleDropY} isTouchDevice={isTouchDevice}>
            <HStack gap={1.5} flexWrap="wrap">
              {yAxisColumns.map(col => (
                <ZoneChip
                  key={col}
                  column={col}
                  type={resolveColumnType(col, columns, types)}
                  onRemove={() => removeFromY(col)}
                />
              ))}
            </HStack>
            {yAxisColumns.length === 0 && (
              <Text fontSize="xs" color="fg.subtle" fontStyle="italic">Drop columns here</Text>
            )}
          </DropZone>
          </Box>
        )}

        {/* Chart Display */}
        <Box flex="1" overflow="hidden" display="flex" flexDirection="column" minHeight="0">
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
                      onChartClick={handleChartClick}
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
                      onChartClick={handleChartClick}
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
                      onChartClick={handleChartClick}
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
                      onChartClick={handleChartClick}
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
                      onChartClick={handleChartClick}
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
                      onChartClick={handleChartClick}
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

      <DrillDownCard drillDown={drillDown} onClose={closeDrillDown} sql={sql} databaseName={databaseName} />
    </Box>
  )
}
