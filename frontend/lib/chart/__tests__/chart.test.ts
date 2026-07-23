import { formatDateValue } from '@/lib/chart/chart-format'
import { getColorScale, getHeatGradient, getRadiusScale, interpolateColor, COLOR_SCALES } from '@/lib/chart/geo-color-scale'
import { getGeoConstraintError } from '@/lib/chart/geo-constraints'
import type { GeoConfig } from '@/lib/types'
import { computeHeatmapOptions } from '../geo-heatmap-defaults'
import { parseGeoNumber } from '@/lib/chart/geo-value-utils'
import { aggregatePivotData } from '../pivot-utils'
import type { PivotConfig } from '@/lib/types'
import { computeTrendComparison } from '@/lib/chart/trend-utils'
import { getVizConstraintError, getVizSettingsWarning } from '@/lib/chart/viz-constraints'

const DATE = '2024-01-15T14:05:09Z'
const DATE_ONLY = '2024-01-15'
const geoColumns = ['state', 'revenue', 'lat', 'lng', 'lat2', 'lng2', 'intensity']

// ─── chart-utils.test.ts ───

describe('formatDateValue', () => {
  describe('pattern-based formatting', () => {
    it.each([
      ['formats yyyy-MM-dd', DATE, 'yyyy-MM-dd', '2024-01-15'],
      ['formats MM/dd/yyyy', DATE, 'MM/dd/yyyy', '01/15/2024'],
      ['formats dd/MM/yyyy', DATE, 'dd/MM/yyyy', '15/01/2024'],
      ['formats MMM dd, yyyy (short month)', DATE, 'MMM dd, yyyy', 'Jan 15, 2024'],
      ['formats MMMM dd, yyyy (full month)', DATE, 'MMMM dd, yyyy', 'January 15, 2024'],
      ["formats MMM'yy", DATE, "MMM'yy", "Jan'24"],
      ['formats yyyy alone', DATE, 'yyyy', '2024'],
      ['formats yy (2-digit year)', DATE, 'yy', '24'],
      ['formats time HH:mm:ss', DATE, 'HH:mm:ss', '14:05:09'],
      ['formats date + time yyyy-MM-dd HH:mm', DATE, 'yyyy-MM-dd HH:mm', '2024-01-15 14:05'],
      ['handles date-only input strings', DATE_ONLY, 'MM/dd/yyyy', '01/15/2024'],
      ['preserves literal separators (dot)', DATE, 'dd.MM.yyyy', '15.01.2024'],
      ['preserves literal separators (dash)', DATE, 'dd-MM-yyyy', '15-01-2024'],
    ])('%s', (_desc, input, pattern, expected) => {
      expect(formatDateValue(input, pattern)).toBe(expected)
    })
  })

  describe('legacy named format compat', () => {
    it.each([
      ['maps "iso" to yyyy-MM-dd', 'iso', '2024-01-15'],
      ['maps "us" to MM/dd/yyyy', 'us', '01/15/2024'],
      ['maps "short" to MMM dd, yyyy', 'short', 'Jan 15, 2024'],
      ["maps 'month-year' to MMM'yy", 'month-year', "Jan'24"],
      ['maps "year" to yyyy', 'year', '2024'],
    ])('%s', (_desc, format, expected) => {
      expect(formatDateValue(DATE, format)).toBe(expected)
    })
  })

  describe('edge cases', () => {
    it.each([
      ['returns original string for invalid date', 'not-a-date', 'yyyy-MM-dd', 'not-a-date'],
      ['returns original string for empty string', '', 'yyyy-MM-dd', ''],
      ['handles different months correctly (MMM)', '2024-12-25', 'MMM', 'Dec'],
      ['handles different months correctly (MMMM)', '2024-06-01', 'MMMM', 'June'],
      ['handles different months correctly (MMM dd)', '2024-02-14', 'MMM dd', 'Feb 14'],
      ['zero-pads single-digit day and month', '2024-03-05', 'dd/MM/yyyy', '05/03/2024'],
      ['zero-pads midnight time', '2024-01-15T00:00:00Z', 'HH:mm:ss', '00:00:00'],
    ])('%s', (_desc, input, pattern, expected) => {
      expect(formatDateValue(input, pattern)).toBe(expected)
    })
  })
})

describe('interpolateColor', () => {
  it.each([
    ['returns start color at t=0', '#000000', '#ffffff', 0, '#000000'],
    ['returns end color at t=1', '#000000', '#ffffff', 1, '#ffffff'],
    ['returns midpoint color at t=0.5', '#000000', '#ffffff', 0.5, '#808080'],
    ['clamps t below 0 to start color', '#ff0000', '#0000ff', -0.5, '#ff0000'],
    ['clamps t above 1 to end color', '#ff0000', '#0000ff', 1.5, '#0000ff'],
  ])('%s', (_desc, start, end, t, expected) => {
    expect(interpolateColor(start, end, t)).toBe(expected)
  })
})

describe('getColorScale', () => {
  it.each([
    ['returns low color for minimum value', 0],
    ['returns high color for maximum value', 100],
    ['handles min === max without crashing', 50, 50, 50],
  ])('%s', (_desc, value, min = 0, max = 100) => {
    const color = getColorScale(value, min, max, 'light')
    expect(color).toBeDefined()
    expect(color).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('returns different colors for different values', () => {
    const low = getColorScale(10, 0, 100, 'light')
    const high = getColorScale(90, 0, 100, 'light')
    expect(low).not.toBe(high)
  })

  it('returns different palettes for light vs dark mode', () => {
    const light = getColorScale(50, 0, 100, 'light')
    const dark = getColorScale(50, 0, 100, 'dark')
    expect(light).toMatch(/^#[0-9a-f]{6}$/)
    expect(dark).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('uses different colors for different scale keys', () => {
    const green = getColorScale(80, 0, 100, 'light', 'green')
    const blue = getColorScale(80, 0, 100, 'light', 'blue')
    const ryg = getColorScale(80, 0, 100, 'light', 'red-yellow-green')
    expect(green).not.toBe(blue)
    expect(blue).not.toBe(ryg)
  })

  it.each([
    ['falls back to default scale for unknown key', 'nonexistent'],
    ['falls back to default scale for null', null],
    ['falls back to default scale for undefined', undefined],
  ])('%s', (_desc, scaleKey) => {
    const defaultColor = getColorScale(50, 0, 100, 'light')
    expect(getColorScale(50, 0, 100, 'light', scaleKey)).toBe(defaultColor)
  })
})

describe('COLOR_SCALES', () => {
  it('has at least 2 scale options', () => {
    expect(COLOR_SCALES.length).toBeGreaterThanOrEqual(2)
  })

  it('each scale has key, label, and 3 colors', () => {
    for (const scale of COLOR_SCALES) {
      expect(scale.key).toBeTruthy()
      expect(scale.label).toBeTruthy()
      expect(scale.colors).toHaveLength(3)
      for (const c of scale.colors) {
        expect(c).toMatch(/^#[0-9a-fA-F]{6}$/)
      }
    }
  })
})

describe('getHeatGradient', () => {
  it('starts transparent so low-intensity heat fades naturally', () => {
    const gradient = getHeatGradient('light', 'red-yellow-green')
    expect(gradient[0]).toMatch(/^rgba\(\d+, \d+, \d+, 0\)$/)
    expect(gradient[1]).toMatch(/^#[0-9a-f]{6}$/)
    expect(gradient[0.6]).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('falls back to the default palette for unknown keys', () => {
    expect(getHeatGradient('light', 'nope')).toEqual(getHeatGradient('light'))
  })
})

describe('getRadiusScale', () => {
  it.each([
    // [desc, value, min, max, minRadius, scale, expected]
    ['returns minimum radius for minimum value', 0, 0, 100, undefined, undefined, 4],
    ['returns maximum radius for maximum value', 100, 0, 100, undefined, undefined, 30],
    ['handles min === max', 50, 50, 50, undefined, undefined, 4],
    ['clamps values below min', -10, 0, 100, undefined, undefined, 4],
    ['clamps values above max', 200, 0, 100, undefined, undefined, 30],
    ['uses custom minRadius when provided', 0, 0, 100, 10, undefined, 10],
    ['uses custom minRadius for min===max fallback', 50, 50, 50, 10, undefined, 10],
    ['scales between custom minRadius and MAX_RADIUS', 100, 0, 100, 10, undefined, 30],
    ['interpolates correctly with custom minRadius', 50, 0, 100, 10, undefined, 20],
    ['scale=2 doubles all radii', 50, 0, 100, undefined, 2, 34],
    ['scale applies to min value too', 0, 0, 100, undefined, 3, 12],
    ['scale applies to min===max fallback', 50, 50, 50, 10, 2, 20],
  ])('%s', (_desc, value, min, max, minRadius, scale, expected) => {
    expect(getRadiusScale(value, min, max, minRadius, scale)).toBe(expected)
  })

  it('returns intermediate radius for middle value', () => {
    const r = getRadiusScale(50, 0, 100)
    expect(r).toBeGreaterThan(4)
    expect(r).toBeLessThan(30)
  })

  it('scale=1 is same as default', () => {
    expect(getRadiusScale(50, 0, 100, undefined, 1)).toBe(getRadiusScale(50, 0, 100))
  })
})

describe('getGeoConstraintError', () => {
  // expected: a substring the error must contain, null = no error, TRUTHY = some error
  const TRUTHY = Symbol('truthy-error')

  it.each<{ desc: string; config: GeoConfig | undefined; expected: string | null | typeof TRUTHY }>([
    // choropleth
    { desc: 'choropleth requires regionCol', config: { subType: 'choropleth', mapName: 'us-states', valueCol: 'revenue' }, expected: 'Region' },
    { desc: 'choropleth requires valueCol', config: { subType: 'choropleth', mapName: 'us-states', regionCol: 'state' }, expected: 'Value' },
    { desc: 'choropleth requires mapName', config: { subType: 'choropleth', regionCol: 'state', valueCol: 'revenue' }, expected: 'map' },
    { desc: 'choropleth passes with valid config', config: { subType: 'choropleth', mapName: 'us-states', regionCol: 'state', valueCol: 'revenue' }, expected: null },
    { desc: 'choropleth errors when regionCol not in columns', config: { subType: 'choropleth', mapName: 'us-states', regionCol: 'missing', valueCol: 'revenue' }, expected: TRUTHY },
    // points
    { desc: 'points requires latCol and lngCol', config: { subType: 'points', latCol: 'lat' }, expected: 'Lng' },
    { desc: 'points passes with valid config', config: { subType: 'points', latCol: 'lat', lngCol: 'lng' }, expected: null },
    { desc: 'points passes with optional valueCol for bubble sizing', config: { subType: 'points', latCol: 'lat', lngCol: 'lng', valueCol: 'revenue' }, expected: null },
    { desc: 'points errors when optional valueCol not in columns', config: { subType: 'points', latCol: 'lat', lngCol: 'lng', valueCol: 'missing' }, expected: TRUTHY },
    // lines
    { desc: 'lines requires all four coordinate columns', config: { subType: 'lines', latCol: 'lat', lngCol: 'lng', latCol2: 'lat2' }, expected: 'Lng2' },
    { desc: 'lines passes with valid config', config: { subType: 'lines', latCol: 'lat', lngCol: 'lng', latCol2: 'lat2', lngCol2: 'lng2' }, expected: null },
    // heatmap
    { desc: 'heatmap requires latCol and lngCol', config: { subType: 'heatmap' }, expected: TRUTHY },
    { desc: 'heatmap passes with lat+lng (no value)', config: { subType: 'heatmap', latCol: 'lat', lngCol: 'lng' }, expected: null },
    { desc: 'heatmap passes with lat+lng+value', config: { subType: 'heatmap', latCol: 'lat', lngCol: 'lng', valueCol: 'intensity' }, expected: null },
    // missing geoConfig
    { desc: 'returns error for undefined config', config: undefined, expected: TRUTHY },
  ])('$desc', ({ config, expected }) => {
    const result = getGeoConstraintError(config, geoColumns)
    if (expected === null) {
      expect(result.error).toBeNull()
    } else if (expected === TRUTHY) {
      expect(result.error).toBeTruthy()
    } else {
      expect(result.error).toContain(expected)
    }
  })
})

describe('computeHeatmapOptions', () => {
  it('should normalize intensity values to 0-1 range', () => {
    const points: [number, number, number][] = [
      [37.7, -122.4, 100],
      [37.8, -122.3, 500],
      [37.9, -122.2, 300],
    ]
    const { points: normalized } = computeHeatmapOptions(points, { weighted: true })
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

describe('parseGeoNumber', () => {
  it.each<[string, string | number, number]>([
    ['returns numeric inputs unchanged (positive)', 42, 42],
    ['returns numeric inputs unchanged (negative)', -122.41, -122.41],
    ['parses plain numeric strings', '37.78', 37.78],
    ['parses strings with thousands separators', '33,076', 33076],
  ])('%s', (_desc, input, expected) => {
    expect(parseGeoNumber(input)).toBe(expected)
  })

  it.each<[string, string]>([
    ['returns NaN for empty string', ''],
    ['returns NaN for invalid string', 'SOMA'],
  ])('%s', (_desc, input) => {
    expect(parseGeoNumber(input)).toBeNaN()
  })
})

describe('aggregatePivotData', () => {
  describe('row and column sorting', () => {
    const config: PivotConfig = {
      rows: ['day_of_week'],
      columns: ['week'],
      values: [{ column: 'orders', aggFunction: 'SUM' }],
    }

    const rows = [
      { week: '2025-09-01', day_of_week: '2-Tue', orders: 10 },
      { week: '2025-09-01', day_of_week: '3-Wed', orders: 11 },
      { week: '2025-09-01', day_of_week: '4-Thu', orders: 12 },
      { week: '2025-09-01', day_of_week: '5-Fri', orders: 13 },
      { week: '2025-09-01', day_of_week: '6-Sat', orders: 14 },
      { week: '2025-09-01', day_of_week: '7-Sun', orders: 15 },
      { week: '2025-09-08', day_of_week: '1-Mon', orders: 9 },
      { week: '2025-09-08', day_of_week: '2-Tue', orders: 10 },
      { week: '2025-09-08', day_of_week: '3-Wed', orders: 11 },
      { week: '2025-09-08', day_of_week: '4-Thu', orders: 12 },
      { week: '2025-09-08', day_of_week: '5-Fri', orders: 13 },
      { week: '2025-09-08', day_of_week: '6-Sat', orders: 14 },
      { week: '2025-09-08', day_of_week: '7-Sun', orders: 15 },
    ]

    it('should sort row headers lexicographically ascending', () => {
      const result = aggregatePivotData(rows, config)
      expect(result.rowHeaders.map(h => h[0])).toEqual([
        '1-Mon', '2-Tue', '3-Wed', '4-Thu', '5-Fri', '6-Sat', '7-Sun',
      ])
    })

    it('should sort column headers lexicographically ascending', () => {
      const reversed = [...rows].reverse()
      const result = aggregatePivotData(reversed, config)
      expect(result.columnHeaders.map(h => h[0])).toEqual([
        '2025-09-01', '2025-09-08',
      ])
    })

    it('should align cell data with sorted row and column keys', () => {
      const result = aggregatePivotData(rows, config)
      expect(result.cells[0]).toEqual([0, 9])
      expect(result.cells[1]).toEqual([10, 10])
    })

    it('should sort multi-level row headers lexicographically', () => {
      const multiConfig: PivotConfig = {
        rows: ['category', 'product'],
        columns: ['month'],
        values: [{ column: 'sales', aggFunction: 'SUM' }],
      }
      const data = [
        { category: 'B-Electronics', product: 'TV', month: 'Jan', sales: 100 },
        { category: 'A-Clothing', product: 'Shirt', month: 'Jan', sales: 50 },
        { category: 'B-Electronics', product: 'Phone', month: 'Jan', sales: 200 },
        { category: 'A-Clothing', product: 'Pants', month: 'Jan', sales: 60 },
      ]
      const result = aggregatePivotData(data, multiConfig)
      expect(result.rowHeaders).toEqual([
        ['A-Clothing', 'Pants'],
        ['A-Clothing', 'Shirt'],
        ['B-Electronics', 'Phone'],
        ['B-Electronics', 'TV'],
      ])
    })
  })
})

describe('computeTrendComparison', () => {
  const labels = ['Jan', 'Feb', 'Mar', 'Apr']
  const data = [100, 200, 300, 150]

  describe('compareMode = "last" (default)', () => {
    it('uses last value as the display value', () => {
      const result = computeTrendComparison(data, labels, 'last')
      expect(result.currentValue).toBe(150)
    })

    it('compares last vs second-to-last', () => {
      const result = computeTrendComparison(data, labels, 'last')
      expect(result.compareBaseValue).toBe(150)
      expect(result.compareValue).toBe(300)
      expect(result.percentChange).toBeCloseTo(-50)
    })

    it('returns labels for the compared periods', () => {
      const result = computeTrendComparison(data, labels, 'last')
      expect(result.compareBaseLabel).toBe('Apr')
      expect(result.compareLabel).toBe('Mar')
    })

    it('defaults to last mode when no mode specified', () => {
      const result = computeTrendComparison(data, labels)
      expect(result.compareBaseValue).toBe(150)
      expect(result.compareValue).toBe(300)
    })
  })

  describe('compareMode = "previous"', () => {
    it('uses the compare base (second-to-last) as the display value', () => {
      const result = computeTrendComparison(data, labels, 'previous')
      expect(result.currentValue).toBe(300)
    })

    it('compares the two most recent complete periods (skips last)', () => {
      const result = computeTrendComparison(data, labels, 'previous')
      expect(result.compareBaseValue).toBe(300)
      expect(result.compareValue).toBe(200)
      expect(result.percentChange).toBeCloseTo(50)
    })

    it('returns labels for the compared periods', () => {
      const result = computeTrendComparison(data, labels, 'previous')
      expect(result.compareBaseLabel).toBe('Mar')
      expect(result.compareLabel).toBe('Feb')
    })
  })

  describe('with exactly 2 data points', () => {
    const twoLabels = ['Jan', 'Feb']
    const twoData = [100, 200]

    it('compares them directly regardless of mode', () => {
      const last = computeTrendComparison(twoData, twoLabels, 'last')
      const prev = computeTrendComparison(twoData, twoLabels, 'previous')
      expect(last.compareBaseValue).toBe(200)
      expect(last.compareValue).toBe(100)
      expect(prev.compareBaseValue).toBe(200)
      expect(prev.compareValue).toBe(100)
    })
  })

  describe('with 1 data point', () => {
    it('returns null for comparison fields', () => {
      const result = computeTrendComparison([500], ['Jan'])
      expect(result.currentValue).toBe(500)
      expect(result.percentChange).toBeNull()
      expect(result.compareValue).toBeNull()
    })
  })

  describe('with empty data', () => {
    it('returns zeros and nulls', () => {
      const result = computeTrendComparison([], [])
      expect(result.currentValue).toBe(0)
      expect(result.percentChange).toBeNull()
    })
  })

  describe('edge case: previous value is zero', () => {
    it('returns null percentage when dividing by zero', () => {
      const result = computeTrendComparison([0, 100, 50], ['Jan', 'Feb', 'Mar'], 'previous')
      expect(result.percentChange).toBeNull()
    })
  })

  describe('without labels', () => {
    it('works with undefined labels', () => {
      const result = computeTrendComparison([100, 200, 300, 150], undefined, 'previous')
      expect(result.currentValue).toBe(300)
      expect(result.percentChange).toBeCloseTo(50)
      expect(result.compareLabel).toBeUndefined()
    })
  })
})

describe('getVizConstraintError', () => {
  describe('trend chart', () => {
    it('returns error when X-axis column is not a temporal type', () => {
      const result = getVizConstraintError('trend', {
        xColCount: 1,
        yColCount: 1,
        xColTypes: ['text'],
      })
      expect(result.error).toBeTruthy()
      expect(result.error).toMatch(/date|time/i)
    })

    it('returns no error when X-axis column is a date type', () => {
      const result = getVizConstraintError('trend', {
        xColCount: 1,
        yColCount: 1,
        xColTypes: ['date'],
      })
      expect(result.error).toBeNull()
    })

    it('returns error when X-axis column is a number type', () => {
      const result = getVizConstraintError('trend', {
        xColCount: 1,
        yColCount: 1,
        xColTypes: ['number'],
      })
      expect(result.error).toBeTruthy()
    })

    it('returns error when no X columns', () => {
      const result = getVizConstraintError('trend', {
        xColCount: 0,
        yColCount: 1,
        xColTypes: [],
      })
      expect(result.error).toBeTruthy()
      expect(result.error).toMatch(/date|time/i)
    })
  })

  describe('standard charts require X-axis', () => {
    it.each(['line', 'bar', 'area', 'scatter'] as const)('%s chart returns error when no X columns', (type) => {
      const result = getVizConstraintError(type, { xColCount: 0, yColCount: 1 })
      expect(result.error).toBeTruthy()
      expect(result.error).toMatch(/X-axis/i)
    })

    it.each(['line', 'bar', 'area', 'scatter'] as const)('%s chart passes with 1 X column', (type) => {
      const result = getVizConstraintError(type, { xColCount: 1, yColCount: 1 })
      expect(result.error).toBeNull()
    })

    it('bar chart ignores xColTypes', () => {
      const result = getVizConstraintError('bar', {
        xColCount: 1,
        yColCount: 1,
        xColTypes: ['text'],
      })
      expect(result.error).toBeNull()
    })
  })

  describe('waterfall requires X-axis', () => {
    it('returns error when no X columns', () => {
      const result = getVizConstraintError('waterfall', { xColCount: 0, yColCount: 1 })
      expect(result.error).toBeTruthy()
    })
  })

  describe('single_value constraints', () => {
    it('returns error when more than 1 Y column', () => {
      const result = getVizConstraintError('single_value', { xColCount: 0, yColCount: 2 })
      expect(result.error).toBeTruthy()
    })

    it('passes with exactly 1 Y column', () => {
      const result = getVizConstraintError('single_value', { xColCount: 0, yColCount: 1 })
      expect(result.error).toBeNull()
    })
  })
})

describe('getVizSettingsWarning', () => {
  it('returns null for table type', () => {
    expect(getVizSettingsWarning({ type: 'table' })).toBeNull()
  })

  it('returns null for undefined/null vizSettings', () => {
    expect(getVizSettingsWarning(undefined)).toBeNull()
    expect(getVizSettingsWarning(null)).toBeNull()
  })

  it('returns warning for line chart with no xCols', () => {
    const warning = getVizSettingsWarning({ type: 'line', xCols: [], yCols: ['revenue'] })
    expect(warning).toBeTruthy()
    expect(warning).toMatch(/X-axis/i)
  })

  it('returns null for line chart with valid xCols and yCols', () => {
    expect(getVizSettingsWarning({ type: 'line', xCols: ['month'], yCols: ['revenue'] })).toBeNull()
  })

  it('returns warning for single_value with multiple yCols', () => {
    const warning = getVizSettingsWarning({ type: 'single_value', yCols: ['a', 'b'] })
    expect(warning).toBeTruthy()
  })

  it('returns null for single_value with one yCols', () => {
    expect(getVizSettingsWarning({ type: 'single_value', yCols: ['total'] })).toBeNull()
  })

  it('returns warning for combo chart with only 1 Y column', () => {
    const warning = getVizSettingsWarning({ type: 'combo', xCols: ['month'], yCols: ['revenue'] })
    expect(warning).toBeTruthy()
  })

  // Data-aware checks: when columns/types are supplied, type-dependent constraints
  // are validated too (matching the chart renderer) — so the agent gets the signal.
  describe('with query result columns/types', () => {
    it('warns when a trend chart has a non-date X column (the renderer error)', () => {
      const warning = getVizSettingsWarning(
        { type: 'trend', xCols: ['family'], yCols: ['avg_context_k'] },
        ['family', 'avg_context_k'],
        ['VARCHAR', 'INTEGER'],
      )
      expect(warning).toMatch(/date\/time column/i)
    })

    it('passes when a trend chart has a date X column', () => {
      expect(
        getVizSettingsWarning(
          { type: 'trend', xCols: ['day'], yCols: ['revenue'] },
          ['day', 'revenue'],
          ['TIMESTAMP', 'DECIMAL'],
        ),
      ).toBeNull()
    })

    it('without columns/types, the type-dependent trend check is skipped (the old blind behavior)', () => {
      // This is exactly why the agent never saw the error before: structural-only.
      expect(getVizSettingsWarning({ type: 'trend', xCols: ['family'], yCols: ['avg_context_k'] })).toBeNull()
    })
  })
})
