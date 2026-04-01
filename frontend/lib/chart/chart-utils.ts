import type { EChartsOption } from 'echarts'
import { withMinusXTheme } from './echarts-theme'
import type { ColumnFormatConfig, AxisConfig, VisualizationStyleConfig } from '@/lib/types'
import { getBrandLogoUrl, type CompanyBranding } from '@/lib/branding/whitelabel'

// Chart props interface
export interface ChartProps {
  xAxisData: string[]
  series: Array<{ name: string; data: number[] }>
  pointMeta?: Record<string, any>[]
  height?: number | string
  xAxisLabel?: string
  yAxisLabel?: string
  yAxisColumns?: string[]  // The actual Y-axis column names (for dual-axis logic)
  onChartClick?: (params: unknown) => void  // ECharts click event handler for drill-down
  columnFormats?: Record<string, ColumnFormatConfig>
  xAxisColumns?: string[]  // Actual X-axis column names (for format config lookup)
  tooltipColumns?: string[]
  chartTitle?: string  // Title shown in chart and included in downloads
  showChartTitle?: boolean  // Whether to show title in chart (always shown in downloads)
  colorPalette: string[]  // Effective color palette (hex values)
  axisConfig?: AxisConfig  // Axis scale config (linear/log)
  styleConfig?: VisualizationStyleConfig
  exportBranding?: Partial<CompanyBranding>
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

// Calculate axis label interval based on data length, container width, and max label length after truncation
export const calculateAxisInterval = (
  dataLength: number,
  containerWidth?: number,
  maxLabelChars?: number,  // Max characters after truncation
  useDualYAxis?: boolean   // Whether dual Y-axis is used (affects padding)
): number | 'auto' => {
  if (!containerWidth) {
    // Fallback to old behavior if width is not provided
    if (dataLength > 20) return Math.floor(dataLength / 6)
    if (dataLength > 10) return Math.floor(dataLength / 5)
    return 'auto'
  }

  // Account for chart padding (match the padding used in maxLabelLength calculation)
  const gridLeftPadding = 80
  const gridRightPadding = useDualYAxis ? 80 : 20
  const availableWidth = containerWidth - gridLeftPadding - gridRightPadding

  // Estimate label width based on truncated length (if provided) or reasonable default
  const avgCharWidth = 7
  const labelPadding = 20 // Space between labels
  const effectiveChars = maxLabelChars || 15 // Use truncated length for calculation
  const labelWidth = effectiveChars * avgCharWidth + labelPadding

  // Calculate how many labels can comfortably fit
  const maxVisibleLabels = Math.floor(availableWidth / labelWidth)

  // If we can show all labels comfortably, use auto
  if (dataLength <= maxVisibleLabels) {
    return 'auto'
  }

  // Calculate interval to show approximately maxVisibleLabels
  // Add small buffer (0.8x) to prevent labels from being too close
  const targetLabels = Math.floor(maxVisibleLabels * 0.8)
  const interval = Math.ceil(dataLength / Math.max(1, targetLabels))

  return interval - 1 // ECharts uses 0-based interval (0 = show all, 1 = show every other)
}

// Format large numbers with k, M, B suffixes for compact display (axis labels)
export const formatLargeNumber = (value: number): string => {
  const absValue = Math.abs(value)
  const sign = value < 0 ? '-' : ''

  if (absValue >= 1e9) {
    return `${sign}${(absValue / 1e9).toFixed(1)}B`
  }
  if (absValue >= 1e6) {
    return `${sign}${(absValue / 1e6).toFixed(1)}M`
  }
  if (absValue >= 1e3) {
    return `${sign}${(absValue / 1e3).toFixed(1)}k`
  }

  return `${sign}${absValue.toFixed(1)}`
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

// Format date string according to named format
export const DATE_FORMAT_OPTIONS = [
  { value: 'iso', label: '2024-01-15' },
  { value: 'us', label: '01/15/2024' },
  { value: 'short', label: 'Jan 15, 2024' },
  { value: 'month-year', label: "Jan'24" },
  { value: 'year', label: '2024' },
] as const

export const formatDateValue = (dateStr: string, format: string): string => {
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr

  const pad = (n: number) => n.toString().padStart(2, '0')
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
  const day = d.getUTCDate()
  const year = d.getUTCFullYear()

  switch (format) {
    case 'iso': return `${year}-${pad(d.getUTCMonth() + 1)}-${pad(day)}`
    case 'us': return `${pad(d.getUTCMonth() + 1)}/${pad(day)}/${year}`
    case 'short': return `${month} ${day}, ${year}`
    case 'month-year': return `${month}'${(year % 100).toString().padStart(2, '0')}`
    case 'year': return `${year}`
    default: return dateStr
  }
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

// Generate timestamp string for file names (e.g., "2024-01-15-143052")
export const getTimestamp = () => {
  const now = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

const loadImage = (src: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const image = new Image()
  image.crossOrigin = 'anonymous'
  image.onload = () => resolve(image)
  image.onerror = reject
  image.src = src
})

const fitTextToWidth = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number) => {
  if (ctx.measureText(text).width <= maxWidth) return text

  const ellipsis = '...'
  for (let i = text.length - 1; i > 0; i--) {
    const candidate = `${text.slice(0, i).trimEnd()}${ellipsis}`
    if (ctx.measureText(candidate).width <= maxWidth) {
      return candidate
    }
  }

  return ellipsis
}

const getExportTitleSegments = (title: string, colorMode: 'light' | 'dark') => {
  const connectorColors = {
    vs: colorMode === 'dark' ? '#4ec9b0' : '#0f766e',
    split: colorMode === 'dark' ? '#f6ad55' : '#b45309',
  }

  const segments: Array<{ text: string; color: string }> = []
  const splitByToken = ' split by '
  const vsToken = ' vs '

  const splitIndex = title.indexOf(splitByToken)
  const mainTitle = splitIndex >= 0 ? title.slice(0, splitIndex) : title
  const splitSuffix = splitIndex >= 0 ? title.slice(splitIndex + splitByToken.length) : ''

  const vsIndex = mainTitle.indexOf(vsToken)
  if (vsIndex >= 0) {
    const left = mainTitle.slice(0, vsIndex)
    const right = mainTitle.slice(vsIndex + vsToken.length)
    if (left) segments.push({ text: left, color: 'currentColor' })
    segments.push({ text: ' vs ', color: connectorColors.vs })
    if (right) segments.push({ text: right, color: 'currentColor' })
  } else if (mainTitle) {
    segments.push({ text: mainTitle, color: 'currentColor' })
  }

  if (splitIndex >= 0) {
    segments.push({ text: ' split by ', color: connectorColors.split })
    if (splitSuffix) {
      segments.push({ text: splitSuffix, color: 'currentColor' })
    }
  }

  return segments
}

const composeChartExportUrl = async ({
  chartDataUrl,
  chartTitle,
  colorMode,
  branding,
}: {
  chartDataUrl: string
  chartTitle?: string
  colorMode: 'light' | 'dark'
  branding?: Partial<CompanyBranding>
}) => {
  const chartImage = await loadImage(chartDataUrl)
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return chartDataUrl

  const theme = colorMode === 'dark'
    ? {
        background: '#161b22',
        border: 'rgba(230, 237, 243, 0.14)',
        title: '#f0f6fc',
      }
    : {
        background: '#ffffff',
        border: 'rgba(13, 17, 23, 0.10)',
        title: '#0d1117',
      }

  let logoImage: HTMLImageElement | null = null
  try {
    const logoUrl = getBrandLogoUrl(branding, colorMode)
    logoImage = await loadImage(logoUrl)
  } catch {
    logoImage = null
  }

  const hasHeader = Boolean(chartTitle)
  const headerHeight = hasHeader ? 92 : 0
  const horizontalPadding = 36
  const footerPadding = 24
  const logoSize = logoImage ? 34 : 0
  const maxTextWidth = chartImage.width - horizontalPadding * 2

  canvas.width = chartImage.width
  canvas.height = chartImage.height + headerHeight

  ctx.fillStyle = theme.background
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  if (hasHeader) {
    ctx.strokeStyle = theme.border
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, headerHeight)
    ctx.lineTo(canvas.width, headerHeight)
    ctx.stroke()

    const titleText = chartTitle?.trim() || ''
    const titleSegments = getExportTitleSegments(titleText, colorMode)
    ctx.font = '700 28px JetBrains Mono, Consolas, Monaco, Courier New, monospace'
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'

    const totalWidth = titleSegments.reduce((sum, segment) => {
      const measuredText = fitTextToWidth(ctx, segment.text, maxTextWidth)
      return sum + ctx.measureText(measuredText).width
    }, 0)

    let cursorX = Math.max(horizontalPadding, (canvas.width - totalWidth) / 2)
    const titleY = headerHeight / 2

    for (const segment of titleSegments) {
      const segmentText = fitTextToWidth(ctx, segment.text, maxTextWidth)
      ctx.fillStyle = segment.color === 'currentColor' ? theme.title : segment.color
      ctx.fillText(segmentText, cursorX, titleY)
      cursorX += ctx.measureText(segmentText).width
    }
  }

  ctx.drawImage(chartImage, 0, headerHeight, chartImage.width, chartImage.height)

  if (logoImage) {
    const logoX = canvas.width - footerPadding - logoSize
    const logoY = canvas.height - footerPadding - logoSize
    ctx.drawImage(logoImage, logoX, logoY, logoSize, logoSize)
  }

  return canvas.toDataURL('image/png')
}

interface ChartToolboxConfig {
  colorMode: 'light' | 'dark'
  downloadCsv: () => void
  chartTitle?: string
  exportBranding?: Partial<CompanyBranding>
}

// Build toolbox configuration for charts (PNG + CSV download)
export const buildToolbox = ({
  colorMode,
  downloadCsv,
  chartTitle,
  exportBranding,
}: ChartToolboxConfig) => ({
  feature: {
    mySaveAsImage: {
      show: true,
      title: '',
      icon: `image://data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${colorMode === 'dark' ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10l-3.1-3.1a2 2 0 0 0-2.814.014L6 21"/><path d="m14 19 3 3v-5.5"/><path d="m17 22 3-3"/><circle cx="9" cy="9" r="2"/></svg>`)}`,
      onclick: function (this: { ecModel: { scheduler: { ecInstance: any } } }) {
        void (async () => {
          const chart = this.ecModel?.scheduler?.ecInstance
          if (!chart) return

          const option = chart.getOption?.() ?? {}
          const currentTitle = Array.isArray(option.title) ? option.title[0] : option.title
          const currentLegend = Array.isArray(option.legend) ? option.legend[0] : option.legend
          const titleWasVisible = Boolean(chartTitle && currentTitle && currentTitle.show !== false)
          const originalLegendTop = currentLegend?.top

          if (titleWasVisible) {
            chart.setOption({
              title: { show: false },
              ...(currentLegend ? { legend: { top: 10 } } : {}),
            }, false)
          }

          try {
            const chartUrl = chart.getDataURL({
              type: 'png',
              pixelRatio: 2,
              backgroundColor: colorMode === 'dark' ? '#161b22' : '#ffffff',
              excludeComponents: ['toolbox'],
            })

            const exportUrl = await composeChartExportUrl({
              chartDataUrl: chartUrl,
              chartTitle,
              colorMode,
              branding: exportBranding,
            })

            const link = document.createElement('a')
            link.href = exportUrl
            link.download = `chart-${getTimestamp()}.png`
            link.click()
          } finally {
            if (titleWasVisible) {
              chart.setOption({
                title: { show: currentTitle?.show ?? true },
                ...(currentLegend
                  ? { legend: { top: originalLegendTop ?? 35 } }
                  : {}),
              }, false)
            }
          }
        })()
      },
    },
    myDownloadCsv: {
      show: true,
      title: '',
      icon: `image://data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${colorMode === 'dark' ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/></svg>`)}`,
      onclick: downloadCsv,
    },
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

// Helper function to detect if series need dual Y-axes
const needsDualYAxis = (series: Array<{ name: string; data: number[] }>): boolean => {
  if (series.length < 2) return false

  // Calculate scale ranges for each series
  const ranges = series.map(s => {
    const values = s.data.filter(v => !isNaN(v) && v !== null)
    if (values.length === 0) return { min: 0, max: 0, range: 0 }
    const min = Math.min(...values)
    const max = Math.max(...values)
    return { min, max, range: max - min }
  })

  // Find the largest and smallest ranges
  const validRanges = ranges.filter(r => r.range > 0)
  if (validRanges.length < 2) return false

  const maxRange = Math.max(...validRanges.map(r => r.range))
  const minRange = Math.min(...validRanges.map(r => r.range))

  // If the ratio between largest and smallest range is > 10, use dual axes
  // This threshold can be adjusted based on needs
  return maxRange / minRange > 10
}

// Helper function to assign series to Y-axes
const assignSeriesToAxes = (
  series: Array<{ name: string; data: number[] }>,
  yAxisColumns?: string[]
): number[] => {
  if (series.length < 2) return series.map(() => 0)

  // If we have 2+ Y-axis columns, check if series names match the "group - yCol" pattern
  // Only use column-based assignment if at least one series matches the pattern
  if (yAxisColumns && yAxisColumns.length >= 2) {
    // Check if any series has the " - col" pattern
    const hasGroupPattern = series.some(s =>
      yAxisColumns.some(col => s.name.endsWith(` - ${col}`))
    )

    if (hasGroupPattern) {
      // Use column-based assignment for series that match the pattern
      return series.map(s => {
        // Check which Y-column this series belongs to
        for (let i = 0; i < yAxisColumns.length; i++) {
          if (s.name.endsWith(` - ${yAxisColumns[i]}`)) {
            // First Y-column goes to left axis (0), all others to right axis (1)
            return i === 0 ? 0 : 1
          }
        }

        // Fallback: if name doesn't match pattern, assign to left axis
        return 0
      })
    }
  }

  // Use magnitude-based assignment (for ungrouped data or when pattern doesn't match)
  // Calculate average magnitude for each series
  const magnitudes = series.map(s => {
    const values = s.data.filter(v => !isNaN(v) && v !== null)
    if (values.length === 0) return 0
    const avg = values.reduce((sum, v) => sum + Math.abs(v), 0) / values.length
    return avg
  })

  // Sort series by magnitude
  const sortedIndices = magnitudes
    .map((mag, idx) => ({ mag, idx }))
    .sort((a, b) => b.mag - a.mag)

  // Assign half to left axis (0), half to right axis (1)
  const assignments = new Array(series.length).fill(0)
  const halfPoint = Math.ceil(series.length / 2)

  sortedIndices.forEach((item, rank) => {
    assignments[item.idx] = rank < halfPoint ? 0 : 1
  })

  return assignments
}

// Base chart configuration builder
interface BaseChartConfig {
  xAxisData: string[]
  series: Array<{ name: string; data: number[] }>
  xAxisLabel?: string
  yAxisLabel?: string
  yAxisColumns?: string[]
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
  exportBranding?: Partial<CompanyBranding>
}

export const buildChartOption = (config: BaseChartConfig): EChartsOption => {
  const { xAxisData, series, xAxisLabel, yAxisLabel, yAxisColumns, xAxisColumns, pointMeta, tooltipColumns, chartType, additionalOptions = {}, colorMode = 'dark', containerWidth, containerHeight, columnFormats, chartTitle, showChartTitle = true, colorPalette: palette, axisConfig, styleConfig, exportBranding } = config
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

  // Resolve format configs for axes
  const { xDateFormat, yPrefix, ySuffix } = resolveChartFormats(columnFormats, xAxisColumns, yAxisColumns)

  // Determine consistent Y-axis scale across all series
  const yScale = getNumberScale(series)

  const positiveScatterXValues = chartType === 'scatter'
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

  // Determine if we need dual Y-axes
  // Only use dual Y-axis when there are 2+ Y-axis columns (distinct metrics)
  // NOT when there are multiple series from the same metric due to splits
  const useDualYAxis = chartType === 'line' && yAxisColumns && yAxisColumns.length >= 2 && series.length > 1 && needsDualYAxis(series)
  const yAxisAssignments = useDualYAxis ? assignSeriesToAxes(series, yAxisColumns) : series.map(() => 0)

  // Calculate max length for Y-axis names based on available height
  // Y-axis text is vertical (rotated 90°), so available space = chart height - grid padding
  // Grid padding: 60px top + 60px bottom = 120px
  // Character height for vertical text ≈ fontSize (18px) since rotation makes line-height affect horizontal spacing
  const calculateMaxAxisNameLength = (): number => {
    if (!containerHeight) return 40 // Fallback (fits ~840px height)
    const gridPadding = 50 // Only subtract actual vertical padding
    const availableHeight = Math.max(containerHeight - gridPadding, 150)
    const charHeight = 14 // fontSize for vertical text
    return Math.floor(availableHeight / charHeight)
  }

  const maxAxisNameLength = calculateMaxAxisNameLength()

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

    const baseConfig = {
      name: seriesName,
      type: seriesType as 'line' | 'bar' | 'scatter',
      data: type === 'scatter'
        ? series[index].data
            .map((y, i) => ({
              value: [Number(xAxisData[i]), y] as [number, number],
              tooltipMeta: pointMeta?.[i],
            }))
            .filter(({ value: [x, y] }) => (
              isFinite(x)
              && isFinite(y)
              && (xScaleType !== 'log' || x > 0)
              && (yScaleType !== 'log' || y > 0)
            ))
        : series[index].data,
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
      case 'bar':
        return {
          ...baseConfig,
          ...(isStacked ? { stack: 'total' } : {}),
        }
      case 'area':
        const areaColor = palette[index % palette.length]
        const bottomOpacity = seriesOpacity ?? 0.5
        const topOpacity = bottomOpacity * 0.5

        return {
          ...baseConfig,
          type: 'line' as const,
          symbol: 'none',
          showSymbol: false,
          ...(isStacked ? { stack: 'total' } : {}),
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
      case 'combo':
        if (index === 0) {
          return {
            ...baseConfig,
            type: 'bar' as const,
            itemStyle: {
              ...baseConfig.itemStyle,
              opacity: seriesOpacity ?? 0.5,
            },
          }
        }
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

  // Helper to wrap long axis names - split by maxLength chars per line, truncate if exceeds max lines
  const wrapAxisName = (name: string | undefined, maxLength: number = 40): string => {
    if (!name || name.length <= maxLength) return name || ''

    const maxLines = 2  // Maximum number of lines before truncating

    // Split into chunks of maxLength
    const lines: string[] = []
    for (let i = 0; i < name.length; i += maxLength) {
      if (lines.length < maxLines) {
        lines.push(name.slice(i, i + maxLength))
      }
    }

    // If we had more content than max lines, truncate last line with ellipsis
    if (name.length > maxLength * maxLines) {
      lines[maxLines - 1] = lines[maxLines - 1].slice(0, -3) + '...'
    }

    return lines.join('\n')
  }

  // Build Y-axis names for dual axes based on which series are on each axis
  const getAxisName = (axisIndex: number): string => {
    const seriesOnAxis = series
      .filter((_, idx) => yAxisAssignments[idx] === axisIndex)
      .map(s => s.name)

    if (seriesOnAxis.length === 0) return ''
    if (seriesOnAxis.length === 1) return wrapAxisName(seriesOnAxis[0], maxAxisNameLength)

    // Multiple series on this axis - join with commas
    const combined = seriesOnAxis.join(', ')
    return wrapAxisName(combined, maxAxisNameLength)
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
    : series.map((s, idx) => ({
        name: s.name,
        itemStyle: {
          color: palette[idx % palette.length],
          opacity: 1,
        },
      }))

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
  const yLogRangeProps = yScaleType === 'log' && (yMin === undefined || yMax === undefined)
    ? getLogExtent(positiveScatterYValues)
    : {}
  const yRangeProps = {
    ...(yMin !== undefined ? { min: yMin } : {}),
    ...(yMax !== undefined ? { max: yMax } : {}),
  }
  const yAxisConfig = useDualYAxis
    ? [
        {
          type: yAxisType,
          name: getAxisName(0),
          position: 'left' as const,
          ...yExtraProps,
          ...yLogRangeProps,
          ...yRangeProps,
          axisLabel: { formatter: yAxisFormatter },
        },
        {
          type: yAxisType,
          name: getAxisName(1),
          position: 'right' as const,
          ...yExtraProps,
          ...yLogRangeProps,
          ...yRangeProps,
          axisLabel: { formatter: yAxisFormatter },
        },
      ]
    : {
        type: yAxisType,
        name: wrapAxisName(yAxisLabel, maxAxisNameLength),
        ...yExtraProps,
        ...yLogRangeProps,
        ...yRangeProps,
        axisLabel: { formatter: yAxisFormatter },
      }

  // Step 1: Detect date data characteristics for smart formatting
  type DateFormatNeeds = { needsYear: boolean; needsMonth: boolean; needsDay: boolean } | null
  const detectDateFormatNeeds = (): DateFormatNeeds => {
    const datePattern = /^\d{4}-\d{2}-\d{2}/
    const isDateData = xAxisData.length > 0 && xAxisData.every(v => datePattern.test(v))
    if (!isDateData) return null

    const dates = xAxisData.map(v => new Date(v))
    const years = new Set(dates.map(d => d.getUTCFullYear()))
    const yearMonths = new Set(dates.map(d => `${d.getUTCFullYear()}-${d.getUTCMonth()}`))
    const uniqueDates = new Set(xAxisData)

    return {
      needsYear: years.size > 1,
      needsMonth: yearMonths.size > 1,
      needsDay: uniqueDates.size > yearMonths.size,
    }
  }

  const dateFormatNeeds = detectDateFormatNeeds()

  // Step 2: Calculate label interval and max label length together
  // These are interdependent: interval affects visible label count, which affects space per label
  const prefixSuffixExtra = ((yPrefix?.length ?? 0) + (ySuffix?.length ?? 0)) * 7
  const gridLeftPadding = 80 + prefixSuffixExtra
  const gridRightPadding = useDualYAxis ? 80 : 20
  const availableWidth = containerWidth ? containerWidth - gridLeftPadding - gridRightPadding : 500
  const avgCharWidth = 7
  const labelMargin = 20

  // First pass: estimate interval with minimal label length (6 chars)
  const minLabelWidth = 6 * avgCharWidth + labelMargin
  const maxVisibleLabels = Math.floor(availableWidth / minLabelWidth)
  const estimatedInterval = xAxisData.length <= maxVisibleLabels
    ? 0  // Show all labels
    : Math.ceil(xAxisData.length / Math.max(1, Math.floor(maxVisibleLabels * 0.8))) - 1

  // Calculate actual number of visible labels based on interval
  const numVisibleLabels = estimatedInterval === 0
    ? xAxisData.length
    : Math.ceil(xAxisData.length / (estimatedInterval + 1))

  // Now calculate max label length based on space per VISIBLE label
  const spacePerVisibleLabel = availableWidth / Math.max(1, numVisibleLabels)
  const maxLabelLength = Math.max(6, Math.min(25, Math.floor((spacePerVisibleLabel - labelMargin) / avgCharWidth)))

  // Use the estimated interval (could refine further but this is good enough)
  const labelInterval = estimatedInterval
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
            const formattedX = formatLargeNumber(x)
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
              { key: yAxisLabel || 'Y', value: String(formattedY) },
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
            const raw = items[0].axisValueLabel
            const isDate = /^\d{4}-\d{2}-\d{2}/.test(raw)
            const header = xDateFormat ? formatDateValue(raw, xDateFormat) : isDate ? formatDateValue(raw, 'short') : raw
            const nonZeroItems = items.filter((p: any) => typeof p.value === 'number' ? p.value !== 0 : true)
            const rows = nonZeroItems.map((p: any) => {
              // Resolve per-series prefix/suffix: try matching series name to a Y column
              const colCfg = columnFormats?.[p.seriesName]
              const seriesPrefix = colCfg?.prefix || yPrefix
              const seriesSuffix = colCfg?.suffix || ySuffix
              const val = typeof p.value === 'number' ? applyPrefixSuffix(formatWithScale(p.value, yScale), seriesPrefix, seriesSuffix) : String(p.value)
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
    xAxis: chartType === 'scatter'
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
            ...(xMin === undefined || xMax === undefined ? getLogExtent(positiveScatterXValues) : {}),
          } : {}),
          ...(xMin !== undefined ? { min: xMin } : {}),
          ...(xMax !== undefined ? { max: xMax } : {}),
          axisLabel: {
            formatter: (value: number) => formatLargeNumber(value),
          },
        }
      : {
          type: 'category' as const,
          data: xAxisData,
          name: xAxisLabel,
          ...(chartType !== 'bar' && chartType !== 'combo' && { boundaryGap: false }),
          axisLabel: {
            interval: labelInterval,
            rotate: 0,
            formatter: (value: string) => {
              if (xDateFormat) {
                return formatDateValue(value, xDateFormat)
              }

              const date = new Date(value)
              if (!isNaN(date.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(value) && dateFormatNeeds) {
                const month = date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
                const day = date.getUTCDate()
                const year = date.getUTCFullYear()
                const shortYear = (year % 100).toString().padStart(2, '0')
                const pad = (n: number) => n.toString().padStart(2, '0')
                const { needsDay } = dateFormatNeeds

                if (maxLabelLength >= 9 && needsDay) {
                  return `${year}-${month}-${pad(day)}`
                } else if (maxLabelLength >= 6) {
                  return `${month}'${shortYear}`
                } else if (maxLabelLength >= 3) {
                  return `${year}`
                }
                return month
              }

              if (value.length > maxLabelLength) {
                return value.slice(0, maxLabelLength - 1) + '…'
              }
              return value
            },
          },
          ...(chartType === 'line' && { splitLine: { show: false } }),
        },
    yAxis: yAxisConfig,
    series: chartSeries,
  }

  return withMinusXTheme({ ...baseOption, ...additionalOptions, color: palette }, colorMode)
}
