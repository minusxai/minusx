'use client'

import { useState, useCallback, useMemo } from 'react'
import { Box, HStack, VStack, Text } from '@chakra-ui/react'
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
import { WaterfallPlot } from './WaterfallPlot'
import { RadarPlot } from './RadarPlot'
import { ComboPlot } from './ComboPlot'
import { ChartError } from './ChartError'
import { DrillDownCard, type DrillDownState } from './DrillDownCard'
import { AxisBuilder, type AxisZone } from './AxisBuilder'
import { resolveColumnType } from './AxisComponents'
import { aggregateData } from '@/lib/chart/aggregate-data'
import { aggregatePivotData, computeFormulas, getUniqueTopLevelRowValues, getUniqueTopLevelColumnValues, getUniqueRowValuesAtLevel } from '@/lib/chart/pivot-utils'
import type { PivotConfig, ColumnFormatConfig, AxisConfig, VisualizationStyleConfig } from '@/lib/types'
import type { VizSettings } from '@/lib/types.gen'
import { getTimestamp } from '@/lib/chart/chart-utils'
import { getEffectiveColorPalette } from '@/lib/chart/echarts-theme'
import { StyleConfigPopover } from './StyleConfigPopover'
import { AnnotationEditor } from './AnnotationEditor'
import type { CompanyBranding } from '@/lib/branding/whitelabel'
import type { ChartAnnotation } from '@/lib/types'
import { clientChartImageRenderer } from '@/lib/chart/ChartImageRenderer.client'
import { useAppSelector } from '@/store/hooks'

interface ChartBuilderProps {
  columns: string[]
  types: string[]
  rows: Record<string, any>[]
  chartType: 'line' | 'bar' | 'area' | 'scatter' | 'funnel' | 'pie' | 'pivot' | 'trend' | 'waterfall' | 'combo' | 'radar'
  initialXCols?: string[]
  initialYCols?: string[]
  initialYRightCols?: string[]
  onAxisChange?: (xCols: string[], yCols: string[]) => void
  onYRightColsChange?: (yRightCols: string[]) => void
  showAxisBuilder?: boolean
  useCompactView?: boolean
  fillHeight?: boolean
  initialPivotConfig?: PivotConfig
  onPivotConfigChange?: (config: PivotConfig) => void
  sql?: string
  databaseName?: string
  initialColumnFormats?: Record<string, ColumnFormatConfig>
  onColumnFormatsChange?: (formats: Record<string, ColumnFormatConfig>) => void
  initialTooltipCols?: string[]
  onTooltipColsChange?: (cols: string[]) => void
  settingsExpanded?: boolean
  showChartTitle?: boolean
  styleConfig?: VisualizationStyleConfig
  onStyleConfigChange?: (config: VisualizationStyleConfig) => void
  axisConfig?: AxisConfig
  onAxisConfigChange?: (config: AxisConfig) => void
  annotations?: ChartAnnotation[]
  onAnnotationsChange?: (annotations: ChartAnnotation[]) => void
  exportBranding?: Partial<CompanyBranding>
}

interface GroupedColumns {
  dates: string[]
  numbers: string[]
  categories: string[]
}

export const ChartBuilder = ({ columns, types, rows, chartType, initialXCols, initialYCols, initialYRightCols, onAxisChange, onYRightColsChange, showAxisBuilder = true, useCompactView: useCompactViewProp = false, fillHeight = false, initialPivotConfig, onPivotConfigChange, sql, databaseName, initialColumnFormats, onColumnFormatsChange, initialTooltipCols, onTooltipColsChange, settingsExpanded: settingsExpandedProp, showChartTitle = true, styleConfig, onStyleConfigChange, axisConfig, onAxisConfigChange, annotations, onAnnotationsChange, exportBranding }: ChartBuilderProps) => {
  const colorMode = useAppSelector((state) => state.ui.colorMode) as 'light' | 'dark'
  const colorPalette = useMemo(() => getEffectiveColorPalette(styleConfig?.colors), [styleConfig?.colors])

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

  // Auto-select columns: always derived from props so agent edits immediately take effect
  const xAxisColumns = useMemo<string[]>(() => {
    if (initialXCols !== undefined) {
      const validCols = initialXCols.filter(col => columns.includes(col))
      if (validCols.length > 0 || initialXCols.length === 0) return validCols
    }
    return groupedColumns.dates.length > 0 ? [groupedColumns.dates[0]] : []
  }, [initialXCols, columns, groupedColumns])

  const yAxisColumns = useMemo<string[]>(() => {
    if (initialYCols !== undefined) {
      const validCols = initialYCols.filter(col => columns.includes(col))
      if (validCols.length > 0 || initialYCols.length === 0) return validCols
    }
    return groupedColumns.numbers.length > 0 ? [groupedColumns.numbers[0]] : []
  }, [initialYCols, columns, groupedColumns])

  const isDualAxis = axisConfig?.dualAxis === true

  const yRightColumns = useMemo<string[]>(() => {
    if (!isDualAxis) return []
    if (initialYRightCols !== undefined) {
      return initialYRightCols.filter(col => columns.includes(col))
    }
    return []
  }, [isDualAxis, initialYRightCols, columns])

  // Column format config — always derived from props
  const columnFormats = useMemo<Record<string, ColumnFormatConfig>>(() => initialColumnFormats ?? {}, [initialColumnFormats])
  const tooltipColumns = useMemo<string[]>(() => {
    if (initialTooltipCols !== undefined) {
      return initialTooltipCols.filter(col => columns.includes(col))
    }
    return []
  }, [initialTooltipCols, columns])
  const supportsAnnotations = ['line', 'bar', 'area', 'scatter'].includes(chartType) && xAxisColumns.length === 1

  const handleColumnFormatChange = useCallback((column: string, config: ColumnFormatConfig) => {
    const isEmpty = !config.alias && config.decimalPoints === undefined && !config.dateFormat && !config.prefix && !config.suffix
    const next = { ...(initialColumnFormats ?? {}) }
    if (isEmpty) {
      delete next[column]
    } else {
      next[column] = config
    }
    onColumnFormatsChange?.(next)
  }, [initialColumnFormats, onColumnFormatsChange])

  // Helper: resolve display name using alias
  const getDisplayName = useCallback((col: string) => columnFormats[col]?.alias || col, [columnFormats])

  // Build chart title from axis columns using aliases
  const chartTitle = useMemo(() => {
    if (yAxisColumns.length === 0 && xAxisColumns.length === 0) return undefined
    const yTitleOverride = axisConfig?.yTitle?.trim()
    const yPart = yTitleOverride || yAxisColumns.map(getDisplayName).join(', ')
    const xPart = xAxisColumns.length > 0 ? getDisplayName(xAxisColumns[0]) : ''
    const splitPart = xAxisColumns.length > 1 ? xAxisColumns.slice(1).map(getDisplayName).join(', ') : ''
    const parts = [yPart, xPart && `vs ${xPart}`, splitPart && `split by ${splitPart}`].filter(Boolean).join(' ')
    return parts || undefined
  }, [axisConfig?.yTitle, xAxisColumns, yAxisColumns, getDisplayName])

  // Build a y-axis label that fits on ~1 line (~40 chars),
  // showing as many column names as fit and "(and X other metrics)" for the rest
  const buildYAxisLabel = useCallback((cols: string[]): string => {
    if (cols.length === 0) return ''
    const names = cols.map(getDisplayName)
    if (cols.length === 1) return names[0]

    const tokenize = (value: string) => value
      .split(/\s+/)
      .map(token => token.trim())
      .filter(Boolean)

    const firstTokens = tokenize(names[0])
    let commonTokens = [...firstTokens]

    for (const name of names.slice(1)) {
      const tokens = tokenize(name)
      let shared = 0
      while (shared < commonTokens.length && shared < tokens.length && commonTokens[shared] === tokens[shared]) {
        shared++
      }
      commonTokens = commonTokens.slice(0, shared)
      if (commonTokens.length === 0) break
    }

    let commonLabel = commonTokens.join(' ').trim()
    commonLabel = commonLabel.replace(/[\s(|,-]+$/, '').trim()

    if (commonLabel.length >= 6) return commonLabel

    const firstName = names[0]
    const remaining = names.length - 1
    if (remaining === 0) return firstName
    return `${firstName} (+${remaining})`
  }, [getDisplayName])

  // Handle drop on X Axis (primary): demotes current primary to Split By
  const handleDropXPrimary = useCallback((col: string) => {
    if (xAxisColumns[0] === col) return
    const remaining = xAxisColumns.filter(c => c !== col)
    onAxisChange?.([col, ...remaining], yAxisColumns)
  }, [xAxisColumns, yAxisColumns, onAxisChange])

  // Handle drop on Split By: appends to grouping columns
  const handleDropSplitBy = useCallback((col: string) => {
    if (xAxisColumns.includes(col)) return
    onAxisChange?.([...xAxisColumns, col], yAxisColumns)
  }, [xAxisColumns, yAxisColumns, onAxisChange])

  // Handle drop on Y axis
  const handleDropY = useCallback((col: string) => {
    if (!yAxisColumns.includes(col)) {
      onAxisChange?.(xAxisColumns, [...yAxisColumns, col])
    }
  }, [yAxisColumns, xAxisColumns, onAxisChange])

  // Remove from X Axis (primary): rest shift up
  const removeFromXPrimary = useCallback((column: string) => {
    onAxisChange?.(xAxisColumns.filter(c => c !== column), yAxisColumns)
  }, [xAxisColumns, yAxisColumns, onAxisChange])

  // Remove from Split By
  const removeFromSplitBy = useCallback((column: string) => {
    onAxisChange?.(xAxisColumns.filter(c => c !== column), yAxisColumns)
  }, [xAxisColumns, yAxisColumns, onAxisChange])

  const removeFromY = useCallback((column: string) => {
    onAxisChange?.(xAxisColumns, yAxisColumns.filter(c => c !== column))
  }, [yAxisColumns, xAxisColumns, onAxisChange])

  // Handle drop/remove on Y Right axis
  const handleDropYRight = useCallback((col: string) => {
    if (!yRightColumns.includes(col)) {
      onYRightColsChange?.([...yRightColumns, col])
    }
  }, [yRightColumns, onYRightColsChange])

  const removeFromYRight = useCallback((column: string) => {
    onYRightColsChange?.(yRightColumns.filter(c => c !== column))
  }, [yRightColumns, onYRightColsChange])

  const handleDropTooltip = useCallback((col: string) => {
    if (!tooltipColumns.includes(col)) {
      onTooltipColsChange?.([...tooltipColumns, col])
    }
  }, [tooltipColumns, onTooltipColsChange])

  const removeFromTooltip = useCallback((column: string) => {
    onTooltipColsChange?.(tooltipColumns.filter(c => c !== column))
  }, [tooltipColumns, onTooltipColsChange])

  // Build axis zones for AxisBuilder
  const chartZones: AxisZone[] = useMemo(() => {
    const xAxisZone: AxisZone = {
      label: 'X Axis',
      items: xAxisColumns.length > 0 ? [{ column: xAxisColumns[0] }] : [],
      emptyText: 'Drop a column here',
      onDrop: handleDropXPrimary,
      onRemove: removeFromXPrimary,
    }
    const splitByZone: AxisZone = {
      label: 'Split By',
      items: xAxisColumns.slice(1).map(col => ({ column: col })),
      emptyText: 'Group into series',
      onDrop: handleDropSplitBy,
      onRemove: removeFromSplitBy,
    }
    const tooltipZone: AxisZone = {
      label: 'Tooltip',
      items: tooltipColumns.map(col => ({ column: col })),
      emptyText: 'Extra fields for hover details',
      onDrop: handleDropTooltip,
      onRemove: removeFromTooltip,
    }

    if (isDualAxis) {
      return [
        xAxisZone,
        splitByZone,
        {
          label: 'Y Left',
          items: yAxisColumns.map(col => ({ column: col })),
          emptyText: 'Drop columns here',
          onDrop: handleDropY,
          onRemove: removeFromY,
        },
        {
          label: 'Y Right',
          items: yRightColumns.map(col => ({ column: col })),
          emptyText: 'Drop columns here',
          onDrop: handleDropYRight,
          onRemove: removeFromYRight,
        },
        tooltipZone,
      ]
    }

    return [
      xAxisZone,
      splitByZone,
      {
        label: 'Y Axis',
        items: yAxisColumns.map(col => ({ column: col })),
        emptyText: 'Drop columns here',
        onDrop: handleDropY,
        onRemove: removeFromY,
      },
      tooltipZone,
    ]
  }, [xAxisColumns, yAxisColumns, yRightColumns, isDualAxis, tooltipColumns, handleDropXPrimary, handleDropSplitBy, handleDropY, handleDropYRight, handleDropTooltip, removeFromXPrimary, removeFromSplitBy, removeFromY, removeFromYRight, removeFromTooltip])

  // Aggregate data — combine left + right Y columns so all series are produced
  const allYColumns = useMemo(() => {
    if (!isDualAxis || yRightColumns.length === 0) return yAxisColumns
    return [...yAxisColumns, ...yRightColumns]
  }, [isDualAxis, yAxisColumns, yRightColumns])

  const aggregatedData = useMemo(() => {
    return aggregateData(rows, xAxisColumns, allYColumns, chartType, tooltipColumns)
  }, [rows, xAxisColumns, allYColumns, chartType, tooltipColumns])

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

    if (chartType === 'pie' || chartType === 'funnel' || chartType === 'radar') {
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

  // Download image: render current chart to JPEG and trigger browser download
  const onDownloadImage = useCallback(async () => {
    const queryResult = { columns, types, rows }
    const vizSettings: VizSettings = {
      type: chartType as VizSettings['type'],
      xCols: xAxisColumns,
      yCols: yAxisColumns,
      columnFormats: Object.keys(columnFormats).length > 0 ? columnFormats : undefined,
    }
    const rendered = await clientChartImageRenderer.renderCharts(
      [{ queryResult, vizSettings }],
      { width: window.innerWidth, colorMode, addWatermark: true },
    )
    if (rendered.length === 0) return
    const link = document.createElement('a')
    link.href = rendered[0].dataUrl
    link.download = `chart-${getTimestamp()}.jpg`
    link.click()
  }, [columns, types, rows, chartType, xAxisColumns, yAxisColumns, columnFormats, colorMode])

  // Viz type constraint validation
  const constraintError = useMemo((): string | null => {
    switch (chartType) {
      case 'combo':
        if (allYColumns.length < 2) return 'Combo charts require at least 2 Y-axis columns (first becomes bar, rest become lines).'
        if (xAxisColumns.length < 1) return 'Combo charts require at least 1 X-axis column.'
        return null
      case 'waterfall':
        if (xAxisColumns.length > 1) return 'Waterfall charts support only a single X-axis column. Remove extra columns from the X axis to continue.'
        if (allYColumns.length > 1) return 'Waterfall charts support only a single Y-axis column. Remove extra columns from the Y axis to continue.'
        return null
      case 'pie':
        if (xAxisColumns.length < 1) return 'Pie charts require at least 1 X-axis column for grouping.'
        return null
      case 'funnel':
        if (xAxisColumns.length < 1) return 'Funnel charts require at least 1 X-axis column for grouping.'
        return null
      case 'radar':
        if (xAxisColumns.length < 1) return 'Radar charts require at least 1 X-axis column for indicators.'
        return null
      default:
        return null
    }
  }, [chartType, xAxisColumns.length, allYColumns.length])

  const hasData = allYColumns.length > 0

  // Use the compact view flag passed from parent
  const useCompactView = useCompactViewProp

  // Pivot config — always derived from props so agent edits immediately take effect
  const pivotConfig = initialPivotConfig

  const handlePivotConfigChange = useCallback((config: PivotConfig) => {
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

  // Multi-level dimension info for row formula builder
  const rowDimensions = useMemo(() => {
    if (!pivotData || !pivotConfig || pivotConfig.rows.length < 2) return undefined
    return pivotConfig.rows.map((col, level) => ({
      name: col,
      level,
      availableValues: getUniqueRowValuesAtLevel(pivotData, level),
    }))
  }, [pivotData, pivotConfig])

  const getRowValuesAtLevel = useCallback((level: number, parentValues?: string[]) => {
    if (!pivotData) return []
    return getUniqueRowValuesAtLevel(pivotData, level, parentValues)
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
            rowDimensions={rowDimensions}
            getRowValuesAtLevel={getRowValuesAtLevel}
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
              compact={pivotConfig?.compact === true}
              heatmapScale={(pivotConfig?.heatmapScale as 'red-yellow-green' | 'green' | 'blue') ?? 'red-yellow-green'}
              rowDimNames={pivotConfig?.rows.map(col => columnFormats[col]?.alias || col)}
              colDimNames={pivotConfig?.columns.map(col => columnFormats[col]?.alias || col)}
              formulaResults={formulaResults}
              onCellClick={handlePivotCellClick}
              columnFormats={columnFormats}
              valueColumns={pivotConfig?.values.map(v => v.column)}
            />
          ) : (
            <ChartError
              variant="info"
              title="No data to display"
              message="Drag columns to Rows, Columns, and Values to build your pivot table"
            />
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
        <AxisBuilder
          columns={columns}
          types={types}
          zones={chartZones}
          columnFormats={columnFormats}
          onColumnFormatChange={handleColumnFormatChange}
          axisConfig={axisConfig}
          onAxisConfigChange={onAxisConfigChange}
          chartType={chartType}
          stylePanel={onStyleConfigChange ? (
            <StyleConfigPopover
              chartType={chartType}
              styleConfig={styleConfig}
              numSeries={aggregatedData.series.length}
              onChange={onStyleConfigChange}
              displayMode="inline"
            />
          ) : undefined}
          annotationPanel={onAnnotationsChange ? (
            <AnnotationEditor
              annotations={annotations}
              onChange={onAnnotationsChange}
              enabled={supportsAnnotations}
              xOptions={aggregatedData.xAxisData}
              seriesOptions={aggregatedData.series.map(item => item.name)}
            />
          ) : undefined}
        />
      )}

      {/* Chart Area */}
      <VStack flex="1" align="stretch" gap={0} minWidth={0} overflow="hidden" minHeight="0" height={useCompactView ? "auto" : undefined}>
        {/* Column Conflict Warning */}
        {columnConflicts.length > 0 && (
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
          {constraintError ? (
            <ChartError message={constraintError} />
          ) : hasData ? (
            <>
              {/* Show SingleValue when no X-axis columns selected */}
              {xAxisColumns.length === 0 ? (
                <SingleValue series={aggregatedData.series} />
              ) : (
                <Box width="100%" flex="1" display="flex" alignItems="center" justifyContent="center" minWidth="100px" minHeight="0">
                  {(() => {
                    const sharedProps = {
                      xAxisData: aggregatedData.xAxisData,
                      series: aggregatedData.series,
                      xAxisLabel: getDisplayName(xAxisColumns[0]),
                      yAxisLabel: buildYAxisLabel(yAxisColumns),
                      xAxisColumns,
                      pointMeta: aggregatedData.pointMeta,
                      tooltipColumns,
                      columnFormats,
                      yAxisColumns,
                      yRightCols: yRightColumns,
                      height: useCompactView && !fillHeight ? 300 : undefined,
                      onChartClick: handleChartClick,
                      chartTitle,
                      showChartTitle,
                      colorPalette,
                      axisConfig,
                      styleConfig,
                      annotations,
                      exportBranding,
                      onDownloadImage,
                    }
                    if (chartType === 'trend') return <TrendPlot series={aggregatedData.series} columnFormats={columnFormats} yAxisColumns={yAxisColumns} xAxisColumns={xAxisColumns} />
                    const plotMap = { line: LinePlot, bar: BarPlot, combo: ComboPlot, area: AreaPlot, scatter: ScatterPlot, funnel: FunnelPlot, pie: PiePlot, waterfall: WaterfallPlot, radar: RadarPlot } as const
                    const Plot = plotMap[chartType as keyof typeof plotMap]
                    if (Plot) return <Plot {...sharedProps} />
                    return null
                  })()}
                </Box>
              )}
            </>
          ) : (
            <ChartError
              variant="info"
              title="No data to display"
              message="Drag at least one column to Y Axis to see aggregated values"
            />
          )}
        </Box>
      </VStack>

      <DrillDownCard drillDown={drillDown} onClose={closeDrillDown} sql={sql} databaseName={databaseName} />
    </Box>
  )
}
