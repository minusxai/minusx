/**
 * Compute smart heatmap options based on data characteristics.
 * Boosts sparse datasets so the layer still reads like a heatmap
 * instead of a faint geographic wash.
 */
export function computeHeatmapOptions(
  points: [number, number, number][],
  options?: { weighted?: boolean }
): { points: [number, number, number][]; radius: number; blur: number; maxZoom: number; max: number } {
  const weighted = options?.weighted ?? false
  let minVal = Infinity
  let maxVal = -Infinity
  for (const [,, v] of points) {
    if (v < minVal) minVal = v
    if (v > maxVal) maxVal = v
  }
  const range = maxVal - minVal
  const normalized: [number, number, number][] = weighted && range > 0
    ? points.map(([lat, lng, v]) => {
        // Preserve a much wider dynamic range so adding a value column
        // materially changes the heatmap compared with pure point density.
        const MIN_INTENSITY = 0.12
        const INTENSITY_GAMMA = 1.1
        return [
          lat,
          lng,
          MIN_INTENSITY + (1 - MIN_INTENSITY) * Math.pow((v - minVal) / range, INTENSITY_GAMMA),
        ]
      })
    : points.map(([lat, lng]) => [lat, lng, 1])

  // Sparse datasets need noticeably larger blobs to look like density.
  const radius = Math.round(Math.max(18, Math.min(48, 320 / Math.sqrt(points.length))))
  const blur = Math.round(radius * 1.1)
  const maxZoom = 18
  // Lower max so single points can still bloom; raise it slightly for denser sets
  // to preserve variation once many blobs overlap.
  const max = Math.max(0.12, Math.min(0.24, 0.08 + Math.log10(points.length + 1) * 0.05))

  return { points: normalized, radius, blur, maxZoom, max }
}
