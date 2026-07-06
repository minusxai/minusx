import type { EChartsOption } from 'echarts'
import type { EChartsType } from 'echarts/core'
import { getChartFontFamily } from './echarts-theme'
import type { ColumnType } from '@/lib/database/column-types'
import type { ColumnFormatConfig, AxisConfig, VisualizationStyleConfig, ChartAnnotation } from '@/lib/types'

// dataKind: the semantic type of the x-axis data (for formatting/tooltip logic)
// echartsType: the actual ECharts axis type (bar/waterfall always → category)
export type CartesianXAxisKind = 'category' | 'time' | 'value'
export type EChartsXAxisType = 'category' | 'time' | 'value' | 'log'

export const resolveXAxisTypes = (
  xAxisColumns?: string[],
  columnTypes?: Record<string, ColumnType>,
  chartType?: string,
  xScaleType?: string,
): { columnKind: CartesianXAxisKind; axisType: EChartsXAxisType } => {
  const primaryXColumn = xAxisColumns?.[0]
  let columnKind: CartesianXAxisKind = 'category'
  if (primaryXColumn) {
    switch (columnTypes?.[primaryXColumn]) {
      case 'number': columnKind = 'value'; break
      case 'date': columnKind = 'time'; break
    }
  }

  // Bar/waterfall charts always use category — bars are discrete, labels must match data points.
  let axisType: EChartsXAxisType = columnKind
  if (chartType === 'bar' || chartType === 'row' || chartType === 'waterfall' || chartType === 'combo') axisType = 'category'
  else if (columnKind === 'value' && xScaleType === 'log') axisType = 'log'

  return { columnKind, axisType }
}

export const toCartesianAxisValue = (rawValue: string, axisType: EChartsXAxisType): string | number => {
  return axisType === 'value' || axisType === 'log' ? Number(rawValue) : rawValue
}

/**
 * Find the index in xAxisData that matches annotationX, with fuzzy date matching.
 * Handles cases where the agent writes "2026-02-28" but xAxisData has "2026-02-28T00:00:00.000Z"
 * (or vice versa). Returns -1 if no match found.
 */
export const findMatchingXIndex = (xAxisData: string[], annotationX: string | number): number => {
  const needle = String(annotationX)

  // Try exact match first
  const exactIndex = xAxisData.findIndex(item => String(item) === needle)
  if (exactIndex !== -1) return exactIndex

  // Try prefix matching (date-only vs full ISO)
  return xAxisData.findIndex(item => {
    const hay = String(item)
    return hay.startsWith(needle) || needle.startsWith(hay)
  })
}

/**
 * Resolve the x value and matched data index for an annotation.
 * - Category axis: snap to nearest xAxisData entry (required for discrete buckets)
 * - Time/value/log axis: use the raw annotation value (continuous scale, any position valid)
 */
export const resolveAnnotationX = ({
  annotationX,
  xAxisData,
  axisType,
}: {
  annotationX: string | number
  xAxisData: string[]
  axisType: string
}): { xValue: string | number; matchedIndex: number } => {
  const isContinuous = axisType === 'time' || axisType === 'value' || axisType === 'log'

  if (isContinuous) {
    return { xValue: annotationX, matchedIndex: -1 }
  }

  // Category axis — must snap to an existing data point
  const matchedIndex = findMatchingXIndex(xAxisData, annotationX)
  const xValue = matchedIndex !== -1 ? xAxisData[matchedIndex] : String(annotationX)
  return { xValue, matchedIndex }
}

/**
 * Compute the y-value to pass to convertToPixel for an annotation.
 * For stacked charts, sums all series values in the same stack group
 * at or below the target series index. For x-only annotations (no series),
 * returns null.
 */
export const resolveAnnotationY = ({
  series,
  matchedSeriesIndex,
  pointIndex,
  pointY,
  isStacked,
  yAxisAssignments,
}: {
  series: Array<{ name: string; data: number[] }>
  matchedSeriesIndex: number | null
  pointIndex: number | null
  pointY: number | null
  isStacked: boolean
  yAxisAssignments: number[]
}): number | null => {
  if (matchedSeriesIndex == null || pointIndex == null || pointY == null) return null
  if (!isStacked) return pointY

  const targetAxis = yAxisAssignments[matchedSeriesIndex] ?? 0
  let cumulative = 0
  for (let i = 0; i <= matchedSeriesIndex; i++) {
    if ((yAxisAssignments[i] ?? 0) !== targetAxis) continue
    const val = series[i].data[pointIndex]
    if (typeof val === 'number' && Number.isFinite(val)) {
      cumulative += val
    }
  }
  return cumulative
}

// Assign series to Y-axes based on explicit yRightCols.
// Series whose Y-column is in yRightCols → axis 1 (right), others → axis 0 (left).
// Works with split series (e.g. "Appetizers - orders") by checking if name ends with " - col".
export const assignSeriesToYRightCols = (
  series: Array<{ name: string; data: number[] }>,
  yRightCols: string[]
): number[] => {
  const rightSet = new Set(yRightCols)
  return series.map(s => {
    // Direct match: series name is a right-axis column
    if (rightSet.has(s.name)) return 1
    // Split pattern: "GroupValue - yCol" — check if the yCol suffix is in rightSet
    for (const col of yRightCols) {
      if (s.name.endsWith(` - ${col}`)) return 1
    }
    return 0
  })
}

const wrapAnnotationText = (text: string, maxCharsPerLine = 24, maxLines = 3): string[] => {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ['']

  const lines: string[] = []
  let current = ''

  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (next.length <= maxCharsPerLine) {
      current = next
      continue
    }

    if (current) lines.push(current)
    current = word

    if (lines.length === maxLines - 1) break
  }

  if (lines.length < maxLines && current) {
    lines.push(current)
  }

  const consumedLength = lines.join(' ').length
  if (consumedLength < text.trim().length && lines.length > 0) {
    const lastIndex = lines.length - 1
    lines[lastIndex] = `${lines[lastIndex].slice(0, Math.max(0, maxCharsPerLine - 1))}…`
  }

  return lines
}

interface AnnotationGraphicsConfig {
  chart: EChartsType
  xAxisData: string[]
  series: Array<{ name: string; data: number[] }>
  chartType: string
  xAxisColumns?: string[]
  columnTypes?: Record<string, ColumnType>
  yAxisColumns?: string[]
  yRightCols?: string[]
  columnFormats?: Record<string, ColumnFormatConfig>
  annotations?: ChartAnnotation[]
  axisConfig?: AxisConfig
  styleConfig?: VisualizationStyleConfig | null
  colorMode?: 'light' | 'dark'
  colorPalette: string[]
}

export const buildAnnotationGraphics = ({
  chart,
  xAxisData,
  series,
  chartType,
  xAxisColumns,
  columnTypes,
  yAxisColumns,
  yRightCols,
  columnFormats,
  annotations,
  axisConfig,
  styleConfig,
  colorMode = 'dark',
  colorPalette,
}: AnnotationGraphicsConfig): EChartsOption['graphic'] => {
  if (!annotations || annotations.length === 0) return []
  if (!['line', 'bar', 'row', 'area', 'scatter'].includes(chartType)) return []
  if ((xAxisColumns?.length ?? 0) !== 1) return []

  const ecModel = (chart as any).getModel?.()
  const gridComponent = ecModel?.getComponent?.('grid', 0)
  const rect = gridComponent?.coordinateSystem?.getRect?.()
  if (!rect) return []

  const plotLeft = rect.x
  const plotTop = rect.y
  const plotRight = rect.x + rect.width
  const plotBottom = rect.y + rect.height
  const plotHeight = rect.height
  const useDualYAxis = axisConfig?.dualAxis === true && yRightCols && yRightCols.length > 0
  const { axisType: echartsXAxisType } = resolveXAxisTypes(xAxisColumns, columnTypes, chartType)
  const yAxisAssignments = useDualYAxis ? assignSeriesToYRightCols(series, yRightCols) : series.map(() => 0)
  const isStacked = (styleConfig?.stacked ?? true) && ['bar', 'row', 'area'].includes(chartType)
  const getColumnDisplayName = (col: string) => columnFormats?.[col]?.alias || col
  const getSeriesDisplayName = (seriesName: string): string => {
    const axisMatch = seriesName.match(/^(.*) \(([LR])\)$/)
    const baseName = axisMatch ? axisMatch[1] : seriesName
    const axisSuffix = axisMatch ? ` (${axisMatch[2]})` : ''

    for (const yCol of yAxisColumns ?? []) {
      const rawSuffix = ` - ${yCol}`
      if (baseName.endsWith(rawSuffix)) {
        return `${baseName.slice(0, -rawSuffix.length)} - ${getColumnDisplayName(yCol)}${axisSuffix}`
      }
    }

    return `${getColumnDisplayName(baseName)}${axisSuffix}`
  }

  const topRowOccupancy: Array<Array<{ left: number; right: number }>> = []
  const bottomRowOccupancy: Array<Array<{ left: number; right: number }>> = []
  const labelGap = 8
  const rowHeight = 48
  const bandPadding = 8
  const maxBandRows = Math.max(1, Math.min(4, Math.floor((plotHeight * 0.35) / rowHeight)))
  const lineColor = colorMode === 'dark' ? 'rgba(139, 148, 158, 0.7)' : 'rgba(87, 96, 106, 0.75)'
  const labelFill = colorMode === 'dark' ? 'rgba(22, 27, 34, 0.94)' : 'rgba(255, 255, 255, 0.96)'
  const labelStroke = colorMode === 'dark' ? 'rgba(48, 54, 61, 0.9)' : 'rgba(208, 215, 222, 0.95)'
  const labelText = colorMode === 'dark' ? '#E6EDF3' : '#0D1117'

  const findOpenRow = (
    occupancy: Array<Array<{ left: number; right: number }>>,
    left: number,
    width: number
  ): number | null => {
    for (let rowIndex = 0; rowIndex < maxBandRows; rowIndex++) {
      const row = occupancy[rowIndex] ?? []
      const overlaps = row.some(rectItem => !(left + width + labelGap <= rectItem.left || left - labelGap >= rectItem.right))
      if (!overlaps) {
        return rowIndex
      }
    }

    return null
  }

  const annotationsWithPixels = annotations
    .slice(0, 8)
    .map((annotation: ChartAnnotation) => {
      // Resolve x: category axes snap to data points; continuous axes use the raw value
      const { xValue: resolvedX, matchedIndex: matchedXIndex } = resolveAnnotationX({
        annotationX: annotation.x,
        xAxisData,
        axisType: echartsXAxisType,
      })
      const xValue = toCartesianAxisValue(String(resolvedX), echartsXAxisType)

      // x-only annotation (no series) — vertical marker at x position
      if (!annotation.series) {
        const pixel = chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [xValue, 0])
        if (!Array.isArray(pixel) || !Number.isFinite(pixel[0])) return null

        return {
          annotation,
          xPixel: pixel[0],
          pointYPixel: null as number | null,
          seriesIndex: null as number | null,
        }
      }

      const matchedSeriesIndex = series.findIndex(item => (
        item.name === annotation.series
        || getSeriesDisplayName(item.name) === annotation.series
      ))
      if (matchedSeriesIndex === -1) return null

      // For category axis, must have matched a data point; for continuous, find nearest for y lookup
      let pointIndex: number | null = matchedXIndex !== -1 ? matchedXIndex : null
      if (pointIndex == null && matchedXIndex === -1) {
        // Continuous axis — find the closest x data point to anchor y value
        pointIndex = findMatchingXIndex(xAxisData, annotation.x)
        if (pointIndex === -1) pointIndex = null
      }
      if (pointIndex == null) return null

      const seriesMatch = series[matchedSeriesIndex]
      const pointY = seriesMatch.data[pointIndex]
      if (typeof pointY !== 'number' || !Number.isFinite(pointY)) return null

      const effectiveY = resolveAnnotationY({
        series,
        matchedSeriesIndex,
        pointIndex,
        pointY,
        isStacked,
        yAxisAssignments,
      }) ?? pointY

      const finder = {
        xAxisIndex: 0,
        yAxisIndex: yAxisAssignments[matchedSeriesIndex] ?? 0,
      }

      const pixel = chart.convertToPixel(finder, [xValue, effectiveY])

      if (!Array.isArray(pixel) || !Number.isFinite(pixel[0]) || !Number.isFinite(pixel[1])) {
        return null
      }

      return {
        annotation,
        xPixel: pixel[0],
        pointYPixel: pixel[1] as number | null,
        seriesIndex: matchedSeriesIndex as number | null,
      }
    })
    .filter((item): item is { annotation: ChartAnnotation; xPixel: number; pointYPixel: number | null; seriesIndex: number | null } => item !== null)
    .sort((a, b) => a.xPixel - b.xPixel)

  return annotationsWithPixels.flatMap(({ annotation, xPixel, pointYPixel, seriesIndex }, index) => {
    const lines = wrapAnnotationText(annotation.text, 24, 3)
    const width = Math.max(96, Math.min(180, Math.max(...lines.map(line => line.length), 0) * 7 + 16))
    const height = 12 + lines.length * 14

    const left = Math.min(plotRight - width, Math.max(plotLeft, xPixel - width / 2))
    const isXOnly = pointYPixel == null
    const preferBottom = isXOnly ? false : pointYPixel < plotTop + plotHeight * 0.42
    const primaryBand = preferBottom ? 'bottom' : 'top'
    const primaryRow = findOpenRow(primaryBand === 'top' ? topRowOccupancy : bottomRowOccupancy, left, width)
    const secondaryBand = primaryBand === 'top' ? 'bottom' : 'top'
    const secondaryRow = primaryRow == null
      ? findOpenRow(secondaryBand === 'top' ? topRowOccupancy : bottomRowOccupancy, left, width)
      : null

    const band = primaryRow != null ? primaryBand : secondaryBand
    const rowIndex = primaryRow ?? secondaryRow ?? 0
    const occupancy = band === 'top' ? topRowOccupancy : bottomRowOccupancy
    if (!occupancy[rowIndex]) occupancy[rowIndex] = []
    occupancy[rowIndex].push({ left, right: left + width })

    const top = band === 'top'
      ? plotTop + bandPadding + rowIndex * rowHeight
      : plotBottom - bandPadding - height - rowIndex * rowHeight
    const leaderStartY = band === 'top' ? top + height + 4 : top - 4

    // x-only: leader line spans full plot height; series-anchored: ends at data point
    const leaderEndY = isXOnly
      ? (band === 'top' ? plotBottom : plotTop)
      : Math.min(plotBottom, Math.max(plotTop, pointYPixel))

    const graphics: any[] = [
      {
        type: 'line',
        silent: true,
        z: 100,
        zlevel: 10,
        shape: {
          x1: xPixel,
          y1: leaderStartY,
          x2: xPixel,
          y2: leaderEndY,
        },
        style: {
          stroke: lineColor,
          lineDash: [4, 4],
          lineWidth: 1,
        },
      },
      {
        type: 'rect',
        silent: true,
        z: 101,
        zlevel: 10,
        shape: {
          x: left,
          y: top,
          width,
          height,
          r: 6,
        },
        style: {
          fill: labelFill,
          stroke: labelStroke,
          lineWidth: 0.5,
          shadowBlur: 2,
          shadowColor: 'rgba(0, 0, 0, 0.12)',
        },
      },
      {
        type: 'text',
        silent: true,
        z: 102,
        zlevel: 10,
        style: {
          x: left + width / 2,
          y: top + 7,
          text: lines.join('\n'),
          fill: labelText,
          font: `11px ${getChartFontFamily()}`,
          lineHeight: 14,
          width: width - 16,
          align: 'center',
          overflow: 'break',
        },
      },
    ]

    // Only draw the dot for series-anchored annotations
    if (!isXOnly) {
      graphics.push({
        type: 'circle',
        silent: true,
        z: 103,
        zlevel: 10,
        shape: {
          cx: xPixel,
          cy: leaderEndY,
          r: 3,
        },
        style: {
          fill: colorPalette[(seriesIndex ?? index) % colorPalette.length],
          stroke: labelFill,
          lineWidth: 1,
        },
      })
    }

    return graphics
  })
}
