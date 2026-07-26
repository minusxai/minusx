/**
 * The selectable colour scales for geo visualizations.
 *
 * Only the catalogue survives here. The interpolation, radius-scaling and
 * heat-gradient helpers this module used to carry belonged to the Leaflet map
 * renderer; geo now renders through Vega recipes (`minusx/choropleth@1`,
 * `minusx/point-map@1` — see `lib/viz/from-vizsettings.ts`), which resolve their
 * own scales, so nothing consumed them any more.
 */

export const COLOR_SCALES = [
  { key: 'green', label: 'Green', colors: ['#ebedf0', '#40c463', '#216e39'] as const },
  { key: 'blue', label: 'Blue', colors: ['#eef3ff', '#5a9bd5', '#2a6cb8'] as const },
  { key: 'red-yellow-green', label: 'RYG', colors: ['#c83c3c', '#d2b43c', '#2da08c'] as const },
] as const

export type ColorScaleKey = typeof COLOR_SCALES[number]['key']
