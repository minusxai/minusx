/**
 * Color and radius scaling utilities for geo visualizations.
 * Uses CHART_COLORS from the shared theme for consistency.
 */

import { CHART_COLORS } from './echarts-theme'

const MIN_RADIUS = 4
const MAX_RADIUS = 30

/** Primary color for geo markers (points, bubbles, lines) */
export const GEO_MARKER_COLOR = CHART_COLORS.teal
/** Secondary color for geo markers in dark mode */
export const GEO_MARKER_COLOR_DARK = CHART_COLORS.turquoise

/** Parse hex color to [r, g, b] */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ]
}

/** Convert [r, g, b] to hex */
function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => Math.round(n).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

/** Linearly interpolate between two hex colors. t is clamped to [0, 1]. */
export function interpolateColor(startHex: string, endHex: string, t: number): string {
  const clamped = Math.max(0, Math.min(1, t))
  const [r1, g1, b1] = hexToRgb(startHex)
  const [r2, g2, b2] = hexToRgb(endHex)
  return rgbToHex(
    r1 + (r2 - r1) * clamped,
    g1 + (g2 - g1) * clamped,
    b1 + (b2 - b1) * clamped,
  )
}

/**
 * Shared color scale definitions — used by both geo choropleth and pivot heatmap.
 * Each scale defines gradient colors for display + low/high endpoints for interpolation.
 */
export const COLOR_SCALES = [
  { key: 'green', label: 'Green', colors: ['#ebedf0', '#40c463', '#216e39'] as const },
  { key: 'blue', label: 'Blue', colors: ['#eef3ff', '#5a9bd5', '#2a6cb8'] as const },
  { key: 'red-yellow-green', label: 'RYG', colors: ['#c83c3c', '#d2b43c', '#2da08c'] as const },
] as const

export type ColorScaleKey = typeof COLOR_SCALES[number]['key']

/** 3-stop palettes per scale, per color mode: [low, mid, high] */
const SCALE_PALETTES: Record<ColorScaleKey, Record<'light' | 'dark', [string, string, string]>> = {
  'green': {
    light: ['#ebedf0', '#40c463', '#216e39'],
    dark: ['#161b22', '#2ea043', '#40c463'],
  },
  'blue': {
    light: ['#eef3ff', '#5a9bd5', '#2a6cb8'],
    dark: ['#161b22', '#3d7bbf', '#5a9bd5'],
  },
  'red-yellow-green': {
    light: ['#c83c3c', '#d2b43c', '#2da08c'],
    dark: ['#8b2020', '#b89a30', '#2da08c'],
  },
}

const DEFAULT_SCALE: ColorScaleKey = 'green'

/** Interpolate through a 3-stop gradient: low→mid (t 0–0.5), mid→high (t 0.5–1) */
function interpolate3(stops: [string, string, string], t: number): string {
  const clamped = Math.max(0, Math.min(1, t))
  if (clamped <= 0.5) {
    return interpolateColor(stops[0], stops[1], clamped * 2)
  }
  return interpolateColor(stops[1], stops[2], (clamped - 0.5) * 2)
}

/**
 * Map a numeric value to a hex color on a 3-stop sequential scale.
 * Interpolates low → mid → high for richer color transitions.
 */
export function getColorScale(
  value: number,
  min: number,
  max: number,
  colorMode: 'light' | 'dark',
  scale?: string | null,
): string {
  const scaleKey = (scale && scale in SCALE_PALETTES ? scale : DEFAULT_SCALE) as ColorScaleKey
  const stops = SCALE_PALETTES[scaleKey][colorMode]
  if (min === max) return stops[0]
  const t = (value - min) / (max - min)
  return interpolate3(stops, t)
}

/**
 * Map a numeric value to a circle radius between MIN_RADIUS and MAX_RADIUS.
 * Clamps values outside [min, max].
 */
export function getRadiusScale(value: number, min: number, max: number): number {
  if (min === max) return MIN_RADIUS
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)))
  return MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * t
}
