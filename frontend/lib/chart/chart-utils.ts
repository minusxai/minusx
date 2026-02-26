import type { EChartsOption } from 'echarts'
import { withMinusXTheme, COLOR_PALETTE } from './echarts-theme'
import type { ColumnFormatConfig } from '@/lib/types'

// Chart props interface
export interface ChartProps {
  xAxisData: string[]
  series: Array<{ name: string; data: number[] }>
  height?: number | string
  xAxisLabel?: string
  yAxisLabel?: string
  yAxisColumns?: string[]  // The actual Y-axis column names (for dual-axis logic)
  onChartClick?: (params: unknown) => void  // ECharts click event handler for drill-down
  columnFormats?: Record<string, ColumnFormatConfig>
  xAxisColumns?: string[]  // Actual X-axis column names (for format config lookup)
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

// Format date string according to named format
export const DATE_FORMAT_OPTIONS = [
  { value: 'iso', label: '2024-01-15' },
  { value: 'us', label: '01/15/2024' },
  { value: 'eu', label: '15/01/2024' },
  { value: 'short', label: 'Jan 15, 2024' },
  { value: 'month-year', label: 'Jan 2024' },
  { value: 'year', label: '2024' },
] as const

export const formatDateValue = (dateStr: string, format: string): string => {
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr

  const pad = (n: number) => n.toString().padStart(2, '0')
  const month = d.toLocaleString('en-US', { month: 'short' })
  const day = d.getDate()
  const year = d.getFullYear()

  switch (format) {
    case 'iso': return `${year}-${pad(d.getMonth() + 1)}-${pad(day)}`
    case 'us': return `${pad(d.getMonth() + 1)}/${pad(day)}/${year}`
    case 'eu': return `${pad(day)}/${pad(d.getMonth() + 1)}/${year}`
    case 'short': return `${month} ${day}, ${year}`
    case 'month-year': return `${month} ${year}`
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
  const xDateFormat = xAxisColumns
    ?.map(col => columnFormats?.[col]?.dateFormat)
    .find(Boolean)
  const fmtName = (name: string) => xDateFormat ? formatDateValue(name, xDateFormat) : name
  const fmtValue = (value: number) => formatNumber(value, yDecimalPoints)
  return { yDecimalPoints, xDateFormat, fmtName, fmtValue }
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

// Build toolbox configuration for charts (PNG + CSV download)
export const buildToolbox = (
  colorMode: 'light' | 'dark',
  downloadCsv: () => void
) => ({
  feature: {
    saveAsImage: {
      type: 'png' as const,
      name: `chart-${getTimestamp()}`,
      title: '',
      pixelRatio: 2,
      backgroundColor: colorMode === 'dark' ? '#1a1a1a' : '#ffffff',
      icon: `image://data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${colorMode === 'dark' ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10l-3.1-3.1a2 2 0 0 0-2.814.014L6 21"/><path d="m14 19 3 3v-5.5"/><path d="m17 22 3-3"/><circle cx="9" cy="9" r="2"/></svg>`)}`,
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
        saveAsImage: 'Save as PNG',
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
  chartType: 'line' | 'bar' | 'area' | 'scatter'
  additionalOptions?: Partial<EChartsOption>
  colorMode?: 'light' | 'dark'
  containerWidth?: number
  containerHeight?: number
  columnFormats?: Record<string, ColumnFormatConfig>
}

export const buildChartOption = (config: BaseChartConfig): EChartsOption => {
  const { xAxisData, series, xAxisLabel, yAxisLabel, yAxisColumns, xAxisColumns, chartType, additionalOptions = {}, colorMode = 'dark', containerWidth, containerHeight, columnFormats } = config

  // Resolve format configs for axes
  const { yDecimalPoints, xDateFormat } = resolveChartFormats(columnFormats, xAxisColumns, yAxisColumns)

  // Determine consistent Y-axis scale across all series
  const yScale = getNumberScale(series)

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
        ? series[index].data.map((y, i) => [xAxisData[i], y])
        : series[index].data,
      itemStyle: {
        color: COLOR_PALETTE[index % COLOR_PALETTE.length],
      },
      ...(useDualYAxis && { yAxisIndex: yAxisAssignments[index] }),
    }

    switch (type) {
      case 'line':
        return {
          ...baseConfig,
          symbol: 'circle',
          symbolSize: 5,
          showSymbol: true,
          lineStyle: { opacity: 0.95 },
        }
      case 'bar':
        return {
          ...baseConfig,
          stack: 'total',
        }
      case 'area':
        return {
          ...baseConfig,
          symbol: 'none',
          showSymbol: false,
          stack: 'total',
          areaStyle: {},
        }
      case 'scatter':
        return {
          ...baseConfig,
          symbolSize: 8,
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

  // Build Y-axis configuration (single or dual)
  const yAxisConfig = useDualYAxis
    ? [
        {
          type: 'value' as const,
          name: getAxisName(0), // Left axis shows names of series on left
          position: 'left' as const,
          axisLabel: {
            formatter: (value: number) => formatWithScale(value, yScale),
          },
        },
        {
          type: 'value' as const,
          name: getAxisName(1), // Right axis shows names of series on right
          position: 'right' as const,
          axisLabel: {
            formatter: (value: number) => formatWithScale(value, yScale),
          },
        },
      ]
    : {
        type: 'value' as const,
        name: wrapAxisName(yAxisLabel, maxAxisNameLength),
        axisLabel: {
          formatter: (value: number) => formatWithScale(value, yScale),
        },
      }

  // Step 1: Detect date data characteristics for smart formatting
  type DateFormatNeeds = { needsYear: boolean; needsMonth: boolean; needsDay: boolean } | null
  const detectDateFormatNeeds = (): DateFormatNeeds => {
    const datePattern = /^\d{4}-\d{2}-\d{2}/
    const isDateData = xAxisData.length > 0 && xAxisData.every(v => datePattern.test(v))
    if (!isDateData) return null

    const dates = xAxisData.map(v => new Date(v))
    const years = new Set(dates.map(d => d.getFullYear()))
    const yearMonths = new Set(dates.map(d => `${d.getFullYear()}-${d.getMonth()}`))
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
  const gridLeftPadding = 80
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
    const headers = [xAxisLabel || 'X', ...series.map(s => s.name)]

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
    toolbox: buildToolbox(colorMode, downloadCsv),
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
            const [x, y] = params.data
            const formattedX = x
            const formattedY = typeof y === 'number' ? formatNumber(y, yDecimalPoints) : y
            return `${params.seriesName}<br/>${xAxisLabel || 'X'}: ${formattedX}<br/>${yAxisLabel || 'Y'}: ${formattedY}`
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
          valueFormatter: (value: any) => {
            return typeof value === 'number' ? formatNumber(value, yDecimalPoints) : String(value)
          },
        },
    legend: {
      data: useDualYAxis
        ? // Sort legend: all L-axis items first, then R-axis items
          series
            .map((s, idx) => ({
              name: `${s.name} (${yAxisAssignments[idx] === 0 ? 'L' : 'R'})`,
              axis: yAxisAssignments[idx],
            }))
            .sort((a, b) => a.axis - b.axis) // Sort by axis (0=L first, 1=R second)
            .map(item => item.name)
        : series.map(s => s.name),
      top: 10,
      orient: 'horizontal',
      type: series.length > 10 ? 'scroll' : 'plain',
      pageIconSize: 10, // Smaller navigation buttons
      pageTextStyle: {fontSize: 10},
    },
    xAxis: {
      type: 'category',
      data: xAxisData,
      name: xAxisLabel,
      ...(chartType !== 'bar' && { boundaryGap: false }),
      axisLabel: {
        interval: labelInterval, // Use pre-calculated interval based on truncated label length
        rotate: 0, // Keep labels horizontal by default
        formatter: (value: string) => {
          // Use explicit date format if configured
          if (xDateFormat) {
            return formatDateValue(value, xDateFormat)
          }

          // Try to parse as date and format based on available space
          // Priority when space is tight: Year > Month > Day
          const date = new Date(value)
          if (!isNaN(date.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(value) && dateFormatNeeds) {
            const month = date.toLocaleString('en-US', { month: 'short' })
            const day = date.getDate()
            const year = date.getFullYear()
            const shortYear = (year % 100).toString().padStart(2, '0')
            const { needsDay } = dateFormatNeeds

            // Always try to show year first (most important), then month, then day
            // Only drop components when space is insufficient
            if (maxLabelLength >= 9 && needsDay) {
              return `${day}-${month}-${shortYear}` // "31-Dec-24" (9 chars) - full detail
            } else if (maxLabelLength >= 6) {
              return `${month}'${shortYear}` // "Dec'24" (6 chars) - drop day, keep year+month
            } else if (maxLabelLength >= 3) {
              return `'${shortYear}` // "'24" (3 chars) - year only
            }
            return month // "Dec" - fallback
          }

          // Dynamically truncate long labels based on available space
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

  return withMinusXTheme({ ...baseOption, ...additionalOptions }, colorMode)
}
