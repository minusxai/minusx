'use client'

import { useState, useCallback, useMemo } from 'react'
import { Box, VStack, Text } from '@chakra-ui/react'
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
import { AxisBuilder, type AxisZone } from './AxisBuilder'
import { resolveColumnType } from './AxisComponents'
import { aggregateData } from '@/lib/chart/aggregate-data'
import { aggregatePivotData, computeFormulas, getUniqueTopLevelRowValues, getUniqueTopLevelColumnValues } from '@/lib/chart/pivot-utils'
import type { PivotConfig, ColumnFormatConfig } from '@/lib/types'

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
  initialColumnFormats?: Record<string, ColumnFormatConfig>
  onColumnFormatsChange?: (formats: Record<string, ColumnFormatConfig>) => void
  settingsExpanded?: boolean
}

interface GroupedColumns {
  dates: string[]
  numbers: string[]
  categories: string[]
}

export const ChartBuilder = ({ columns, types, rows, chartType, initialXCols, initialYCols, onAxisChange, showAxisBuilder = true, useCompactView: useCompactViewProp = false, fillHeight = false, initialPivotConfig, onPivotConfigChange, sql, databaseName, initialColumnFormats, onColumnFormatsChange, settingsExpanded: settingsExpandedProp }: ChartBuilderProps) => {
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



  // Column format config
  const [columnFormats, setColumnFormats] = useState<Record<string, ColumnFormatConfig>>(initialColumnFormats || {})

  const handleColumnFormatChange = useCallback((column: string, config: ColumnFormatConfig) => {
    const isEmpty = !config.alias && config.decimalPoints === undefined && !config.dateFormat
    setColumnFormats(prev => {
      const next = { ...prev }
      if (isEmpty) {
        delete next[column]
      } else {
        next[column] = config
      }
      onColumnFormatsChange?.(next)
      return next
    })
  }, [onColumnFormatsChange])

  // Helper: resolve display name using alias
  const getDisplayName = useCallback((col: string) => columnFormats[col]?.alias || col, [columnFormats])

  // Build a y-axis label that fits on ~1 line (~40 chars),
  // showing as many column names as fit and "(and X other metrics)" for the rest
  const buildYAxisLabel = useCallback((cols: string[]): string => {
    if (cols.length === 0) return ''
    const names = cols.map(getDisplayName)
    if (cols.length === 1) return names[0]

    const maxLength = 60
    const separator = ' | '
    let label = names[0]
    let includedCount = 1

    for (let i = 1; i < names.length; i++) {
      const remaining = names.length - includedCount - 1
      const suffix = remaining > 0 ? `${separator}(+ ${remaining} other metric${remaining > 1 ? 's' : ''})` : ''
      const candidate = `${label}${separator}${names[i]}`

      if (candidate.length + suffix.length > maxLength) break
      label = candidate
      includedCount++
    }

    const excluded = names.length - includedCount
    if (excluded > 0) {
      label += `${separator}(+ ${excluded} other metric${excluded > 1 ? 's' : ''})`
    }
    return label
  }, [getDisplayName])

  // Handle drop on X axis
  const handleDropX = useCallback((col: string) => {
    if (!xAxisColumns.includes(col)) {
      const newXCols = [...xAxisColumns, col]
      setXAxisColumns(newXCols)
      setHasUserModifiedColumns(true)
      onAxisChange?.(newXCols, yAxisColumns)
    }
  }, [xAxisColumns, yAxisColumns, onAxisChange])

  // Handle drop on Y axis
  const handleDropY = useCallback((col: string) => {
    if (!yAxisColumns.includes(col)) {
      const newYCols = [...yAxisColumns, col]
      setYAxisColumns(newYCols)
      setHasUserModifiedColumns(true)
      onAxisChange?.(xAxisColumns, newYCols)
    }
  }, [yAxisColumns, xAxisColumns, onAxisChange])

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

  // Build axis zones for AxisBuilder
  const chartZones: AxisZone[] = useMemo(() => [
    {
      label: 'X Axis',
      items: xAxisColumns.map(col => ({ column: col })),
      emptyText: 'Drop columns here',
      onDrop: handleDropX,
      onRemove: removeFromX,
    },
    {
      label: 'Y Axis',
      items: yAxisColumns.map(col => ({ column: col })),
      emptyText: 'Drop columns here',
      onDrop: handleDropY,
      onRemove: removeFromY,
    },
  ], [xAxisColumns, yAxisColumns, handleDropX, handleDropY, removeFromX, removeFromY])

  // Aggregate data
  const aggregatedData = useMemo(() => {
    return aggregateData(rows, xAxisColumns, yAxisColumns, chartType)
  }, [rows, xAxisColumns, yAxisColumns, chartType])

  // Compute axis mapping for multi-X-column charts (needed for drill-down click handler)
  const axisMapping = useMemo(() => {
    if (xAxisColumns.length <= 1) return null

    // const shouldReorderByCardinality = ['line', 'bar', 'area', 'scatter'].includes(chartType)
    const shouldReorderByCardinality = false

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
  if (isPivot) {
    return (
      <Box display="flex" flexDirection="column" gap={0} height="100%" width="100%">
        {showAxisBuilder && settingsExpandedProp && (
          <PivotAxisBuilder
            columns={columns}
            types={types}
            pivotConfig={pivotConfig}
            onPivotConfigChange={handlePivotConfigChange}
            useCompactView={useCompactView}
            availableRowValues={availableRowValues}
            availableColumnValues={availableColumnValues}
            columnFormats={columnFormats}
            onColumnFormatChange={handleColumnFormatChange}
          />
        )}

        {/* Pivot Table */}
        <Box flex="1" overflow="hidden" display="flex" minHeight="0">
          {pivotHasData ? (
            <PivotTable
              pivotData={pivotData!}
              showRowTotals={pivotConfig?.showRowTotals !== false}
              showColTotals={pivotConfig?.showColumnTotals !== false}
              showHeatmap={pivotConfig?.showHeatmap !== false}
              rowDimNames={pivotConfig?.rows.map(col => columnFormats[col]?.alias || col)}
              colDimNames={pivotConfig?.columns.map(col => columnFormats[col]?.alias || col)}
              formulaResults={formulaResults}
              onCellClick={handlePivotCellClick}
              columnFormats={columnFormats}
              valueColumns={pivotConfig?.values.map(v => v.column)}
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
      {/* Axis Builder (column palette + drop zones) */}
      {showAxisBuilder && (!useCompactView || settingsExpandedProp) && (
        <AxisBuilder columns={columns} types={types} zones={chartZones} columnFormats={columnFormats} onColumnFormatChange={handleColumnFormatChange} />
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
                      xAxisLabel={getDisplayName(xAxisColumns[0])}
                      yAxisLabel={buildYAxisLabel(yAxisColumns)}
                      xAxisColumns={xAxisColumns}
                      columnFormats={columnFormats}
                      yAxisColumns={yAxisColumns}
                      height={useCompactView && !fillHeight ? 300 : undefined}
                      onChartClick={handleChartClick}
                    />
                  )}
                  {chartType === 'bar' && (
                    <BarPlot
                      xAxisData={aggregatedData.xAxisData}
                      series={aggregatedData.series}
                      xAxisLabel={getDisplayName(xAxisColumns[0])}
                      yAxisLabel={buildYAxisLabel(yAxisColumns)}
                      xAxisColumns={xAxisColumns}
                      columnFormats={columnFormats}
                      yAxisColumns={yAxisColumns}
                      height={useCompactView && !fillHeight ? 300 : undefined}
                      onChartClick={handleChartClick}
                    />
                  )}
                  {chartType === 'area' && (
                    <AreaPlot
                      xAxisData={aggregatedData.xAxisData}
                      series={aggregatedData.series}
                      xAxisLabel={getDisplayName(xAxisColumns[0])}
                      yAxisLabel={buildYAxisLabel(yAxisColumns)}
                      xAxisColumns={xAxisColumns}
                      columnFormats={columnFormats}
                      yAxisColumns={yAxisColumns}
                      height={useCompactView && !fillHeight ? 300 : undefined}
                      onChartClick={handleChartClick}
                    />
                  )}
                  {chartType === 'scatter' && (
                    <ScatterPlot
                      xAxisData={aggregatedData.xAxisData}
                      series={aggregatedData.series}
                      xAxisLabel={getDisplayName(xAxisColumns[0])}
                      yAxisLabel={buildYAxisLabel(yAxisColumns)}
                      xAxisColumns={xAxisColumns}
                      columnFormats={columnFormats}
                      yAxisColumns={yAxisColumns}
                      height={useCompactView && !fillHeight ? 300 : undefined}
                      onChartClick={handleChartClick}
                    />
                  )}
                  {chartType === 'funnel' && (
                    <FunnelPlot
                      xAxisData={aggregatedData.xAxisData}
                      series={aggregatedData.series}
                      xAxisLabel={getDisplayName(xAxisColumns[0])}
                      yAxisLabel={buildYAxisLabel(yAxisColumns)}
                      xAxisColumns={xAxisColumns}
                      columnFormats={columnFormats}
                      yAxisColumns={yAxisColumns}
                      height={useCompactView && !fillHeight ? 300 : undefined}
                      onChartClick={handleChartClick}
                    />
                  )}
                  {chartType === 'pie' && (
                    <PiePlot
                      xAxisData={aggregatedData.xAxisData}
                      series={aggregatedData.series}
                      xAxisLabel={getDisplayName(xAxisColumns[0])}
                      yAxisLabel={buildYAxisLabel(yAxisColumns)}
                      xAxisColumns={xAxisColumns}
                      columnFormats={columnFormats}
                      yAxisColumns={yAxisColumns}
                      height={useCompactView && !fillHeight ? 300 : undefined}
                      onChartClick={handleChartClick}
                    />
                  )}
                  {chartType === 'trend' && (
                    <TrendPlot series={aggregatedData.series} columnFormats={columnFormats} yAxisColumns={yAxisColumns} />
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
                  Drag at least one column to Y Axis to see aggregated values
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
