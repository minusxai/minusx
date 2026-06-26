'use client'

import { useState, useCallback, useMemo, useEffect } from 'react'
import { Box, VStack, Text } from '@chakra-ui/react'
import { LinePlot } from './LinePlot'
import { BarPlot } from './BarPlot'
import { RowPlot } from './RowPlot'
import { AreaPlot } from './AreaPlot'
import { ScatterPlot } from './ScatterPlot'
import { FunnelPlot } from './FunnelPlot'
import { PiePlot } from './PiePlot'
import { PivotTable } from './PivotTable'
import { SingleValue } from './SingleValue'
import { TrendPlot } from './TrendPlot'
import { WaterfallPlot } from './WaterfallPlot'
import { RadarPlot } from './RadarPlot'
import { ComboPlot } from './ComboPlot'
import { ChartError } from './ChartError'
import { DrillDownCard, type DrillDownState } from './DrillDownCard'
import { resolveColumnType } from './AxisComponents'
import { aggregateData } from '@/lib/chart/aggregate-data'
import { aggregatePivotData, computeFormulas, getUniqueTopLevelRowValues, getUniqueTopLevelColumnValues, getUniqueRowValuesAtLevel } from '@/lib/chart/pivot-utils'
import type { PivotConfig, ColumnFormatConfig, AxisConfig, VisualizationStyleConfig, TrendConfig, SingleValueConfig, VisualizationType } from '@/lib/types'
import type { GeoConfig } from '@/lib/types'
import type { VizSettings } from '@/lib/validation/atlas-schemas'
import { getTimestamp, buildCompactYLabel } from '@/lib/chart/chart-utils'
import { getVizConstraintError } from '@/lib/chart/viz-constraints'
import { getGeoConstraintError } from '@/lib/chart/geo-constraints'
import { getEffectiveColorPalette } from '@/lib/chart/echarts-theme'
import type { OrgBranding } from '@/lib/branding/whitelabel'
import type { ChartAnnotation } from '@/lib/types'
import { clientChartImageRenderer } from '@/lib/chart/ChartImageRenderer.client'
import { useAppSelector } from '@/store/hooks'
import { useConfigs } from '@/lib/hooks/useConfigs'
import { buildColumnTypesMap } from '@/lib/database/column-types'
import dynamic from 'next/dynamic'

// GeoPlot imports leaflet.heat which accesses `window` at module evaluation time — ssr:false prevents
// this module from being evaluated on the server during Next.js prerendering.
// eslint-disable-next-line no-restricted-syntax
const GeoPlot = dynamic(() => import('./GeoPlot').then((m) => ({ default: m.GeoPlot })), { ssr: false })

interface ChartBuilderProps {
  columns: string[]
  types: string[]
  rows: Record<string, any>[]
  chartType: Exclude<VisualizationType, 'table'>
  initialXCols?: string[]
  initialYCols?: string[]
  initialYRightCols?: string[]
  onAxisChange?: (xCols: string[], yCols: string[]) => void
  onYRightColsChange?: (yRightCols: string[]) => void
  fillHeight?: boolean
  initialPivotConfig?: PivotConfig
  onPivotConfigChange?: (config: PivotConfig) => void
  initialGeoConfig?: GeoConfig
  onGeoConfigChange?: (config: GeoConfig) => void
  sql?: string
  databaseName?: string
  initialColumnFormats?: Record<string, ColumnFormatConfig>
  onColumnFormatsChange?: (formats: Record<string, ColumnFormatConfig>) => void
  initialTooltipCols?: string[]
  onTooltipColsChange?: (cols: string[]) => void
  showChartTitle?: boolean
  styleConfig?: VisualizationStyleConfig
  onStyleConfigChange?: (config: VisualizationStyleConfig) => void
  axisConfig?: AxisConfig
  onAxisConfigChange?: (config: AxisConfig) => void
  annotations?: ChartAnnotation[]
  onAnnotationsChange?: (annotations: ChartAnnotation[]) => void
  trendConfig?: TrendConfig
  onTrendConfigChange?: (config: TrendConfig) => void
  singleValueConfig?: SingleValueConfig
  exportBranding?: Partial<OrgBranding>
  /** Click-to-drill-down on data points. Off for read-only embeds (shared story). */
  enableDrilldown?: boolean
  /** Receives a getter for the live geo map's center/zoom once the map mounts. Lets a parent wire the "Pin current view" button (which lives in a sibling config panel) to this map. */
  onMapReady?: (getView: () => { center: [number, number]; zoom: number } | null) => void
  /** Reports the number of rendered series whenever it changes. Lets a parent feed the exact count to a sibling config panel (color swatches) without re-aggregating the rows. */
  onSeriesCountChange?: (count: number) => void
}

interface GroupedColumns {
  dates: string[]
  numbers: string[]
  categories: string[]
}

export const ChartBuilder = ({ columns, types, rows, chartType, initialXCols, initialYCols, initialYRightCols, onAxisChange, onYRightColsChange, fillHeight = false, initialPivotConfig, onPivotConfigChange, initialGeoConfig, onGeoConfigChange, sql, databaseName, initialColumnFormats, onColumnFormatsChange, initialTooltipCols, onTooltipColsChange, showChartTitle = true, styleConfig, onStyleConfigChange, axisConfig, onAxisConfigChange, annotations, onAnnotationsChange, trendConfig, onTrendConfigChange, singleValueConfig, exportBranding, enableDrilldown = true, onMapReady, onSeriesCountChange }: ChartBuilderProps) => {
  const colorMode = useAppSelector((state) => state.ui.colorMode) as 'light' | 'dark'
  const { config } = useConfigs()
  const configPalette = config.chartColorPalette
  const colorPalette = useMemo(() => getEffectiveColorPalette(styleConfig?.colors, configPalette), [styleConfig?.colors, configPalette])
  const columnTypes = useMemo(() => buildColumnTypesMap(columns, types), [columns, types])

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

  // Helper: resolve display name using alias
  const getDisplayName = useCallback((col: string) => columnFormats[col]?.alias || col, [columnFormats])

  // Build chart title from axis columns using aliases
  const chartTitle = useMemo(() => {
    if (yAxisColumns.length === 0 && xAxisColumns.length === 0) return undefined
    const yTitleOverride = axisConfig?.yTitle?.trim()
    const yNames = yAxisColumns.map(getDisplayName)
    // Title has more horizontal space — show up to 2 names
    const yPart = yTitleOverride || buildCompactYLabel(yNames, 2)
    const xPart = xAxisColumns.length > 0 ? getDisplayName(xAxisColumns[0]) : ''
    const splitPart = xAxisColumns.length > 1 ? xAxisColumns.slice(1).map(getDisplayName).join(', ') : ''
    const parts = [yPart, xPart && `vs ${xPart}`, splitPart && `split by ${splitPart}`].filter(Boolean).join(' ')
    return parts || undefined
  }, [axisConfig?.yTitle, xAxisColumns, yAxisColumns, getDisplayName])


  // Aggregate data — combine left + right Y columns so all series are produced
  const allYColumns = useMemo(() => {
    if (!isDualAxis || yRightColumns.length === 0) return yAxisColumns
    return [...yAxisColumns, ...yRightColumns]
  }, [isDualAxis, yAxisColumns, yRightColumns])

  const aggregatedData = useMemo(() => {
    return aggregateData(rows, xAxisColumns, allYColumns, chartType, tooltipColumns, columnTypes)
  }, [rows, xAxisColumns, allYColumns, chartType, tooltipColumns, columnTypes])

  // Number of distinct colors the chart actually paints, reported up so a sibling
  // config panel can size its color swatches without re-aggregating the rows.
  // Pie colors one slice per category (xAxisData); every other chart type colors
  // one entry per value series.
  const renderedColorCount = useMemo(
    () => (chartType === 'pie' ? aggregatedData.xAxisData.length : aggregatedData.series.length),
    [chartType, aggregatedData.xAxisData.length, aggregatedData.series.length],
  )
  useEffect(() => {
    onSeriesCountChange?.(renderedColorCount)
  }, [renderedColorCount, onSeriesCountChange])

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

      if (chartType === 'pie' && xAxisColumns.length === 2 && params.seriesName === 'Outer') {
        // Nested pie outer ring: name is "PrimaryX — SplitByValue"
        const parts = xValue.split(' — ')
        if (parts.length === 2) {
          filters[xAxisColumns[0]] = parts[0]
          filters[xAxisColumns[1]] = parts[1]
        }
      } else if (xAxisColumns.length === 1) {
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
      { width: window.innerWidth, colorMode, addWatermark: true, padding: true },
    )
    if (rendered.length === 0) return
    const link = document.createElement('a')
    link.href = rendered[0].dataUrl
    link.download = `chart-${getTimestamp()}.jpg`
    link.click()
  }, [columns, types, rows, chartType, xAxisColumns, yAxisColumns, columnFormats, colorMode])

  // Viz type constraint validation (centralized in viz-constraints.ts)
  const constraint = useMemo(() => {
    const xColTypes = xAxisColumns.map(col => resolveColumnType(col, columns, types))
    return getVizConstraintError(chartType, { xColCount: xAxisColumns.length, yColCount: allYColumns.length, xDataCount: aggregatedData.xAxisData.length, xColTypes })
  }, [chartType, xAxisColumns, columns, types, allYColumns.length, aggregatedData.xAxisData.length])
  const constraintError = constraint.error

  const hasData = allYColumns.length > 0


  // Pivot config — always derived from props so agent edits immediately take effect
  // Guarantee the three axis arrays exist — a malformed/legacy pivotConfig can omit
  // one (e.g. `columns`), which would throw on `.map`/`.length` here and in the
  // aggregator / PivotAxisBuilder. Keep undefined-when-absent so `!pivotConfig` holds.
  const pivotConfig = useMemo(
    () => initialPivotConfig
      ? {
          ...initialPivotConfig,
          rows: initialPivotConfig.rows ?? [],
          columns: initialPivotConfig.columns ?? [],
          values: initialPivotConfig.values ?? [],
        }
      : initialPivotConfig,
    [initialPivotConfig],
  )

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

  // Trend mode: KPI cards, not ECharts
  if (chartType === 'trend') {
    const hasData = allYColumns.length > 0
    return (
      <Box display="flex" flexDirection="column" gap={0} height="100%" width="100%">
        <Box flex="1" overflow="hidden" display="flex" minHeight="0" alignItems="center" justifyContent="center">
          {constraintError ? (
            <ChartError message={constraintError} variant={constraint.variant} />
          ) : hasData ? (
            <TrendPlot
              series={aggregatedData.series}
              xAxisData={aggregatedData.xAxisData}
              columnFormats={columnFormats}
              yAxisColumns={yAxisColumns}
              xAxisColumns={xAxisColumns}
              compareMode={trendConfig?.compareMode ?? 'last'}
            />
          ) : (
            <ChartError variant="info" title="No data to display" message="Drag metric columns to see trend values" />
          )}
        </Box>
      </Box>
    )
  }

  // Single value mode: big number display, only Y-axis (metrics) needed
  if (chartType === 'single_value') {
    const hasData = allYColumns.length > 0
    return (
      <Box display="flex" flexDirection="column" gap={0} height="100%" width="100%">
        <Box flex="1" overflow="hidden" display="flex" minHeight="0" alignItems="center" justifyContent="center">
          {hasData ? (
            <SingleValue
              values={yAxisColumns.map(col => ({
                name: columnFormats[col]?.alias || col,
                value: rows[0]?.[col] ?? null,
              }))}
              config={singleValueConfig}
            />
          ) : (
            <ChartError variant="info" title="No data to display" message="Drag metric columns to see values" />
          )}
        </Box>
      </Box>
    )
  }

  // Geo mode: completely different layout (Leaflet, not ECharts)
  const isGeo = chartType === 'geo'

  if (isGeo) {
    const geoConstraint = getGeoConstraintError(initialGeoConfig ?? null, columns)
    if (geoConstraint.error) {
      return (
        <Box display="flex" flexDirection="column" gap={0} height="100%" width="100%">
          <ChartError variant="info" message={geoConstraint.error} />
        </Box>
      )
    }
    return (
      <Box display="flex" flexDirection="column" gap={0} height="100%" width="100%">
        <Box flex="1" overflow="hidden" display="flex" minHeight="0">
          <GeoPlot
            rows={rows}
            columns={columns}
            geoConfig={initialGeoConfig ?? { subType: 'choropleth' } as GeoConfig}
            tooltipCols={tooltipColumns}
            markerColor={colorPalette[0]}
            columnFormats={columnFormats}
            onMapReady={(getView) => { onMapReady?.(getView) }}
          />
        </Box>
      </Box>
    )
  }

  // For pivot, we consider having data when pivotConfig has values
  const isPivot = chartType === 'pivot'
  const pivotHasData = isPivot && pivotData && pivotData.cells.length > 0

  // Pivot mode: completely different layout
  if (isPivot) {
    return (
      <Box display="flex" flexDirection="column" gap={0} height="100%" width="100%">
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
              onCellClick={enableDrilldown ? handlePivotCellClick : undefined}
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
      {/* Chart Area */}
      <VStack flex="1" align="stretch" gap={0} minWidth={0} overflow="hidden" minHeight="0">
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
            <ChartError message={constraintError} variant={constraint.variant} />
          ) : hasData ? (
            <Box width="100%" flex="1" display="flex" alignItems="center" justifyContent="center" minWidth="100px" minHeight="0">
              {(() => {
                const sharedProps = {
                  xAxisData: aggregatedData.xAxisData,
                  series: aggregatedData.series,
                  xAxisLabel: getDisplayName(xAxisColumns[0]),
                  yAxisLabel: buildCompactYLabel(yAxisColumns.map(getDisplayName)),
                  xAxisColumns,
                  pointMeta: aggregatedData.pointMeta,
                  tooltipColumns,
                  columnFormats,
                  yAxisColumns,
                  yRightCols: yRightColumns,
                  height: undefined,
                  onChartClick: enableDrilldown ? handleChartClick : undefined,
                  chartTitle,
                  showChartTitle,
                  colorPalette,
                  axisConfig,
                  styleConfig,
                  annotations,
                  columnTypes,
                  exportBranding,
                  onDownloadImage,
                }
                const plotMap = { line: LinePlot, bar: BarPlot, row: RowPlot, combo: ComboPlot, area: AreaPlot, scatter: ScatterPlot, funnel: FunnelPlot, pie: PiePlot, waterfall: WaterfallPlot, radar: RadarPlot } as const
                const Plot = plotMap[chartType as keyof typeof plotMap]
                if (Plot) return <Plot {...sharedProps} />
                return null
              })()}
            </Box>
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
