import { computeHeatmapOptions } from '../geo-heatmap-defaults'

describe('computeHeatmapOptions', () => {
  it('should normalize intensity values to 0-1 range', () => {
    const points: [number, number, number][] = [
      [37.7, -122.4, 100],
      [37.8, -122.3, 500],
      [37.9, -122.2, 300],
    ]
    const { points: normalized } = computeHeatmapOptions(points, { weighted: true })
    // min=100, max=500 → normalized to 0.12-1.0 with a wider dynamic range.
    expect(normalized[0][2]).toBeCloseTo(0.12)
    expect(normalized[1][2]).toBeCloseTo(1)
    expect(normalized[2][2]).toBeGreaterThan(0.52)
    expect(normalized[2][2]).toBeLessThan(0.54)
  })

  it('should handle uniform intensity (all same value)', () => {
    const points: [number, number, number][] = [
      [37.7, -122.4, 50],
      [37.8, -122.3, 50],
    ]
    const { points: normalized } = computeHeatmapOptions(points, { weighted: true })
    // All same → all get intensity 1
    expect(normalized[0][2]).toBe(1)
    expect(normalized[1][2]).toBe(1)
  })

  it('should ignore raw weights when weighted mode is off', () => {
    const points: [number, number, number][] = [
      [37.7, -122.4, 100],
      [37.8, -122.3, 500],
    ]
    const { points: normalized } = computeHeatmapOptions(points)
    expect(normalized[0][2]).toBe(1)
    expect(normalized[1][2]).toBe(1)
  })

  it('should make weighted heatmaps materially different from unweighted ones', () => {
    const points: [number, number, number][] = [
      [37.7, -122.4, 100],
      [37.8, -122.3, 500],
      [37.9, -122.2, 300],
    ]
    const weighted = computeHeatmapOptions(points, { weighted: true })
    const unweighted = computeHeatmapOptions(points)
    expect(weighted.points[0][2]).not.toBe(unweighted.points[0][2])
    expect(weighted.points[2][2]).not.toBe(unweighted.points[2][2])
  })

  it('should use larger radius for few points (aggregated data)', () => {
    const fewPoints: [number, number, number][] = Array.from({ length: 10 }, (_, i) => [37 + i * 0.1, -122, 1])
    const manyPoints: [number, number, number][] = Array.from({ length: 5000 }, (_, i) => [37 + i * 0.0001, -122, 1])

    const fewResult = computeHeatmapOptions(fewPoints)
    const manyResult = computeHeatmapOptions(manyPoints)

    expect(fewResult.radius).toBeGreaterThan(manyResult.radius)
  })

  it('should scale blur proportionally to radius', () => {
    const points: [number, number, number][] = Array.from({ length: 100 }, (_, i) => [37 + i * 0.01, -122, 1])
    const { radius, blur } = computeHeatmapOptions(points)
    expect(blur).toBeGreaterThanOrEqual(radius)
    expect(blur).toBeGreaterThan(0)
  })

  it('should clamp radius within reasonable bounds', () => {
    const onePoint: [number, number, number][] = [[37.7, -122.4, 1]]
    const hugeDataset: [number, number, number][] = Array.from({ length: 100000 }, (_, i) => [37 + i * 0.00001, -122, 1])

    const { radius: r1 } = computeHeatmapOptions(onePoint)
    const { radius: r2 } = computeHeatmapOptions(hugeDataset)

    expect(r1).toBeLessThanOrEqual(48)
    expect(r2).toBeGreaterThanOrEqual(18)
  })

  it('should saturate faster for sparse point sets', () => {
    const sparsePoints: [number, number, number][] = Array.from({ length: 8 }, (_, i) => [37 + i * 0.02, -122, 1])
    const densePoints: [number, number, number][] = Array.from({ length: 5000 }, (_, i) => [37 + i * 0.0001, -122, 1])

    const sparseResult = computeHeatmapOptions(sparsePoints)
    const denseResult = computeHeatmapOptions(densePoints)

    expect(sparseResult.max).toBeLessThan(denseResult.max)
    expect(sparseResult.max).toBeGreaterThanOrEqual(0.12)
    expect(denseResult.max).toBeLessThanOrEqual(0.24)
  })
})
