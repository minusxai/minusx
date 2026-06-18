'use client'

/**
 * VizConfigPanel — lightweight config-only panel for the Viz tab.
 * Renders axis builders without any data aggregation or chart rendering.
 * Extracted from ChartBuilder to avoid duplicate computation.
 */

import { useCallback, useMemo } from 'react'
import { Box } from '@chakra-ui/react'
import { PivotAxisBuilder } from './PivotAxisBuilder'
import { GeoAxisBuilder } from './GeoAxisBuilder'
import { TrendAxisBuilder } from './TrendAxisBuilder'
import { AxisBuilder, type AxisZone } from './AxisBuilder'
import { resolveColumnType } from './AxisComponents'
import { StyleConfigPopover } from './StyleConfigPopover'
import { AnnotationEditor } from './AnnotationEditor'
import type { PivotConfig, ColumnFormatConfig, AxisConfig, VisualizationStyleConfig, TrendConfig, VisualizationType } from '@/lib/types'
import type { GeoConfig } from '@/lib/types'
import type { ChartAnnotation } from '@/lib/types'

interface VizConfigPanelProps {
  columns: string[]
  types: string[]
  chartType: Exclude<VisualizationType, 'table'>
  initialXCols?: string[]
  initialYCols?: string[]
  initialYRightCols?: string[]
  onAxisChange?: (xCols: string[], yCols: string[]) => void
  onYRightColsChange?: (yRightCols: string[]) => void
  initialPivotConfig?: PivotConfig
  onPivotConfigChange?: (config: PivotConfig) => void
  initialGeoConfig?: GeoConfig
  onGeoConfigChange?: (config: GeoConfig) => void
  initialColumnFormats?: Record<string, ColumnFormatConfig>
  onColumnFormatsChange?: (formats: Record<string, ColumnFormatConfig>) => void
  initialTooltipCols?: string[]
  onTooltipColsChange?: (cols: string[]) => void
  styleConfig?: VisualizationStyleConfig
  onStyleConfigChange?: (config: VisualizationStyleConfig) => void
  axisConfig?: AxisConfig
  onAxisConfigChange?: (config: AxisConfig) => void
  annotations?: ChartAnnotation[]
  onAnnotationsChange?: (annotations: ChartAnnotation[]) => void
  trendConfig?: TrendConfig
  onTrendConfigChange?: (config: TrendConfig) => void
  /** Returns the live geo map's current center/zoom, or null when no map is mounted. Powers the "Pin current view" button. */
  getMapView?: () => { center: [number, number]; zoom: number } | null
}

interface GroupedColumns {
  dates: string[]
  numbers: string[]
  categories: string[]
}

export const VizConfigPanel = ({
  columns, types, chartType,
  initialXCols, initialYCols, initialYRightCols,
  onAxisChange, onYRightColsChange,
  initialPivotConfig, onPivotConfigChange,
  initialGeoConfig, onGeoConfigChange,
  initialColumnFormats, onColumnFormatsChange,
  initialTooltipCols, onTooltipColsChange,
  styleConfig, onStyleConfigChange,
  axisConfig, onAxisConfigChange,
  annotations, onAnnotationsChange,
  trendConfig, onTrendConfigChange,
  getMapView,
}: VizConfigPanelProps) => {

  // Group columns by type
  const groupedColumns: GroupedColumns = useMemo(() => {
    const groups: GroupedColumns = { dates: [], numbers: [], categories: [] }
    columns.forEach((col) => {
      const type = resolveColumnType(col, columns, types)
      if (type === 'date') groups.dates.push(col)
      else if (type === 'number') groups.numbers.push(col)
      else groups.categories.push(col)
    })
    return groups
  }, [columns, types])

  // Auto-select columns (same logic as ChartBuilder)
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

  // Column format config
  const columnFormats = useMemo<Record<string, ColumnFormatConfig>>(() => initialColumnFormats ?? {}, [initialColumnFormats])
  const tooltipColumns = useMemo<string[]>(() => {
    if (initialTooltipCols !== undefined) {
      return initialTooltipCols.filter(col => columns.includes(col))
    }
    return []
  }, [initialTooltipCols, columns])

  const supportsAnnotations = ['line', 'bar', 'row', 'area', 'scatter'].includes(chartType) && xAxisColumns.length === 1

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

  // Drop/remove handlers
  const handleDropXPrimary = useCallback((col: string) => {
    if (xAxisColumns[0] === col) return
    const remaining = xAxisColumns.filter(c => c !== col)
    onAxisChange?.([col, ...remaining], yAxisColumns)
  }, [xAxisColumns, yAxisColumns, onAxisChange])

  const handleDropSplitBy = useCallback((col: string) => {
    if (xAxisColumns.includes(col)) return
    onAxisChange?.([...xAxisColumns, col], yAxisColumns)
  }, [xAxisColumns, yAxisColumns, onAxisChange])

  const handleDropY = useCallback((col: string) => {
    if (!yAxisColumns.includes(col)) {
      onAxisChange?.(xAxisColumns, [...yAxisColumns, col])
    }
  }, [yAxisColumns, xAxisColumns, onAxisChange])

  const removeFromXPrimary = useCallback((column: string) => {
    onAxisChange?.(xAxisColumns.filter(c => c !== column), yAxisColumns)
  }, [xAxisColumns, yAxisColumns, onAxisChange])

  const removeFromSplitBy = useCallback((column: string) => {
    onAxisChange?.(xAxisColumns.filter(c => c !== column), yAxisColumns)
  }, [xAxisColumns, yAxisColumns, onAxisChange])

  const removeFromY = useCallback((column: string) => {
    onAxisChange?.(xAxisColumns, yAxisColumns.filter(c => c !== column))
  }, [yAxisColumns, xAxisColumns, onAxisChange])

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

  // Build axis zones for standard charts
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

  // Trend: own axis builder
  if (chartType === 'trend') {
    return (
      <TrendAxisBuilder
        columns={columns}
        types={types}
        xAxisColumns={xAxisColumns}
        yAxisColumns={yAxisColumns}
        onAxisChange={(x, y) => onAxisChange?.(x, y)}
        columnFormats={columnFormats}
        onColumnFormatChange={handleColumnFormatChange}
        trendConfig={trendConfig}
        onTrendConfigChange={onTrendConfigChange}
      />
    )
  }

  // Single value: simple metrics-only zone
  if (chartType === 'single_value') {
    const singleValueZones: AxisZone[] = [{
      label: 'Metrics',
      items: yAxisColumns.map(col => ({ column: col })),
      emptyText: 'Drop column to display',
      onDrop: (col) => { if (!yAxisColumns.includes(col)) onAxisChange?.([], [...yAxisColumns, col]) },
      onRemove: (col) => onAxisChange?.([], yAxisColumns.filter(c => c !== col)),
    }]
    return (
      <AxisBuilder
        columns={columns}
        types={types}
        zones={singleValueZones}
        columnFormats={columnFormats}
        onColumnFormatChange={handleColumnFormatChange}
        chartType={chartType}
        borderless
      />
    )
  }

  // Geo: own axis builder
  if (chartType === 'geo') {
    return (
      <GeoAxisBuilder
        columns={columns}
        types={types}
        geoConfig={initialGeoConfig}
        onGeoConfigChange={(config) => onGeoConfigChange?.(config)}
        tooltipCols={tooltipColumns}
        onTooltipColsChange={onTooltipColsChange}
        colorOverrides={styleConfig?.colors ?? {}}
        onColorOverridesChange={(colors) => onStyleConfigChange?.({ ...styleConfig, colors })}
        getMapView={getMapView ?? (() => null)}
      />
    )
  }

  // Pivot: own axis builder
  if (chartType === 'pivot') {
    return (
      <PivotAxisBuilder
        columns={columns}
        types={types}
        pivotConfig={initialPivotConfig}
        onPivotConfigChange={(config) => onPivotConfigChange?.(config)}
        columnFormats={columnFormats}
        onColumnFormatChange={handleColumnFormatChange}
      />
    )
  }

  // Default: standard AxisBuilder (bar, line, area, scatter, pie, funnel, etc.)
  return (
    <Box display="flex" flexDirection="column" gap={0} width="100%">
      <AxisBuilder
        columns={columns}
        types={types}
        zones={chartZones}
        columnFormats={columnFormats}
        onColumnFormatChange={handleColumnFormatChange}
        axisConfig={axisConfig}
        onAxisConfigChange={onAxisConfigChange}
        chartType={chartType}
        borderless
        stylePanel={onStyleConfigChange ? (
          <StyleConfigPopover
            chartType={chartType}
            styleConfig={styleConfig}
            numSeries={0}
            onChange={onStyleConfigChange}
            displayMode="inline"
          />
        ) : undefined}
        annotationPanel={onAnnotationsChange ? (
          <AnnotationEditor
            annotations={annotations}
            onChange={onAnnotationsChange}
            enabled={supportsAnnotations}
            xOptions={[]}
            seriesOptions={[]}
          />
        ) : undefined}
      />
    </Box>
  )
}
