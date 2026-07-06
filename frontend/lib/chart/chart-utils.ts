import type { EChartsOption } from 'echarts'
import { withMinusXTheme, getChartFontFamily } from './echarts-theme'
import type { ColumnType } from '@/lib/database/column-types'
import type { ColumnFormatConfig, AxisConfig, VisualizationStyleConfig, ChartAnnotation } from '@/lib/types'
import type { OrgBranding } from '@/lib/branding/whitelabel'
import {
  formatLargeNumber,
  formatNumber,
  formatDateValue,
  applyPrefixSuffix,
  getNumberScale,
  formatWithScale,
  resolveChartFormats,
  truncateLabel,
} from './chart-format'
import {
  resolveXAxisTypes,
  toCartesianAxisValue,
  assignSeriesToYRightCols,
} from './chart-annotations'

/**
 * Where ECharts mounts the tooltip DOM. We previously used `appendToBody: true`
 * so tooltips escape overflow-clipping ancestors, but the native Fullscreen API
 * only renders the fullscreen element's subtree — a tooltip mounted on
 * `document.body` is outside that subtree and stays invisible in Present mode.
 * Mounting into the active fullscreen element (when present) fixes that while
 * keeping the body fallback for the normal, non-fullscreen case.
 *
 * Passed as a function so ECharts re-evaluates it on each tooltip show, picking
 * up fullscreen enter/exit without rebuilding the chart option.
 */
export const tooltipAppendTo = (): HTMLElement =>
  (typeof document !== 'undefined' && (document.fullscreenElement as HTMLElement | null)) || document.body

/** Chart types handled by buildChartOption / BaseChart (ECharts-based standard charts). */
export type StandardChartType = 'line' | 'bar' | 'row' | 'area' | 'scatter' | 'combo'

// Chart props interface
export interface ChartProps {
  xAxisData: string[]
  series: Array<{ name: string; data: number[] }>
  pointMeta?: Record<string, any>[]
  height?: number | string
  xAxisLabel?: string
  yAxisLabel?: string
  yAxisColumns?: string[]  // The actual Y-axis column names (left axis when dual axis)
  yRightCols?: string[]    // Right Y-axis column names (only when axisConfig.dualAxis is true)
  onChartClick?: (params: unknown) => void  // ECharts click event handler for drill-down
  columnFormats?: Record<string, ColumnFormatConfig>
  xAxisColumns?: string[]  // Actual X-axis column names (for format config lookup)
  tooltipColumns?: string[]
  chartTitle?: string  // Title shown in chart and included in downloads
  showChartTitle?: boolean  // Whether to show title in chart (always shown in downloads)
  colorPalette: string[]  // Effective color palette (hex values)
  axisConfig?: AxisConfig  // Axis scale config (linear/log)
  styleConfig?: VisualizationStyleConfig
  annotations?: ChartAnnotation[]
  exportBranding?: Partial<OrgBranding>
  onDownloadImage?: () => Promise<void>
  columnTypes?: Record<string, ColumnType>  // SQL-derived column types for axis type detection
}

/** Build a standard ECharts title config with overflow truncation */
export function buildChartTitleOption(chartTitle: string | undefined, showChartTitle: boolean, containerWidth?: number): Record<string, any> {
  if (!chartTitle) return {}
  const titleWidth = containerWidth ? containerWidth - 80 : undefined  // leave margin for padding
  return {
    title: {
      text: chartTitle,
      left: 'center',
      top: 5,
      show: showChartTitle,
      ...(titleWidth ? {
        textStyle: {
          width: titleWidth,
          overflow: 'truncate',
          ellipsis: '...',
        },
      } : {}),
    },
  }
}

/** Shared config for the "special" (non-cartesian) chart builders: pie, funnel, waterfall, radar. */
export interface SpecialChartOptionConfig {
  xAxisData: string[]
  series: Array<{ name: string; data: number[] }>
  colorMode?: 'light' | 'dark'
  containerWidth?: number
  columnFormats?: Record<string, ColumnFormatConfig>
  xAxisColumns?: string[]
  yAxisColumns?: string[]
  xAxisLabel?: string
  yAxisLabel?: string
  chartTitle?: string
  showChartTitle?: boolean
  colorPalette: string[]
  styleConfig?: VisualizationStyleConfig
  exportBranding?: Partial<OrgBranding>
  downloadCsv?: () => void
  onDownloadImage?: () => Promise<void>
}

const getCartesianYValue = (value: unknown): number | undefined => {
  if (typeof value === 'number') return value
  if (Array.isArray(value) && typeof value[1] === 'number') return value[1]
  return undefined
}

export const hexToRgb = (color: string): { r: number; g: number; b: number } | null => {
  const normalized = color.trim()
  const hex = normalized.startsWith('#') ? normalized.slice(1) : normalized

  if (hex.length === 3 && /^[0-9a-f]{3}$/i.test(hex)) {
    return {
      r: parseInt(hex[0] + hex[0], 16),
      g: parseInt(hex[1] + hex[1], 16),
      b: parseInt(hex[2] + hex[2], 16),
    }
  }

  if (hex.length === 6 && /^[0-9a-f]{6}$/i.test(hex)) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    }
  }

  return null
}

export const withAlpha = (color: string, alpha: number): string => {
  const rgb = hexToRgb(color)
  if (!rgb) return color
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`
}

// Validate chart data
export const isValidChartData = (xAxisData?: string[], series?: Array<{ name: string; data: number[] }>): boolean => {
  return !!(xAxisData && xAxisData.length > 0 && series && series.length > 0)
}

/** Lighten a hex color by mixing it towards white. `amount` 0–1 (0 = original, 1 = white). */
export const lightenHex = (hex: string, amount: number): string => {
  const rgb = hexToRgb(hex)
  if (!rgb) return hex
  const r = Math.round(rgb.r + (255 - rgb.r) * amount)
  const g = Math.round(rgb.g + (255 - rgb.g) * amount)
  const b = Math.round(rgb.b + (255 - rgb.b) * amount)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

// Generate timestamp string for file names (e.g., "2024-01-15-143052")
export const getTimestamp = () => {
  const now = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

interface ChartToolboxConfig {
  colorMode: 'light' | 'dark'
  downloadCsv?: () => void
  chartTitle?: string
  exportBranding?: Partial<OrgBranding>
  onDownloadImage?: () => Promise<void>
}

// Build toolbox configuration for charts (PNG + CSV download)
export const buildToolbox = ({
  colorMode,
  downloadCsv,
  onDownloadImage,
}: ChartToolboxConfig) => ({
  feature: {
    ...(onDownloadImage ? {
      mySaveAsImage: {
        show: true,
        title: '',
        icon: `image://data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${colorMode === 'dark' ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10l-3.1-3.1a2 2 0 0 0-2.814.014L6 21"/><path d="m14 19 3 3v-5.5"/><path d="m17 22 3-3"/><circle cx="9" cy="9" r="2"/></svg>`)}`,
        onclick: function () {
          void onDownloadImage()
        },
      },
    } : {}),
    ...(downloadCsv ? {
      myDownloadCsv: {
        show: true,
        title: '',
        icon: `image://data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${colorMode === 'dark' ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/></svg>`)}`,
        onclick: downloadCsv,
      },
    } : {}),
  },
  itemSize: 16,
  itemGap: 12,
  tooltip: {
    show: true,
    formatter: (param: { name: string }) => {
      const labels: Record<string, string> = {
        mySaveAsImage: 'Save as PNG',
        myDownloadCsv: 'Download CSV',
      }
      return labels[param.name] || param.name
    },
    backgroundColor: colorMode === 'dark' ? 'rgba(50,50,50,0.9)' : 'rgba(255,255,255,0.95)',
    textStyle: {
      color: colorMode === 'dark' ? '#fff' : '#333',
      fontSize: 12,
    },
    padding: [6, 10],
    borderRadius: 4,
    extraCssText: 'box-shadow: 0 2px 8px rgba(0,0,0,0.15);',
  },
  iconStyle: {
    color: 'transparent',
    borderColor: colorMode === 'dark' ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)',
    borderWidth: 1.5,
  },
  emphasis: {
    iconStyle: {
      borderColor: colorMode === 'dark' ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.7)',
    },
  },
  right: 10,
  bottom: 10,
})

// Base chart configuration builder
interface BaseChartConfig {
  xAxisData: string[]
  series: Array<{ name: string; data: number[] }>
  xAxisLabel?: string
  yAxisLabel?: string
  yAxisColumns?: string[]
  yRightCols?: string[]
  xAxisColumns?: string[]
  pointMeta?: Record<string, any>[]
  tooltipColumns?: string[]
  chartType: StandardChartType
  additionalOptions?: Partial<EChartsOption>
  colorMode?: 'light' | 'dark'
  containerWidth?: number
  containerHeight?: number
  columnFormats?: Record<string, ColumnFormatConfig>
  chartTitle?: string
  showChartTitle?: boolean
  colorPalette: string[]
  axisConfig?: AxisConfig
  styleConfig?: VisualizationStyleConfig
  annotations?: ChartAnnotation[]
  exportBranding?: Partial<OrgBranding>
  onDownloadImage?: () => Promise<void>
  columnTypes?: Record<string, ColumnType>
}

export const buildChartOption = (config: BaseChartConfig): EChartsOption => {
  const { xAxisData, series, xAxisLabel, yAxisLabel, yAxisColumns, yRightCols, xAxisColumns, pointMeta, tooltipColumns, chartType: rawChartType, additionalOptions = {}, colorMode = 'dark', containerWidth, containerHeight, columnFormats, chartTitle, showChartTitle = true, colorPalette: palette, axisConfig, styleConfig, exportBranding, onDownloadImage, columnTypes } = config
  const isRowChart = rawChartType === 'row'
  const chartType = isRowChart ? 'bar' as const : rawChartType
  const xScaleType = axisConfig?.xScale ?? 'linear'
  const yScaleType = axisConfig?.yScale ?? 'linear'
  const xMin = axisConfig?.xMin ?? undefined
  const xMax = axisConfig?.xMax ?? undefined
  const yMin = axisConfig?.yMin ?? undefined
  const yMax = axisConfig?.yMax ?? undefined
  const tooltipKeyColor = 'var(--chakra-colors-fg-muted)'
  const tooltipValueColor = 'var(--chakra-colors-fg-default)'
  // When user hasn't touched opacity (null), each chart type uses its own aesthetic
  // default (e.g. 0.95 for lines, 0.35 for area fill). When user explicitly sets a
  // value, we scale the type-default by that fraction so 75% = 75% of the default,
  // not a raw 0.75 that can be brighter than the untouched default.
  const rawOpacity = styleConfig?.opacity
  const scaleOpacity = (typeDefault: number) =>
    rawOpacity != null ? typeDefault * rawOpacity : typeDefault
  const markerSize = styleConfig?.markerSize
  const isStacked = styleConfig?.stacked ?? true
  const logMajorGridColor = colorMode === 'dark' ? 'rgba(208, 215, 222, 0.8)' : 'rgba(48, 54, 61, 0.8)'
  const logMinorGridColor = colorMode === 'dark' ? 'rgba(208, 215, 222, 0.5)' : 'rgba(48, 54, 61, 0.5)'

  const { columnKind: xAxisKind, axisType: echartsXAxisType } = resolveXAxisTypes(xAxisColumns, columnTypes, chartType, xScaleType)

  // Resolve format configs for axes
  const { xDateFormat, yPrefix, ySuffix, yDecimalPoints } = resolveChartFormats(columnFormats, xAxisColumns, yAxisColumns)
  // Resolve separate prefix/suffix for right Y-axis in dual-axis mode
  const { yPrefix: yPrefixRight, ySuffix: ySuffixRight, yDecimalPoints: yDecimalPointsRight } = yRightCols && yRightCols.length > 0
    ? resolveChartFormats(columnFormats, undefined, yRightCols)
    : { yPrefix, ySuffix, yDecimalPoints }

  // Determine consistent Y-axis scale across all series (per-axis when dual axis)
  const yScale = getNumberScale(series)

  const positiveXAxisValues = xAxisKind === 'value'
    ? xAxisData
        .map(value => Number(value))
        .filter(value => isFinite(value) && value > 0)
    : []
  const positiveScatterYValues = chartType === 'scatter'
    ? series
        .flatMap(s => s.data)
        .filter((value): value is number => isFinite(value) && value > 0)
    : []

  const getLogExtent = (values: number[]): { min?: number; max?: number } => {
    if (values.length === 0) return {}

    const min = Math.min(...values)
    const max = Math.max(...values)

    if (min === max) {
      return { min: min / 10, max: max * 10 }
    }

    return { min, max }
  }

  // Dual Y-axis: explicitly enabled via axisConfig.dualAxis + yRightCols
  const useDualYAxis = axisConfig?.dualAxis === true && yRightCols && yRightCols.length > 0
  const yAxisAssignments = useDualYAxis ? assignSeriesToYRightCols(series, yRightCols) : series.map(() => 0)

  // Per-axis scales for dual axis mode
  const yScaleLeft = useDualYAxis
    ? getNumberScale(series.filter((_, i) => yAxisAssignments[i] === 0))
    : yScale
  const yScaleRight = useDualYAxis
    ? getNumberScale(series.filter((_, i) => yAxisAssignments[i] === 1))
    : yScale

  const resolvedYAxisLabel = axisConfig?.yTitle?.trim() || yAxisLabel

  // Rotated y-axis name: ~10px per char at fontSize 16. Reserve 120px for grid margins + legend.
  const usableHeight = (containerHeight ?? 400) - 120
  const maxAxisNameLength = Math.max(8, Math.min(40, Math.floor(usableHeight / 10)))

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

  // Chart-specific series properties
  const getSeriesConfig = (type: string, index: number) => {
    const seriesType = type === 'area' ? 'line' : type

    // Add axis indicator to name if using dual Y-axes
    const seriesName = useDualYAxis
      ? `${series[index].name} (${yAxisAssignments[index] === 0 ? 'L' : 'R'})`
      : series[index].name

    const buildPointValue = (dataIndex: number, y: number) => (
      [toCartesianAxisValue(xAxisData[dataIndex], echartsXAxisType), y] as [string | number, number]
    )

    const usesPointData = type === 'scatter' || echartsXAxisType !== 'category'

    const pointData = series[index].data
      .map((y, dataIndex) => {
        const value = buildPointValue(dataIndex, y)
        return type === 'scatter'
          ? { value, tooltipMeta: pointMeta?.[dataIndex] }
          : value
      })
      .filter((item) => {
        const value = Array.isArray(item) ? item : item.value
        const x = value[0]
        const y = value[1]
        if (!isFinite(y)) return type !== 'scatter'
        if (type === 'scatter' && yScaleType === 'log' && y <= 0) return false
        if (xAxisKind === 'value') {
          const numericX = x as number
          return isFinite(numericX) && (xScaleType !== 'log' || numericX > 0)
        }
        return true
      })

    const showDataLabels = styleConfig?.showDataLabels === true
    const dataLabel = showDataLabels ? {
      show: true,
      position: (type === 'bar' ? 'inside' : 'top') as 'inside' | 'top',
      fontSize: 10,
      fontFamily: getChartFontFamily(),
      color: styleConfig?.dataLabelColor || (type === 'bar' ? '#000' : palette[index % palette.length]),
      formatter: (params: any) => {
        const v = typeof params.value === 'number' ? params.value : Array.isArray(params.value) ? params.value[1] : null
        if (v == null || !isFinite(v)) return ''
        return applyPrefixSuffix(formatLargeNumber(v), yPrefix, ySuffix)
      },
    } : undefined

    const baseConfig = {
      name: seriesName,
      type: seriesType as 'line' | 'bar' | 'scatter',
      data: usesPointData ? pointData : series[index].data,
      ...(dataLabel && { label: dataLabel }),
      itemStyle: {
        color: palette[index % palette.length],
        ...(rawOpacity != null ? { opacity: scaleOpacity(1) } : {}),
      },
      ...(useDualYAxis && { yAxisIndex: yAxisAssignments[index] }),
    }

    switch (type) {
      case 'line':
        return {
          ...baseConfig,
          symbol: 'circle',
          symbolSize: markerSize ?? 5,
          showSymbol: true,
          lineStyle: { opacity: scaleOpacity(0.95) },
        }
      case 'bar': {
        const stackGroup = useDualYAxis ? (yAxisAssignments[index] === 0 ? 'left' : 'right') : 'total'
        return {
          ...baseConfig,
          ...(isStacked ? { stack: stackGroup } : {}),
        }
      }
      case 'area': {
        const stackGroup = useDualYAxis ? (yAxisAssignments[index] === 0 ? 'left' : 'right') : 'total'
        const areaColor = palette[index % palette.length]
        const fillOpacity = scaleOpacity(0.35)

        return {
          ...baseConfig,
          type: 'line' as const,
          symbol: showDataLabels ? 'circle' : 'none',
          symbolSize: showDataLabels ? 1 : 0,
          showSymbol: showDataLabels,
          ...(isStacked ? { stack: stackGroup } : {}),
          areaStyle: {
            color: withAlpha(areaColor, fillOpacity),
          },
        }
      }
      case 'combo':
        if (yAxisAssignments[index] === 1) {
          // Right Y-axis → line
          return {
            ...baseConfig,
            type: 'line' as const,
            z: 10,
            symbol: 'circle',
            symbolSize: markerSize ?? 8,
            showSymbol: true,
            showAllSymbol: true,
            lineStyle: {
              opacity: scaleOpacity(0.95),
              width: 3,
            },
            itemStyle: {
              ...baseConfig.itemStyle,
            },
          }
        }
        // Left Y-axis (or no dual axis) → bar
        {
          const stackGroup = useDualYAxis ? (yAxisAssignments[index] === 0 ? 'left' : 'right') : 'total'
          return {
            ...baseConfig,
            type: 'bar' as const,
            ...(isStacked ? { stack: stackGroup } : {}),
            itemStyle: {
              ...baseConfig.itemStyle,
            },
          }
        }
      case 'scatter':
        return {
          ...baseConfig,
          symbolSize: markerSize ?? 8,
        }
      default:
        return baseConfig
    }
  }

  const chartSeries = series.map((_, index) => getSeriesConfig(chartType, index))

  const truncAxisName = (name: string | undefined) => name ? truncateLabel(name, maxAxisNameLength) : ''

  // Build Y-axis names for dual axes based on which series are on each axis
  const getAxisName = (axisIndex: number): string => {
    const seriesOnAxis = series
      .filter((_, idx) => yAxisAssignments[idx] === axisIndex)
      .map(s => s.name)

    if (seriesOnAxis.length === 0) return ''
    if (seriesOnAxis.length === 1) return truncAxisName(seriesOnAxis[0])

    // Multiple series on this axis - join with commas
    const combined = seriesOnAxis.join(', ')
    return truncAxisName(combined)
  }

  const legendData = useDualYAxis
    ? series
        .map((s, idx) => ({
          name: `${s.name} (${yAxisAssignments[idx] === 0 ? 'L' : 'R'})`,
          axis: yAxisAssignments[idx],
          itemStyle: {
            color: palette[idx % palette.length],
            opacity: 1,
          },
        }))
        .sort((a, b) => a.axis - b.axis)
        .map(({ axis, ...item }) => item)
    : series
        .map((s, idx) => ({
          name: s.name,
          total: s.data.reduce((sum, v) => sum + (typeof v === 'number' && !isNaN(v) ? Math.abs(v) : 0), 0),
          itemStyle: {
            color: palette[idx % palette.length],
            opacity: 1,
          },
        }))
        .sort((a, b) => b.total - a.total)
        .map(({ total, ...item }) => item)

  // Build Y-axis configuration (single or dual)
  const yAxisType = yScaleType === 'log' ? 'log' as const : 'value' as const
  const yExtraProps = yScaleType === 'log'
    ? {
        logBase: 10,
        minorTick: { show: true, splitNumber: 9 },
        splitLine: {
          show: true,
          lineStyle: {
            color: logMajorGridColor,
            type: 'dashed' as const,
            opacity: 0.45,
            width: 1,
          },
        },
        minorSplitLine: {
          show: true,
          lineStyle: {
            color: logMinorGridColor,
            type: 'dashed' as const,
            opacity: 0.45,
            width: 1,
          },
        },
      }
    : {}
  const yAxisFormatter = (value: number) =>
    applyPrefixSuffix(formatWithScale(value, yScale), yPrefix, ySuffix)
  const yAxisFormatterLeft = (value: number) =>
    applyPrefixSuffix(formatWithScale(value, yScaleLeft), yPrefix, ySuffix)
  const yAxisFormatterRight = (value: number) =>
    applyPrefixSuffix(formatWithScale(value, yScaleRight), yPrefixRight, ySuffixRight)

  // Estimate y-axis nameGap to prevent overlap with tick labels.
  // Sample a few representative values, format them, and use the longest to estimate pixel width.
  const estimateYAxisNameGap = (formatter: (v: number) => string, seriesData: Array<{ data: number[] }>) => {
    const allValues = seriesData.flatMap(s => s.data).filter(v => isFinite(v))
    if (allValues.length === 0) return undefined // let theme default handle it
    const maxVal = Math.max(...allValues.map(Math.abs))
    // Sample the kind of values ECharts would show on ticks
    const sampleValues = [0, maxVal, -maxVal, maxVal / 2].filter(isFinite)
    const maxLabelLength = Math.max(...sampleValues.map(v => formatter(v).length))
    // ~7px per character (monospace font at typical chart size) + 16px padding
    return Math.max(50, maxLabelLength * 7 + 16)
  }
  const yLogRangeProps = yScaleType === 'log' && (yMin === undefined || yMax === undefined)
    ? getLogExtent(positiveScatterYValues)
    : {}
  const yRangeProps = {
    ...(yMin !== undefined ? { min: yMin } : {}),
    ...(yMax !== undefined ? { max: yMax } : {}),
  }
  const yNameGap = estimateYAxisNameGap(yAxisFormatter, series)
  const yNameGapLeft = useDualYAxis ? estimateYAxisNameGap(yAxisFormatterLeft, series.filter((_, i) => yAxisAssignments[i] === 0)) : undefined
  const yNameGapRight = useDualYAxis ? estimateYAxisNameGap(yAxisFormatterRight, series.filter((_, i) => yAxisAssignments[i] === 1)) : undefined
  const yAxisConfig = useDualYAxis
    ? [
        {
          type: yAxisType,
          name: getAxisName(0),
          position: 'left' as const,
          ...yExtraProps,
          ...yLogRangeProps,
          ...yRangeProps,
          ...(yNameGapLeft ? { nameGap: yNameGapLeft } : {}),
          axisLabel: { formatter: yAxisFormatterLeft },
        },
        {
          type: yAxisType,
          name: getAxisName(1),
          position: 'right' as const,
          ...yExtraProps,
          ...yLogRangeProps,
          ...yRangeProps,
          ...(yNameGapRight ? { nameGap: yNameGapRight } : {}),
          axisLabel: { formatter: yAxisFormatterRight },
        },
      ]
      : {
        type: yAxisType,
        name: truncAxisName(resolvedYAxisLabel),
        ...yExtraProps,
        ...yLogRangeProps,
        ...yRangeProps,
        ...(yNameGap ? { nameGap: yNameGap } : {}),
        axisLabel: { formatter: yAxisFormatter },
      }

  // Helper to generate and download CSV from chart data
  const downloadCsv = () => {
    // Build CSV header: first column is X-axis, rest are series names
    const headers = [xAxisLabel || 'X', ...series.map(s => getSeriesDisplayName(s.name))]

    // Build rows: each row is [xValue, ...seriesValues]
    const rows = xAxisData.map((x, i) => [
      x,
      ...series.map(s => s.data[i] ?? '')
    ])

    // Escape CSV values (handle commas, quotes, newlines)
    const escapeCsvValue = (val: string | number) => {
      const str = String(val)
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`
      }
      return str
    }

    const csvContent = [
      headers.map(escapeCsvValue).join(','),
      ...rows.map(row => row.map(escapeCsvValue).join(','))
    ].join('\n')

    // Trigger download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `chart-${getTimestamp()}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const baseOption: EChartsOption = {
    ...(styleConfig?.showDataLabels === true && { labelLayout: { hideOverlap: true } }),
    ...buildChartTitleOption(chartTitle, showChartTitle ?? true, containerWidth),
    toolbox: buildToolbox({
      colorMode,
      downloadCsv,
      chartTitle,
      exportBranding,
      onDownloadImage,
    }),
    tooltip: chartType === 'scatter'
      ? {
          trigger: 'item',
          appendTo: tooltipAppendTo,
          z: 9999,
          confine: false,
          enterable: true,
          hideDelay: 100,
          transitionDuration: 0.2,
          formatter: (params: any) => {
            const point = params.data?.value ? params.data : { value: params.data, tooltipMeta: undefined }
            const [x, y] = point.value
            const formattedX = xAxisKind === 'time' && xDateFormat
              ? formatDateValue(String(x), xDateFormat)
              : xAxisKind === 'time'
                ? formatDateValue(String(x), 'MMM dd, yyyy')
                : xAxisKind === 'value'
                ? formatLargeNumber(x as number)
                : String(x)
            const scatterCfg = columnFormats?.[params.seriesName]
            const scatterPrefix = scatterCfg?.prefix || yPrefix
            const scatterSuffix = scatterCfg?.suffix || ySuffix
            const formattedY = typeof y === 'number' ? applyPrefixSuffix(formatWithScale(y, yScale), scatterPrefix, scatterSuffix) : y
            let groupingPart = String(params.seriesName ?? '')
            if ((yAxisColumns?.length ?? 0) > 1) {
              for (const yCol of yAxisColumns ?? []) {
                if (groupingPart.endsWith(` - ${yCol}`)) {
                  groupingPart = groupingPart.slice(0, -(` - ${yCol}`.length))
                  break
                }
              }
            }

            const groupingRows = (xAxisColumns ?? [])
              .slice(1)
              .map((col, index) => ({
                key: getColumnDisplayName(col),
                value: groupingPart.split(' | ')[index],
              }))
              .filter(row => row.value !== undefined && row.value !== '')

            const extraRows = (tooltipColumns ?? [])
              .filter(col => point.tooltipMeta && point.tooltipMeta[col] !== undefined)
              .map(col => ({
                key: getColumnDisplayName(col),
                value: String(point.tooltipMeta[col]),
              }))

            const rows = [
              ...groupingRows,
              { key: xAxisLabel || 'X', value: formattedX },
              { key: resolvedYAxisLabel || 'Y', value: String(formattedY) },
              ...extraRows,
            ]

            const rowHtml = rows
              .map(row => `<tr><td style="padding:2px 12px 2px 0;color:${tooltipKeyColor}">${row.key}</td><td style="padding:2px 0;text-align:right;font-weight:600;color:${tooltipValueColor}">${row.value}</td></tr>`)
              .join('')

            return `<table style="width:100%;border-collapse:collapse">${rowHtml}</table>`
          },
        }
      : {
          trigger: 'axis',
          appendTo: tooltipAppendTo,
          z: 9999,
          confine: false,
          enterable: true,
          hideDelay: 100,
          transitionDuration: 0.2,
          ...(chartType === 'bar' && { axisPointer: { type: 'shadow' } }),
          formatter: (params: any) => {
            const items = Array.isArray(params) ? params : [params]
            if (items.length === 0) return ''
            const rawAxisValue = items[0].axisValue ?? items[0].axisValueLabel
            const header = xAxisKind === 'time'
              ? formatDateValue(String(rawAxisValue), xDateFormat || 'MMM dd, yyyy')
              : xAxisKind === 'value'
                ? formatLargeNumber(Number(rawAxisValue))
                : String(items[0].axisValueLabel ?? rawAxisValue)
            const nonZeroItems = items.filter((p: any) => {
              const yValue = getCartesianYValue(p.value)
              return yValue === undefined ? true : yValue !== 0
            })
            // Sort by value descending (largest first)
            nonZeroItems.sort((a: any, b: any) => {
              const aVal = getCartesianYValue(a.value) ?? 0
              const bVal = getCartesianYValue(b.value) ?? 0
              return bVal - aVal
            })
            const MAX_TOOLTIP_ITEMS = 15
            const truncated = nonZeroItems.length > MAX_TOOLTIP_ITEMS
            const visibleItems = truncated ? nonZeroItems.slice(0, MAX_TOOLTIP_ITEMS) : nonZeroItems
            const rows = visibleItems.map((p: any) => {
              // Resolve per-series format config: use column name stripped of axis indicator
              const baseSeriesName = p.seriesName?.replace(/ \([LR]\)$/, '') ?? ''
              const colCfg = columnFormats?.[baseSeriesName] ?? columnFormats?.[p.seriesName]
              const isRightAxis = p.encode?.yAxisIndex === 1 || p.axisIndex === 1 || (useDualYAxis && yRightCols?.includes(baseSeriesName))
              const seriesPrefix = colCfg?.prefix ?? (isRightAxis ? yPrefixRight : yPrefix)
              const seriesSuffix = colCfg?.suffix ?? (isRightAxis ? ySuffixRight : ySuffix)
              const seriesScale = isRightAxis ? yScaleRight : (useDualYAxis ? yScaleLeft : yScale)
              let val: string
              const yValue = getCartesianYValue(p.value)
              if (yValue !== undefined) {
                const dp = colCfg?.decimalPoints ?? undefined
                const formatted = dp !== undefined ? formatNumber(yValue, dp) : formatWithScale(yValue, seriesScale)
                val = applyPrefixSuffix(formatted, seriesPrefix, seriesSuffix)
              } else {
                val = String(p.value)
              }
              return `<tr><td>${p.marker} ${p.seriesName}</td><td style="text-align:right;padding-left:12px;font-weight:600">${val}</td></tr>`
            })
            const moreLabel = truncated ? `<tr><td colspan="2" style="color:#888;padding-top:4px">+ ${nonZeroItems.length - MAX_TOOLTIP_ITEMS} more</td></tr>` : ''
            return `${header}<table style="width:100%">${rows.join('')}${moreLabel}</table>`
          },
        },
    legend: {
      data: legendData,
      top: chartTitle && showChartTitle ? 30 : 10,
      orient: 'horizontal',
      type: 'scroll',
      pageIconSize: 10, // Smaller navigation buttons
      pageTextStyle: {fontSize: 10},
      formatter: (name: string) => getSeriesDisplayName(name),
    },
    xAxis: echartsXAxisType === 'category'
      ? {
          type: 'category' as const,
          data: xAxisData,
          name: xAxisLabel,
          ...(chartType !== 'bar' && chartType !== 'combo' && { boundaryGap: false }),
          axisLabel: {
            hideOverlap: true,
            // Format labels for date/number columns displayed as categories (e.g. bar charts)
            ...(xAxisKind === 'time'
              ? { formatter: (value: string) => formatDateValue(value, xDateFormat || 'dd MMM yyyy') }
              : xAxisKind === 'value'
              ? { formatter: (value: string) => formatLargeNumber(Number(value)) }
              : { overflow: 'truncate' as const, width: 120 }),
          },
          ...(chartType === 'line' && { splitLine: { show: false } }),
        }
      : echartsXAxisType === 'time'
      ? {
          type: 'time' as const,
          name: xAxisLabel,
          ...(xMin !== undefined ? { min: xMin } : {}),
          ...(xMax !== undefined ? { max: xMax } : {}),
          axisLabel: {
            hideOverlap: true,
            formatter: (value: number) => formatDateValue(String(value), xDateFormat || 'dd MMM yyyy'),
          },
        }
      : {
          type: echartsXAxisType as 'value' | 'log',
          name: xAxisLabel,
          ...(xScaleType === 'log' ? {
            logBase: 10,
            minorTick: { show: true, splitNumber: 9 },
            splitLine: {
              show: true,
              lineStyle: {
                color: logMajorGridColor,
                type: 'dashed' as const,
                opacity: 0.45,
                width: 1,
              },
            },
            minorSplitLine: {
              show: true,
              lineStyle: {
                color: logMinorGridColor,
                type: 'dashed' as const,
                opacity: 0.45,
                width: 1,
              },
            },
            ...(xMin === undefined || xMax === undefined ? getLogExtent(positiveXAxisValues) : {}),
          } : {}),
          ...(xMin !== undefined ? { min: xMin } : {}),
          ...(xMax !== undefined ? { max: xMax } : {}),
          axisLabel: {
            hideOverlap: true,
            formatter: (value: number) => formatLargeNumber(value),
          },
        },
    yAxis: yAxisConfig,
    series: chartSeries,
  }

  // Round the outermost segment's corners for bar/row charts
  if (chartType === 'bar' || chartType === 'combo') {
    const radius = isRowChart ? [0, 3, 3, 0] : [3, 3, 0, 0]
    const seriesArr = baseOption.series as any[]
    const lastInStack: Record<string, number> = {}
    for (let i = 0; i < seriesArr.length; i++) {
      const stack = seriesArr[i].stack ?? i
      lastInStack[stack] = i
    }
    const lastIndices = new Set(Object.values(lastInStack))
    for (let i = 0; i < seriesArr.length; i++) {
      if (lastIndices.has(i)) {
        seriesArr[i].itemStyle = { ...seriesArr[i].itemStyle, borderRadius: radius }
      }
    }
  }

  // Row chart: swap axes to render horizontal bars
  if (isRowChart) {
    const categoryAxis = baseOption.xAxis as any
    const valueAxis = baseOption.yAxis as any
    // Truncate long category labels — containLabel auto-expands the grid to fit.
    // Scale the label width to the container so wide charts show more of each
    // label instead of always chopping to a fixed 75px; clamp so a row chart
    // never eats more than ~30% of its width on labels (and pathological URLs
    // still get truncated).
    const labelWidth = containerWidth
      ? Math.max(75, Math.min(Math.round(containerWidth * 0.3), 240))
      : 75
    if (categoryAxis?.axisLabel) {
      categoryAxis.axisLabel.overflow = 'truncate'
      categoryAxis.axisLabel.width = labelWidth
    }
    // Position the (rotated) axis name just left of the longest *rendered*
    // label. Basing nameGap on the truncation cap (labelWidth) overshoots when
    // labels are short and shoves the name off the left edge, so estimate the
    // real label width from the longest category (~7px/char at the 11px mono
    // axis font), capped by the truncation width.
    const longestLabelChars = xAxisData.reduce((max, d) => Math.max(max, String(d).length), 0)
    const estLabelWidth = Math.min(labelWidth, longestLabelChars * 7)
    if (categoryAxis) categoryAxis.nameGap = estLabelWidth + 15
    // Render rows in the data's given order top→bottom. ECharts plots the first
    // category at the bottom by default, which inverts a desc-sorted query.
    if (categoryAxis) categoryAxis.inverse = true
    baseOption.xAxis = valueAxis as any
    baseOption.yAxis = categoryAxis as any
  }

  return withMinusXTheme({ ...baseOption, ...additionalOptions, color: palette }, colorMode, palette)
}
