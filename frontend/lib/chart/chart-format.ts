import type { ColumnFormatConfig } from '@/lib/types'

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
  // Strip trailing separators with a linear walk rather than a `[…]+$` regex
  // (CodeQL js/polynomial-redos flags those as O(n²) worst-case on backtracking).
  const joined = commonTokens.join(' ').trim()
  const SEP_RE = /[\s(|,\-]/
  let endIdx = joined.length
  while (endIdx > 0 && SEP_RE.test(joined[endIdx - 1])) endIdx--
  const commonLabel = joined.slice(0, endIdx)
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
export type NumberScale = { divisor: number; suffix: string }
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
