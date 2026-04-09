/**
 * Color and radius scaling utilities for geo visualizations.
 */

const MIN_RADIUS = 4
const MAX_RADIUS = 30

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

/** Color palettes for choropleth: [low, high] */
const PALETTES = {
  light: { low: '#d4edda', high: '#155724' },
  dark: { low: '#1a3a2a', high: '#48d483' },
}

/**
 * Map a numeric value to a hex color on a sequential scale.
 * Returns a color between the low and high ends of the palette.
 */
export function getColorScale(
  value: number,
  min: number,
  max: number,
  colorMode: 'light' | 'dark',
): string {
  const palette = PALETTES[colorMode]
  if (min === max) return palette.low
  const t = (value - min) / (max - min)
  return interpolateColor(palette.low, palette.high, t)
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
