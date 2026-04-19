import type { TrendCompareMode } from '@/lib/types.gen'

export interface TrendComparison {
  /** The displayed value — the "base" of the comparison (last point in 'last' mode, second-to-last in 'previous' mode) */
  currentValue: number
  /** Percentage change between the two compared periods, or null if not computable */
  percentChange: number | null
  /** The earlier of the two compared values (previous period) */
  compareValue: number | null
  /** The later of the two compared values (base period) */
  compareBaseValue: number | null
  /** Label for the earlier compared period */
  compareLabel: string | undefined
  /** Label for the later compared period (base) */
  compareBaseLabel: string | undefined
}

/**
 * Compute trend comparison for a data series.
 *
 * compareMode controls which data points are compared:
 * - 'last' (default): last vs second-to-last — includes the (possibly partial) current period
 * - 'previous': second-to-last vs third-to-last — skips partial current period
 *
 * With exactly 2 points: compares them directly regardless of mode.
 * With 0-1 points: no comparison available.
 */
export function computeTrendComparison(
  data: number[],
  labels?: string[],
  compareMode: TrendCompareMode = 'last',
): TrendComparison {
  const empty: TrendComparison = { currentValue: 0, percentChange: null, compareValue: null, compareBaseValue: null, compareLabel: undefined, compareBaseLabel: undefined }

  if (data.length === 0) return empty

  if (data.length === 1) return { ...empty, currentValue: data[0] || 0 }

  // 'last' mode: compare last (base) vs second-to-last (previous)
  // 'previous' mode with 3+ points: compare second-to-last (base) vs third-to-last (previous)
  // With exactly 2 points: always compare last vs first
  let baseIdx: number
  let prevIdx: number

  if (data.length === 2) {
    baseIdx = 1
    prevIdx = 0
  } else if (compareMode === 'previous') {
    baseIdx = data.length - 2
    prevIdx = data.length - 3
  } else {
    baseIdx = data.length - 1
    prevIdx = data.length - 2
  }

  const compareBaseValue = data[baseIdx]
  const compareValue = data[prevIdx]
  const compareBaseLabel = labels?.[baseIdx]
  const compareLabel = labels?.[prevIdx]

  // The displayed "big number" is the base of the comparison
  const currentValue = compareBaseValue

  let percentChange: number | null = null
  if (compareValue !== null && compareValue !== 0) {
    percentChange = ((compareBaseValue - compareValue) / Math.abs(compareValue)) * 100
  }

  return { currentValue, percentChange, compareValue, compareBaseValue, compareBaseLabel, compareLabel }
}
