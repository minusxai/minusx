import type { EChartsOption } from 'echarts'
import type { EChartsType } from 'echarts/core'
import { withMinusXTheme } from './echarts-theme'
import type { ColumnType } from '@/lib/database/column-types'
import type { ColumnFormatConfig, AxisConfig, VisualizationStyleConfig, ChartAnnotation } from '@/lib/types'
import type { OrgBranding } from '@/lib/branding/whitelabel'

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

/**
 * Build a compact label for multiple y-columns.
 * Used for chart titles, y-axis labels, and image renderer titles.
 *
 * - Single column: returns the name as-is
 * - Multiple with common prefix (>=6 chars): returns common prefix
 * - Multiple without common prefix: returns first name + "(+N more)"
 * - maxNames controls how many names to show before "+N more" (default 1)
 */
export function buildCompactYLabel(names: string[], maxNames = 1): string {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]

  // Try to find a common prefix
  const tokenize = (value: string) => value.split(/\s+/).map(t => t.trim()).filter(Boolean)
  let commonTokens = [...tokenize(names[0])]
  for (const name of names.slice(1)) {
    const tokens = tokenize(name)
    let shared = 0
    while (shared < commonTokens.length && shared < tokens.length && commonTokens[shared] === tokens[shared]) shared++
    commonTokens = commonTokens.slice(0, shared)
    if (commonTokens.length === 0) break
  }
  let commonLabel = commonTokens.join(' ').trim().replace(/[\s(|,-]+$/, '').trim()
  if (commonLabel.length >= 6) return commonLabel

  // No meaningful common prefix — show first N names + count
  if (names.length <= maxNames) return names.join(', ')
  const suffix = ` (+${names.length - maxNames} more)`
  const shown = names.slice(0, maxNames).join(', ')
  return `${shown}${suffix}`
}

/** Truncate a string to maxLen chars, preserving a trailing "(+N more)" suffix if present */
export function truncateLabel(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s
  const suffixMatch = s.match(/(\s*\(\+\d+ more\))$/)
  if (suffixMatch) {
    const suffix = suffixMatch[1]
    const name = s.slice(0, -suffix.length)
    const available = maxLen - suffix.length - 3
    if (available >= 1) return `${name.slice(0, available)}...${suffix}`
  }
  return `${s.slice(0, maxLen - 3)}...`
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
  colorMode?: 'light' | 'dark'
  colorPalette: string[]
}

interface SpecialChartOptionConfig {
  xAxisData: string[]
  series: Array<{ name: string; data: number[] }>
  colorMode?: 'light' | 'dark'
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

interface FunnelChartOptionConfig extends SpecialChartOptionConfig {
  orientation?: 'horizontal' | 'vertical'
}

type CartesianXAxisKind = 'category' | 'time' | 'value'

const resolveCartesianXAxisKind = (
  xAxisColumns?: string[],
  columnTypes?: Record<string, ColumnType>,
): CartesianXAxisKind => {
  const primaryXColumn = xAxisColumns?.[0]
  if (!primaryXColumn) return 'category'

  switch (columnTypes?.[primaryXColumn]) {
    case 'number':
      return 'value'
    case 'date':
      return 'time'
    default:
      return 'category'
  }
}

const toCartesianAxisValue = (rawValue: string, xAxisKind: CartesianXAxisKind): string | number => {
  return xAxisKind === 'value' ? Number(rawValue) : rawValue
}

const getCartesianYValue = (value: unknown): number | undefined => {
  if (typeof value === 'number') return value
  if (Array.isArray(value) && typeof value[1] === 'number') return value[1]
  return undefined
}

const hexToRgb = (color: string): { r: number; g: number; b: number } | null => {
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

const withAlpha = (color: string, alpha: number): string => {
  const rgb = hexToRgb(color)
  if (!rgb) return color
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`
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

// Format large numbers with k, M, B suffixes for compact display (axis labels)
export const formatLargeNumber = (value: number): string => {
  const absValue = Math.abs(value)
  const sign = value < 0 ? '-' : ''

  const fmt = (n: number) => parseFloat(n.toFixed(2)).toString()

  if (absValue >= 1e9) {
    return `${sign}${fmt(absValue / 1e9)}B`
  }
  if (absValue >= 1e6) {
    return `${sign}${fmt(absValue / 1e6)}M`
  }
  if (absValue >= 1e3) {
    return `${sign}${fmt(absValue / 1e3)}k`
  }

  return `${sign}${fmt(absValue)}`
}

// Determine a consistent scale suffix based on the max absolute value across all series
type NumberScale = { divisor: number; suffix: string }
export const getNumberScale = (series: Array<{ data: number[] }>): NumberScale => {
  const maxAbs = Math.max(...series.flatMap(s => s.data.map(v => Math.abs(v || 0))))
  if (maxAbs >= 1e9) return { divisor: 1e9, suffix: 'B' }
  if (maxAbs >= 1e6) return { divisor: 1e6, suffix: 'M' }
  if (maxAbs >= 1e3) return { divisor: 1e3, suffix: 'k' }
  return { divisor: 1, suffix: '' }
}

// Format a number using a fixed scale (for consistent axis labels)
export const formatWithScale = (value: number, scale: NumberScale): string => {
  if (scale.divisor === 1) return value.toFixed(1)
  const scaled = value / scale.divisor
  // Use more decimal places for small scaled values to avoid "0.0M"
  const decimals = Math.abs(scaled) < 1 ? 2 : 1
  return `${scaled.toFixed(decimals)}${scale.suffix}`
}

// Format number with explicit decimal points (full number with commas)
export const formatNumber = (value: number, decimalPoints?: number): string => {
  if (decimalPoints === undefined) return formatLargeNumber(value)
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimalPoints,
    maximumFractionDigits: decimalPoints,
  })
}

// Wrap a formatted string with prefix/suffix
export const applyPrefixSuffix = (formatted: string, prefix?: string | null, suffix?: string | null): string => {
  return `${prefix ?? ''}${formatted}${suffix ?? ''}`
}

// Legacy named formats → pattern mapping (for data saved before pattern-based format)
const LEGACY_DATE_FORMATS: Record<string, string> = {
  'iso': 'yyyy-MM-dd',
  'us': 'MM/dd/yyyy',
  'short': 'MMM dd, yyyy',
  'month-year': "MMM'yy",
  'year': 'yyyy',
}

// Date format presets — value is a Unicode date pattern (date-fns/Intl convention)
export const DATE_FORMAT_OPTIONS = [
  { value: 'yyyy-MM-dd', label: '2024-01-15' },
  { value: 'MM/dd/yyyy', label: '01/15/2024' },
  { value: 'dd/MM/yyyy', label: '15/01/2024' },
  { value: 'MMM dd, yyyy', label: 'Jan 15, 2024' },
  { value: 'dd-MMM', label: '15-Jan' },
  { value: "MMM'yy", label: "Jan'24" }
] as const

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** Format a date string using a Unicode date pattern (yyyy, MM, dd, HH, mm, ss, MMM, MMMM). */
export const formatDateValue = (dateStr: string, format: string): string => {
  // ECharts time axis passes epoch-ms as numbers; Number("1704096000000") is finite
  // but new Date("1704096000000") returns Invalid Date — must use new Date(number)
  const numeric = Number(dateStr)
  const d = Number.isFinite(numeric) && String(numeric) === dateStr
    ? new Date(numeric)
    : new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr

  // Resolve legacy named formats
  const pattern = LEGACY_DATE_FORMATS[format] ?? format

  const pad = (n: number) => n.toString().padStart(2, '0')
  const year = d.getUTCFullYear()
  const month0 = d.getUTCMonth()
  const day = d.getUTCDate()
  const hours = d.getUTCHours()
  const minutes = d.getUTCMinutes()
  const seconds = d.getUTCSeconds()

  // Replace tokens longest-first to avoid partial matches (e.g. MMMM before MMM before MM)
  return pattern
    .replace('yyyy', String(year))
    .replace('yy', pad(year % 100))
    .replace('MMMM', FULL_MONTHS[month0])
    .replace('MMM', SHORT_MONTHS[month0])
    .replace('MM', pad(month0 + 1))
    .replace('dd', pad(day))
    .replace('HH', pad(hours))
    .replace('mm', pad(minutes))
    .replace('ss', pad(seconds))
}

// Resolve format configs for chart axes (shared by PiePlot, FunnelPlot, and buildChartOption)
export const resolveChartFormats = (
  columnFormats?: Record<string, ColumnFormatConfig>,
  xAxisColumns?: string[],
  yAxisColumns?: string[],
) => {
  const yDecimalPoints = yAxisColumns
    ?.map(col => columnFormats?.[col]?.decimalPoints)
    .find((dp): dp is number => dp != null)
  // Only use prefix/suffix on shared axis if ALL Y columns agree
  const yPrefixes = yAxisColumns?.map(col => columnFormats?.[col]?.prefix || '') ?? []
  const ySuffixes = yAxisColumns?.map(col => columnFormats?.[col]?.suffix || '') ?? []
  const allSamePrefix = yPrefixes.length > 0 && yPrefixes.every(p => p === yPrefixes[0])
  const allSameSuffix = ySuffixes.length > 0 && ySuffixes.every(s => s === ySuffixes[0])
  const yPrefix = allSamePrefix ? yPrefixes[0] || undefined : undefined
  const ySuffix = allSameSuffix ? ySuffixes[0] || undefined : undefined
  const xDateFormat = xAxisColumns
    ?.map(col => columnFormats?.[col]?.dateFormat)
    .find(Boolean)
  const fmtName = (name: string) => xDateFormat ? formatDateValue(name, xDateFormat) : name
  const fmtValue = (value: number) => applyPrefixSuffix(formatLargeNumber(value), yPrefix, ySuffix)
  return { yDecimalPoints, xDateFormat, fmtName, fmtValue, yPrefix, ySuffix, columnFormats }
}

// Validate chart data
export const isValidChartData = (xAxisData?: string[], series?: Array<{ name: string; data: number[] }>): boolean => {
  return !!(xAxisData && xAxisData.length > 0 && series && series.length > 0)
}

/** Lighten a hex color by mixing it towards white. `amount` 0–1 (0 = original, 1 = white). */
const lightenHex = (hex: string, amount: number): string => {
  const rgb = hexToRgb(hex)
  if (!rgb) return hex
  const r = Math.round(rgb.r + (255 - rgb.r) * amount)
  const g = Math.round(rgb.g + (255 - rgb.g) * amount)
  const b = Math.round(rgb.b + (255 - rgb.b) * amount)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

export const buildPieChartOption = ({
  xAxisData,
  series,
  colorMode = 'dark',
  columnFormats,
  xAxisColumns,
  yAxisColumns,
  chartTitle,
  showChartTitle = true,
  colorPalette,
  styleConfig,
  exportBranding,
  downloadCsv,
  onDownloadImage,
}: SpecialChartOptionConfig): EChartsOption => {
  const { fmtName, fmtValue } = resolveChartFormats(columnFormats, xAxisColumns, yAxisColumns)
  const borderColor = colorMode === 'dark' ? '#1a1a1a' : '#ffffff'
  const labelColor = colorMode === 'dark' ? '#ffffff' : '#1a1a1a'
  const opacityStyle = styleConfig?.opacity != null ? { opacity: styleConfig.opacity } : {}

  // Inner/summary data: one slice per xAxisData entry, summing all series
  const innerData = xAxisData.map((name, index) => {
    const value = series.reduce((sum, item) => {
      const point = item.data[index]
      return sum + (typeof point === 'number' && !isNaN(point) ? point : 0)
    }, 0)
    return { name: fmtName(name), value }
  })

  const total = innerData.reduce((sum, item) => sum + item.value, 0)
  const isNested = series.length > 1

  const coloredInnerData = innerData.map((item, index) => ({
    ...item,
    itemStyle: { color: colorPalette[index % colorPalette.length], ...opacityStyle },
  }))

  // Build series array
  const pieSeries: any[] = []

  if (isNested) {
    // Inner ring: category totals
    pieSeries.push({
      name: 'Inner',
      type: 'pie',
      radius: ['0%', '35%'],
      center: ['50%', '55%'],
      avoidLabelOverlap: true,
      itemStyle: { borderRadius: 6, borderColor, borderWidth: 2 },
      label: {
        show: true,
        position: 'inside',
        formatter: (params: any) => params.name,
        fontSize: 11,
        color: labelColor,
        textBorderColor: 'transparent',
        textBorderWidth: 0,
        textShadowColor: 'transparent',
        textShadowBlur: 0,
      },
      emphasis: {
        label: { show: true, fontSize: 13, fontWeight: 'bold', textBorderColor: 'transparent', textBorderWidth: 0, textShadowColor: 'transparent', textShadowBlur: 0 },
      },
      data: coloredInnerData,
    })

    // Outer ring: one slice per (xAxisData entry × series), skip zero-value slices
    const outerData: any[] = []
    xAxisData.forEach((xName, xIdx) => {
      const parentColor = colorPalette[xIdx % colorPalette.length]
      series.forEach((s, sIdx) => {
        const val = s.data[xIdx]
        const value = typeof val === 'number' && !isNaN(val) ? val : 0
        if (value === 0) return
        // Spread lighter shades across series within this parent
        const lightenAmount = 0.15 + (sIdx / Math.max(series.length, 1)) * 0.45
        outerData.push({
          name: `${fmtName(xName)} — ${s.name}`,
          value,
          itemStyle: { color: lightenHex(parentColor, lightenAmount), ...opacityStyle },
        })
      })
    })

    pieSeries.push({
      name: 'Outer',
      type: 'pie',
      radius: ['42%', '70%'],
      center: ['50%', '55%'],
      avoidLabelOverlap: true,
      itemStyle: { borderRadius: 10, borderColor, borderWidth: 2 },
      label: {
        show: true,
        position: 'outside',
        formatter: (params: any) => {
          const percent = ((params.value / total) * 100).toFixed(1)
          return `${params.name}\n${percent}%`
        },
        textBorderColor: 'transparent',
        textBorderWidth: 0,
        textShadowColor: 'transparent',
        textShadowBlur: 0,
        color: labelColor,
      },
      labelLine: { show: true, length: 15, length2: 10 },
      emphasis: {
        label: { show: true, fontSize: 14, fontWeight: 'bold', textBorderColor: 'transparent', textBorderWidth: 0, textShadowColor: 'transparent', textShadowBlur: 0 },
      },
      data: outerData,
    })
  } else {
    // Single-level pie (existing behavior)
    pieSeries.push({
      name: 'Pie',
      type: 'pie',
      radius: ['30%', '70%'],
      center: ['50%', '55%'],
      avoidLabelOverlap: true,
      itemStyle: { borderRadius: 10, borderColor, borderWidth: 2 },
      label: {
        show: true,
        position: 'outside',
        formatter: (params: any) => {
          const percent = ((params.value / total) * 100).toFixed(1)
          return `${params.name}\n${percent}%`
        },
        textBorderColor: 'transparent',
        textBorderWidth: 0,
        textShadowColor: 'transparent',
        textShadowBlur: 0,
        color: labelColor,
      },
      labelLine: { show: true, length: 15, length2: 10 },
      emphasis: {
        label: { show: true, fontSize: 14, fontWeight: 'bold', textBorderColor: 'transparent', textBorderWidth: 0, textShadowColor: 'transparent', textShadowBlur: 0 },
      },
      data: coloredInnerData,
    })
  }

  // Legend: show inner categories for nested, all slices for single
  const legendData = innerData.map(d => d.name)

  const baseOption: EChartsOption = {
    ...(chartTitle ? { title: { text: chartTitle, left: 'center', top: 5, show: showChartTitle } } : {}),
    ...((downloadCsv || onDownloadImage) ? {
      toolbox: buildToolbox({
        colorMode,
        downloadCsv,
        chartTitle,
        exportBranding,
        onDownloadImage,
      }),
    } : {}),
    tooltip: {
      trigger: 'item',
      appendToBody: true,
      z: 9999,
      confine: false,
      formatter: (params: any) => {
        const { name, value, percent } = params
        return `${name}<br/>Value: ${fmtValue(value)}<br/>Percent: ${percent.toFixed(1)}%`
      },
    },
    legend: {
      data: legendData,
      top: chartTitle && showChartTitle ? 35 : 10,
      orient: 'horizontal',
      type: 'scroll',
      pageIconSize: 10,
      pageTextStyle: { fontSize: 10 },
    },
    series: pieSeries,
  }

  return withMinusXTheme(baseOption, colorMode)
}

export const buildFunnelChartOption = ({
  xAxisData,
  series,
  colorMode = 'dark',
  columnFormats,
  xAxisColumns,
  yAxisColumns,
  chartTitle,
  showChartTitle = true,
  colorPalette,
  styleConfig,
  exportBranding,
  downloadCsv,
  onDownloadImage,
  orientation = 'horizontal',
}: FunnelChartOptionConfig): EChartsOption => {
  const { fmtName, fmtValue } = resolveChartFormats(columnFormats, xAxisColumns, yAxisColumns)

  const rawData = xAxisData.map((name, index) => {
    const value = series.reduce((sum, item) => {
      const point = item.data[index]
      return sum + (typeof point === 'number' && !isNaN(point) ? point : 0)
    }, 0)
    return { name: fmtName(name), value }
  })

  const baseColor = colorPalette[0]
  const maxValue = Math.max(...rawData.map(d => d.value))
  const topValue = maxValue > 0 ? maxValue : 1
  const n = rawData.length

  // Parse base color to RGB so we can apply per-stage alpha via rgba()
  // This fades the fill without affecting label opacity
  const hex = baseColor.replace('#', '')
  const bR = parseInt(hex.substring(0, 2), 16) || 0
  const bG = parseInt(hex.substring(2, 4), 16) || 0
  const bB = parseInt(hex.substring(4, 6), 16) || 0

  const funnelData = rawData.map((item, i) => {
    const alpha = styleConfig?.opacity ?? (n > 1 ? 1 - (i / (n - 1)) * 0.5 : 1)
    return {
      ...item,
      itemStyle: {
        color: `rgba(${bR}, ${bG}, ${bB}, ${alpha})`,
      },
    }
  })

  const labelColor = '#ffffff'

  const baseOption: EChartsOption = {
    ...(chartTitle ? { title: { text: chartTitle, left: 'center', top: 5, show: showChartTitle } } : {}),
    ...((downloadCsv || onDownloadImage) ? {
      toolbox: buildToolbox({
        colorMode,
        downloadCsv,
        chartTitle,
        exportBranding,
        onDownloadImage,
      }),
    } : {}),
    tooltip: {
      trigger: 'item',
      appendToBody: true,
      z: 9999,
      confine: false,
      formatter: (params: any) => {
        const { name, value } = params
        const percentOfTop = (value / topValue) * 100
        return `${name}<br/>Value: ${fmtValue(value)}<br/>Percent: ${percentOfTop.toFixed(1)}%`
      },
    },
    legend: { show: false },
    series: [
      {
        name: 'Funnel',
        type: 'funnel',
        orient: orientation,
        ...(orientation === 'horizontal'
          ? { left: '5%', right: '5%', top: chartTitle && showChartTitle ? 35 : 10, bottom: 20, width: '90%', height: '80%' }
          : { left: '10%', top: chartTitle && showChartTitle ? 35 : 10, bottom: 20, width: '80%' }
        ),
        min: 0,
        max: maxValue,
        minSize: '0%',
        maxSize: '100%',
        sort: 'none',
        gap: 2,
        label: {
          show: true,
          position: 'inside',
          color: labelColor,
          fontWeight: 'bold',
          backgroundColor: 'rgba(0,0,0,0.45)',
          borderRadius: 4,
          padding: [4, 8],
          formatter: (params: any) => {
            const pct = ((params.value / topValue) * 100).toFixed(1)
            return `${params.name}\n${fmtValue(params.value)} (${pct}%)`
          },
        },
        labelLine: {
          length: 10,
          lineStyle: {
            width: 1,
          },
        },
        itemStyle: {
          borderColor: 'transparent',
          borderWidth: 1,
        },
        emphasis: {
          label: {
            fontSize: 14,
            color: labelColor,
          },
        },
        data: funnelData,
      },
    ],
  }

  return withMinusXTheme(baseOption, colorMode)
}

export const buildWaterfallChartOption = ({
  xAxisData,
  series,
  colorMode = 'dark',
  columnFormats,
  xAxisColumns,
  yAxisColumns,
  xAxisLabel,
  yAxisLabel,
  chartTitle,
  showChartTitle = true,
  colorPalette,
  styleConfig,
  exportBranding,
  downloadCsv,
  onDownloadImage,
}: SpecialChartOptionConfig): EChartsOption => {
  const { fmtName, fmtValue, yPrefix, ySuffix } = resolveChartFormats(columnFormats, xAxisColumns, yAxisColumns)
  const yScale = getNumberScale(series)
  const xLabel = xAxisLabel || xAxisColumns?.[0]
  const yLabel = yAxisLabel || yAxisColumns?.[0]

  const values = xAxisData.map((_, index) =>
    series.reduce((sum, item) => {
      const point = item.data[index]
      return sum + (typeof point === 'number' && !isNaN(point) ? point : 0)
    }, 0)
  )

  const runningTotals: number[] = []
  const bases: number[] = []
  let cumulative = 0
  for (let i = 0; i < values.length; i++) {
    bases.push(values[i] >= 0 ? cumulative : cumulative + values[i])
    cumulative += values[i]
    runningTotals.push(cumulative)
  }

  const totalValue = cumulative
  const allLabels = [...xAxisData.map(fmtName), 'Total']
  const allValues = [...values, totalValue]
  const allRunningTotals = [...runningTotals, totalValue]
  const allBases = [...bases, 0]

  const increaseData = allValues.map((value, index) => (index === allValues.length - 1 ? 0 : value >= 0 ? value : 0))
  const decreaseData = allValues.map((value, index) => (index === allValues.length - 1 ? 0 : value < 0 ? Math.abs(value) : 0))
  const totalData = allValues.map((value, index) => (index === allValues.length - 1 ? value : 0))

  const baseOption: EChartsOption = {
    ...(chartTitle ? { title: { text: chartTitle, left: 'center', top: 5, show: showChartTitle } } : {}),
    ...((downloadCsv || onDownloadImage) ? {
      toolbox: buildToolbox({
        colorMode,
        downloadCsv,
        chartTitle,
        exportBranding,
        onDownloadImage,
      }),
    } : {}),
    tooltip: {
      trigger: 'axis',
      appendToBody: true,
      z: 9999,
      confine: false,
      axisPointer: { type: 'shadow' },
      formatter: (params: any) => {
        const items = Array.isArray(params) ? params : [params]
        const idx = items[0]?.dataIndex ?? 0
        const name = allLabels[idx]
        const value = allValues[idx]
        const total = allRunningTotals[idx]
        const isTotal = idx === allLabels.length - 1
        if (isTotal) {
          return `${name}<br/>Total: ${fmtValue(total)}`
        }
        const sign = value >= 0 ? '+' : ''
        return `${name}<br/>Change: ${sign}${fmtValue(value)}<br/>Running Total: ${fmtValue(total)}`
      },
    },
    xAxis: {
      type: 'category',
      data: allLabels,
      name: xLabel,
      axisLabel: {
        hideOverlap: true,
      },
    },
    yAxis: {
      type: 'value',
      name: yLabel,
      ...(() => {
        const formatter = (v: number) => applyPrefixSuffix(formatWithScale(v, yScale), yPrefix, ySuffix)
        const allVals = allValues.filter(isFinite)
        if (allVals.length === 0) return {}
        const maxAbs = Math.max(...allVals.map(Math.abs))
        const sampleVals = [0, maxAbs, -maxAbs, maxAbs / 2].filter(isFinite)
        const maxLen = Math.max(...sampleVals.map(v => formatter(v).length))
        const gap = Math.max(50, maxLen * 7 + 16)
        return { nameGap: gap }
      })(),
      axisLabel: {
        formatter: (value: number) => applyPrefixSuffix(formatWithScale(value, yScale), yPrefix, ySuffix),
      },
    },
    series: [
      {
        name: 'Base',
        type: 'bar',
        stack: 'waterfall',
        itemStyle: { color: 'transparent' },
        emphasis: { itemStyle: { color: 'transparent' } },
        data: allBases,
        tooltip: { show: false },
      },
      {
        name: 'Increase',
        type: 'bar',
        stack: 'waterfall',
        itemStyle: {
          color: colorPalette[0],
          ...(styleConfig?.opacity != null ? { opacity: styleConfig.opacity } : {}),
        },
        data: increaseData,
      },
      {
        name: 'Decrease',
        type: 'bar',
        stack: 'waterfall',
        itemStyle: {
          color: '#e74c3c',
          ...(styleConfig?.opacity != null ? { opacity: styleConfig.opacity } : {}),
        },
        data: decreaseData,
      },
      {
        name: 'Total',
        type: 'bar',
        stack: 'waterfall',
        itemStyle: {
          color: colorPalette[1 % colorPalette.length],
          ...(styleConfig?.opacity != null ? { opacity: styleConfig.opacity } : {}),
        },
        data: totalData,
      },
    ],
    legend: { show: false },
  }

  return withMinusXTheme(baseOption, colorMode)
}

export const buildRadarChartOption = ({
  xAxisData,
  series,
  colorMode = 'dark',
  columnFormats,
  xAxisColumns,
  yAxisColumns,
  chartTitle,
  showChartTitle = true,
  colorPalette,
  styleConfig,
  exportBranding,
  downloadCsv,
  onDownloadImage,
}: SpecialChartOptionConfig): EChartsOption => {
  const { fmtName, fmtValue } = resolveChartFormats(columnFormats, xAxisColumns, yAxisColumns)

  // Each X-axis value becomes a spoke/indicator on the radar
  // Use a single shared max across all spokes so shapes are directly comparable
  const globalMax = Math.ceil(
    Math.max(...xAxisData.flatMap((_, i) =>
      series.map(s => {
        const v = s.data[i]
        return typeof v === 'number' && !isNaN(v) ? v : 0
      })
    )) * 1.2
  ) || 1

  const indicators = xAxisData.map((name) => ({
    name: fmtName(name),
    max: globalMax,
  }))

  // Build radar data entries — one per series (Y column or split-by group)
  const radarData = series.map((s, idx) => ({
    value: s.data.map(v => (typeof v === 'number' && !isNaN(v) ? v : 0)),
    name: s.name,
    symbol: 'circle' as const,
    symbolSize: 5,
    lineStyle: {
      width: 2,
      color: colorPalette[idx % colorPalette.length],
    },
    areaStyle: {
      color: withAlpha(colorPalette[idx % colorPalette.length], 0.25),
      ...(styleConfig?.opacity != null ? { opacity: styleConfig.opacity } : {}),
    },
    itemStyle: {
      color: colorPalette[idx % colorPalette.length],
    },
  }))

  const isDark = colorMode === 'dark'

  const baseOption: EChartsOption = {
    ...(chartTitle ? { title: { text: chartTitle, left: 'center', top: 5, show: showChartTitle } } : {}),
    ...((downloadCsv || onDownloadImage) ? {
      toolbox: buildToolbox({
        colorMode,
        downloadCsv,
        chartTitle,
        exportBranding,
        onDownloadImage,
      }),
    } : {}),
    tooltip: {
      trigger: 'item',
      appendToBody: true,
      z: 9999,
      confine: false,
      formatter: (params: any) => {
        const { name, value } = params
        if (!Array.isArray(value)) return name
        const lines = indicators.map((ind, i) =>
          `${ind.name}: ${fmtValue(value[i] ?? 0)}`
        )
        return `<strong>${name}</strong><br/>${lines.join('<br/>')}`
      },
    },
    legend: {
      data: series.map(s => s.name),
      top: chartTitle && showChartTitle ? 35 : 10,
      orient: 'horizontal',
      type: 'scroll',
      pageIconSize: 10,
      pageTextStyle: { fontSize: 10 },
    },
    radar: {
      indicator: indicators,
      shape: 'polygon',
      splitNumber: 4,
      center: ['50%', '55%'],
      radius: '65%',
      axisName: {
        color: isDark ? '#a0aec0' : '#4a5568',
        fontSize: 11,
        fontFamily: 'JetBrains Mono, monospace',
      },
      axisLabel: {
        show: false,
      },
      splitArea: {
        areaStyle: {
          color: isDark
            ? ['rgba(255,255,255,0.02)', 'rgba(255,255,255,0.04)']
            : ['rgba(0,0,0,0.01)', 'rgba(0,0,0,0.03)'],
        },
      },
      splitLine: {
        lineStyle: {
          color: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
        },
      },
      axisLine: {
        lineStyle: {
          color: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)',
        },
      },
    },
    series: [
      {
        type: 'radar',
        data: radarData,
        emphasis: {
          lineStyle: { width: 3 },
          areaStyle: { opacity: 0.3 },
        },
      },
    ],
  }

  return withMinusXTheme(baseOption, colorMode)
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
  colorMode = 'dark',
  colorPalette,
}: AnnotationGraphicsConfig): EChartsOption['graphic'] => {
  if (!annotations || annotations.length === 0) return []
  if (!['line', 'bar', 'area', 'scatter'].includes(chartType)) return []
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
  const xAxisKind = resolveCartesianXAxisKind(xAxisColumns, columnTypes)
  const yAxisAssignments = useDualYAxis ? assignSeriesToYRightCols(series, yRightCols) : series.map(() => 0)
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
      if (!annotation.series) return null

      const matchedSeriesIndex = series.findIndex(item => (
        item.name === annotation.series
        || getSeriesDisplayName(item.name) === annotation.series
      ))
      if (matchedSeriesIndex === -1) return null

      const seriesMatch = series[matchedSeriesIndex]
      const matchingIndices = xAxisData
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => String(item) === String(annotation.x))
        .map(({ index }) => index)

      let pointIndex: number | null = null
      let pointY: number | null = null
      for (const index of matchingIndices) {
        const candidate = seriesMatch.data[index]
        if (typeof candidate === 'number' && Number.isFinite(candidate)) {
          pointIndex = index
          pointY = candidate
          break
        }
      }

      if (pointIndex == null || pointY == null) return null

      const finder = {
        xAxisIndex: 0,
        yAxisIndex: yAxisAssignments[matchedSeriesIndex] ?? 0,
      }

      const pixel = chart.convertToPixel(
        finder,
        [typeof annotation.x === 'number' ? annotation.x : toCartesianAxisValue(String(annotation.x), xAxisKind), pointY]
      )

      if (!Array.isArray(pixel) || !Number.isFinite(pixel[0]) || !Number.isFinite(pixel[1])) {
        return null
      }

      return {
        annotation,
        xPixel: pixel[0],
        pointYPixel: pixel[1],
        seriesIndex: matchedSeriesIndex,
      }
    })
    .filter((item): item is { annotation: ChartAnnotation; xPixel: number; pointYPixel: number; seriesIndex: number } => item !== null)
    .sort((a, b) => a.xPixel - b.xPixel)

  return annotationsWithPixels.flatMap(({ annotation, xPixel, pointYPixel, seriesIndex }, index) => {
    const lines = wrapAnnotationText(annotation.text, 24, 3)
    const width = Math.max(96, Math.min(180, Math.max(...lines.map(line => line.length), 0) * 7 + 16))
    const height = 12 + lines.length * 14

    const left = Math.min(plotRight - width, Math.max(plotLeft, xPixel - width / 2))
    const preferBottom = pointYPixel < plotTop + plotHeight * 0.42
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
    const leaderEndY = Math.min(plotBottom, Math.max(plotTop, pointYPixel))

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
          lineWidth: 1,
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
          x: left + 8,
          y: top + 7,
          text: lines.join('\n'),
          fill: labelText,
          font: '11px JetBrains Mono, Consolas, Monaco, Courier New, monospace',
          lineHeight: 14,
          width: width - 16,
          overflow: 'break',
        },
      },
      {
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
      },
    ]

    return graphics
  })
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

// Assign series to Y-axes based on explicit yRightCols.
// Series whose Y-column is in yRightCols → axis 1 (right), others → axis 0 (left).
// Works with split series (e.g. "Appetizers - orders") by checking if name ends with " - col".
const assignSeriesToYRightCols = (
  series: Array<{ name: string; data: number[] }>,
  yRightCols: string[]
): number[] => {
  // eslint-disable-next-line no-restricted-syntax -- function-local Set, not shared module state
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
  chartType: 'line' | 'bar' | 'area' | 'scatter' | 'combo'
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
  const { xAxisData, series, xAxisLabel, yAxisLabel, yAxisColumns, yRightCols, xAxisColumns, pointMeta, tooltipColumns, chartType, additionalOptions = {}, colorMode = 'dark', containerHeight, columnFormats, chartTitle, showChartTitle = true, colorPalette: palette, axisConfig, styleConfig, exportBranding, onDownloadImage, columnTypes } = config
  const xScaleType = axisConfig?.xScale ?? 'linear'
  const yScaleType = axisConfig?.yScale ?? 'linear'
  const xMin = axisConfig?.xMin ?? undefined
  const xMax = axisConfig?.xMax ?? undefined
  const yMin = axisConfig?.yMin ?? undefined
  const yMax = axisConfig?.yMax ?? undefined
  const tooltipKeyColor = 'var(--chakra-colors-fg-muted)'
  const tooltipValueColor = 'var(--chakra-colors-fg-default)'
  const seriesOpacity = styleConfig?.opacity
  const markerSize = styleConfig?.markerSize
  const isStacked = styleConfig?.stacked ?? true
  const logMajorGridColor = colorMode === 'dark' ? 'rgba(208, 215, 222, 0.8)' : 'rgba(48, 54, 61, 0.8)'
  const logMinorGridColor = colorMode === 'dark' ? 'rgba(208, 215, 222, 0.5)' : 'rgba(48, 54, 61, 0.5)'

  const xAxisKind = resolveCartesianXAxisKind(xAxisColumns, columnTypes)

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
      [toCartesianAxisValue(xAxisData[dataIndex], xAxisKind), y] as [string | number, number]
    )

    const usesPointData = type === 'scatter' || xAxisKind !== 'category'

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

    const baseConfig = {
      name: seriesName,
      type: seriesType as 'line' | 'bar' | 'scatter',
      data: usesPointData ? pointData : series[index].data,
      itemStyle: {
        color: palette[index % palette.length],
        ...(seriesOpacity != null ? { opacity: seriesOpacity } : {}),
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
          lineStyle: { opacity: seriesOpacity ?? 0.95 },
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
        const bottomOpacity = seriesOpacity ?? 0.5
        const topOpacity = bottomOpacity * 0.5

        return {
          ...baseConfig,
          type: 'line' as const,
          symbol: 'none',
          showSymbol: false,
          ...(isStacked ? { stack: stackGroup } : {}),
          areaStyle: {
            color: {
              type: 'linear' as const,
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: withAlpha(areaColor, bottomOpacity) },
                { offset: 1, color: withAlpha(areaColor, topOpacity) },
              ],
            },
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
            symbolSize: markerSize ?? 6,
            showSymbol: true,
            showAllSymbol: true,
            lineStyle: { opacity: seriesOpacity ?? 0.95, width: 2 },
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
              opacity: seriesOpacity ?? 0.5,
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
    ...(chartTitle ? { title: { text: chartTitle, left: 'center', top: 5, show: showChartTitle } } : {}),
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
          appendToBody: true,
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
          appendToBody: true,
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
            const rows = nonZeroItems.map((p: any) => {
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
            return `${header}<table style="width:100%">${rows.join('')}</table>`
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
    xAxis: xAxisKind === 'value'
      ? {
          type: (xScaleType === 'log' ? 'log' : 'value') as 'log' | 'value',
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
        }
      : xAxisKind === 'time'
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
          type: 'category' as const,
          data: xAxisData,
          name: xAxisLabel,
          ...(chartType !== 'bar' && chartType !== 'combo' && { boundaryGap: false }),
          axisLabel: {
            hideOverlap: true,
            overflow: 'truncate',
            width: 120,
          },
          ...(chartType === 'line' && { splitLine: { show: false } }),
        },
    yAxis: yAxisConfig,
    series: chartSeries,
  }

  return withMinusXTheme({ ...baseOption, ...additionalOptions, color: palette }, colorMode)
}
