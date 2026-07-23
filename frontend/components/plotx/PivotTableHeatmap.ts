// Heatmap cell background for PivotTable cells. The colour-ramp math lives in
// the shared lib/chart/color-scale.ts (one vocabulary across all grids); this
// wrapper adds the pivot-specific concerns: heatmap toggle, absent-cell fill,
// flat-domain fallback, and the compact-mode alpha.

import { getScaleColor, type ColorScaleName } from '@/lib/chart/color-scale'

export type HeatmapScale = ColorScaleName

export interface GetPivotCellBgParams {
  value: number
  minValue: number
  maxValue: number
  showHeatmap: boolean
  compact: boolean
  heatmapScale: HeatmapScale
  isDark: boolean
  absentBg: string
  present?: boolean
}

export const getPivotCellBg = ({
  value,
  minValue,
  maxValue,
  showHeatmap,
  compact,
  heatmapScale,
  isDark,
  absentBg,
  present = true,
}: GetPivotCellBgParams): string | undefined => {
  if (!showHeatmap) return undefined
  if (!present) return absentBg
  if (maxValue === minValue) return 'color-mix(in srgb, #16a085 75%, transparent)'
  const normalized = (value - minValue) / (maxValue - minValue)
  const alpha = compact ? 0.85 : 0.55
  return getScaleColor(normalized, heatmapScale, isDark, alpha)
}
