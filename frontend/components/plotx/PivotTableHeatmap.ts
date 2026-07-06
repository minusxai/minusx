// Heatmap colour-ramp computation for PivotTable cells, extracted verbatim
// from PivotTable.tsx's getCellBg callback (pure code motion, no logic change).

export type HeatmapScale = 'red-yellow-green' | 'green' | 'blue'

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
  if (maxValue === minValue) return 'accent.teal/75'
  const normalized = (value - minValue) / (maxValue - minValue)
  const alpha = compact ? 0.85 : 0.55
  let r: number, g: number, b: number

  if (heatmapScale === 'green') {
    if (isDark) {
      // Dark mode green: near-black → #0e4429 → #26a641 → #4aea64
      if (normalized < 0.33) {
        const t = normalized / 0.33
        r = Math.round(5 + 9 * t); g = Math.round(10 + 58 * t); b = Math.round(5 + 36 * t)
      } else if (normalized < 0.66) {
        const t = (normalized - 0.33) / 0.33
        r = Math.round(0 + 38 * t); g = Math.round(109 + 57 * t); b = Math.round(50 + 15 * t)
      } else {
        const t = (normalized - 0.66) / 0.34
        r = Math.round(38 + 36 * t); g = Math.round(166 + 68 * t); b = Math.round(65 + 35 * t)
      }
    } else {
      // GitHub light mode green: #ebedf0 → #9be9a8 → #40c463 → #30a14e → #216e39
      if (normalized < 0.25) {
        const t = normalized / 0.25
        r = Math.round(235 - t * 80); g = Math.round(237 - t * 4); b = Math.round(240 - t * 72)
      } else if (normalized < 0.5) {
        const t = (normalized - 0.25) / 0.25
        r = Math.round(155 - t * 91); g = Math.round(233 - t * 37); b = Math.round(168 - t * 69)
      } else if (normalized < 0.75) {
        const t = (normalized - 0.5) / 0.25
        r = Math.round(64 - t * 16); g = Math.round(196 - t * 35); b = Math.round(99 - t * 21)
      } else {
        const t = (normalized - 0.75) / 0.25
        r = Math.round(48 - t * 15); g = Math.round(161 - t * 51); b = Math.round(78 - t * 21)
      }
    }
  } else if (heatmapScale === 'blue') {
    if (isDark) {
      // Dark mode blue: #0a1929 → #0d47a1 → #2196f3 → #6ec6ff
      if (normalized < 0.33) {
        const t = normalized / 0.33
        r = Math.round(10 + 3 * t); g = Math.round(25 + 46 * t); b = Math.round(41 + 120 * t)
      } else if (normalized < 0.66) {
        const t = (normalized - 0.33) / 0.33
        r = Math.round(13 + 20 * t); g = Math.round(71 + 79 * t); b = Math.round(161 + 82 * t)
      } else {
        const t = (normalized - 0.66) / 0.34
        r = Math.round(33 + 77 * t); g = Math.round(150 + 48 * t); b = Math.round(243 + 12 * t)
      }
    } else {
      // Light mode blue: #eef3ff → #a8c8f0 → #5a9bd5 → #2a6cb8
      if (normalized < 0.33) {
        const t = normalized / 0.33
        r = Math.round(238 - t * 70); g = Math.round(243 - t * 43); b = Math.round(255 - t * 15)
      } else if (normalized < 0.66) {
        const t = (normalized - 0.33) / 0.33
        r = Math.round(168 - t * 78); g = Math.round(200 - t * 45); b = Math.round(240 - t * 27)
      } else {
        const t = (normalized - 0.66) / 0.34
        r = Math.round(90 - t * 48); g = Math.round(155 - t * 47); b = Math.round(213 - t * 29)
      }
    }
  } else {
    // red-yellow-green (default)
    if (normalized < 0.5) {
      const t = normalized / 0.5
      r = Math.round(200 + t * 10)
      g = Math.round(60 + t * 120)
      b = 60
    } else {
      const t = (normalized - 0.5) / 0.5
      r = Math.round(210 - t * 165)
      g = Math.round(180 - t * 20)
      b = Math.round(60 + t * 80)
    }
  }

  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
