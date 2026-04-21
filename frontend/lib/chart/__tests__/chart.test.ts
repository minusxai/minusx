import { buildChartOption, buildRadarChartOption, buildPieChartOption, formatDateValue } from '@/lib/chart/chart-utils'
import { getColorScale, getHeatGradient, getRadiusScale, interpolateColor, COLOR_SCALES } from '@/lib/chart/geo-color-scale'
import { getGeoConstraintError } from '@/lib/chart/geo-constraints'
import type { GeoConfig } from '@/lib/types'
import { computeHeatmapOptions } from '../geo-heatmap-defaults'
import { parseGeoNumber } from '@/lib/chart/geo-value-utils'
import { aggregatePivotData } from '../pivot-utils'
import type { PivotConfig } from '@/lib/types'
import { computeTrendComparison } from '@/lib/chart/trend-utils'
import { getVizConstraintError } from '@/lib/chart/viz-constraints'

// ─── chart-utils.test.ts ───

describe('buildChartOption scatter log axis', () => {
  it('derives x-axis log extent from positive scatter values and excludes non-positive x points', () => {
    const option = buildChartOption({
      chartType: 'scatter',
      xAxisData: ['0', '0.5', '1', '30', '150'],
      series: [
        { name: 'elo', data: [1000, 1100, 1200, 1300, 1400] },
      ],
      xAxisLabel: 'output_cost_per_m_tokens',
      yAxisLabel: 'elo',
      colorPalette: ['#16a085'],
      axisConfig: { xScale: 'log' },
      xAxisColumns: ['output_cost_per_m_tokens'],
      columnTypes: { output_cost_per_m_tokens: 'number' },
    })

    const xAxis = option.xAxis as any
    const scatterSeries = (option.series as any[])[0]

    expect(xAxis.type).toBe('log')
    expect(xAxis.min).toBe(0.5)
    expect(xAxis.max).toBe(150)
    expect(xAxis.splitLine).toMatchObject({
      show: true,
      lineStyle: {
        color: 'rgba(208, 215, 222, 0.8)',
        type: 'dashed',
        opacity: 0.45,
        width: 1,
      },
    })
    expect(xAxis.minorTick).toMatchObject({
      show: true,
      splitNumber: 9,
    })
    expect(xAxis.minorSplitLine).toMatchObject({
      show: true,
      lineStyle: {
        color: 'rgba(208, 215, 222, 0.5)',
        type: 'dashed',
        opacity: 0.45,
        width: 1,
      },
    })
    expect(scatterSeries.data).toEqual([
      { value: [0.5, 1100], tooltipMeta: undefined },
      { value: [1, 1200], tooltipMeta: undefined },
      { value: [30, 1300], tooltipMeta: undefined },
      { value: [150, 1400], tooltipMeta: undefined },
    ])
  })
})

describe('buildChartOption scatter with date x-axis', () => {
  it('uses time axis and preserves all data points when xAxisData contains dates', () => {
    const option = buildChartOption({
      chartType: 'scatter',
      xAxisData: ['2024-01-15', '2024-02-20', '2024-03-10'],
      series: [
        { name: 'revenue', data: [100, 200, 300] },
      ],
      xAxisLabel: 'date',
      yAxisLabel: 'revenue',
      xAxisColumns: ['date'],
      colorPalette: ['#16a085'],
      columnTypes: { date: 'date' },
    })

    const xAxis = option.xAxis as any
    const scatterSeries = (option.series as any[])[0]

    expect(xAxis.type).toBe('time')
    expect(scatterSeries.data).toHaveLength(3)
    expect(scatterSeries.data[0].value[0]).toBe('2024-01-15')
    expect(scatterSeries.data[1].value[0]).toBe('2024-02-20')
    expect(scatterSeries.data[2].value[0]).toBe('2024-03-10')
  })
})

describe('buildChartOption scatter with category x-axis', () => {
  it('uses category axis and preserves all data points when xAxisData contains strings', () => {
    const option = buildChartOption({
      chartType: 'scatter',
      xAxisData: ['US', 'UK', 'Canada', 'Germany'],
      series: [
        { name: 'sales', data: [500, 300, 200, 400] },
      ],
      xAxisLabel: 'country',
      yAxisLabel: 'sales',
      xAxisColumns: ['country'],
      colorPalette: ['#16a085'],
      columnTypes: { country: 'text' },
    })

    const xAxis = option.xAxis as any
    const scatterSeries = (option.series as any[])[0]

    expect(xAxis.type).toBe('category')
    expect(xAxis.data).toEqual(['US', 'UK', 'Canada', 'Germany'])
    expect(scatterSeries.data).toHaveLength(4)
  })
})

describe('buildChartOption scatter with numeric x-axis', () => {
  it('still uses value axis for numeric data (existing behavior)', () => {
    const option = buildChartOption({
      chartType: 'scatter',
      xAxisData: ['10', '20', '30'],
      series: [
        { name: 'metric', data: [100, 200, 300] },
      ],
      xAxisLabel: 'x',
      yAxisLabel: 'y',
      xAxisColumns: ['x'],
      colorPalette: ['#16a085'],
      columnTypes: { x: 'number' },
    })

    const xAxis = option.xAxis as any
    const scatterSeries = (option.series as any[])[0]

    expect(xAxis.type).toBe('value')
    expect(scatterSeries.data).toHaveLength(3)
    expect(scatterSeries.data[0].value).toEqual([10, 100])
    expect(scatterSeries.data[1].value).toEqual([20, 200])
  })
})

describe('buildChartOption cartesian x-axis type resolution', () => {
  it.each([
    ['line'],
    ['bar'],
    ['area'],
    ['combo'],
  ] as const)('uses time axis for %s charts when the SQL x column type is date', (chartType) => {
    const option = buildChartOption({
      chartType,
      xAxisData: ['2024-01-15', '2024-02-20', '2024-03-10'],
      series: [
        { name: 'revenue', data: [100, 200, 300] },
      ],
      xAxisLabel: 'date',
      yAxisLabel: 'revenue',
      xAxisColumns: ['date'],
      colorPalette: ['#16a085'],
      columnTypes: { date: 'date' },
    })

    const xAxis = option.xAxis as any
    const chartSeries = (option.series as any[])[0]

    expect(xAxis.type).toBe('time')
    expect(chartSeries.data[0]).toEqual(['2024-01-15', 100])
    expect(chartSeries.data[1]).toEqual(['2024-02-20', 200])
  })

  it.each([
    ['line'],
    ['bar'],
    ['area'],
    ['combo'],
  ] as const)('uses value axis for %s charts when the SQL x column type is number', (chartType) => {
    const option = buildChartOption({
      chartType,
      xAxisData: ['10', '20', '30'],
      series: [
        { name: 'revenue', data: [100, 200, 300] },
      ],
      xAxisLabel: 'rank',
      yAxisLabel: 'revenue',
      xAxisColumns: ['rank'],
      colorPalette: ['#16a085'],
      columnTypes: { rank: 'number' },
    })

    const xAxis = option.xAxis as any
    const chartSeries = (option.series as any[])[0]

    expect(xAxis.type).toBe('value')
    expect(chartSeries.data[0]).toEqual([10, 100])
    expect(chartSeries.data[1]).toEqual([20, 200])
  })
})

describe('buildRadarChartOption', () => {
  const COLOR_PALETTE = ['#16a085', '#2980b9', '#8e44ad']

  it('produces a radar series with correct indicator count', () => {
    const option = buildRadarChartOption({
      xAxisData: ['Speed', 'Power', 'Defense', 'Magic', 'Luck'],
      series: [
        { name: 'Player A', data: [80, 60, 90, 40, 70] },
      ],
      colorPalette: COLOR_PALETTE,
    })

    const radar = option.radar as any
    expect(radar.indicator).toHaveLength(5)
    expect(radar.indicator[0].name).toBe('Speed')
    expect(radar.shape).toBe('polygon')
  })

  it('uses a single shared max across all indicators', () => {
    const option = buildRadarChartOption({
      xAxisData: ['A', 'B', 'C'],
      series: [
        { name: 's1', data: [10, 50, 30] },
        { name: 's2', data: [20, 40, 100] },
      ],
      colorPalette: COLOR_PALETTE,
    })

    const radar = option.radar as any
    const maxValues = radar.indicator.map((ind: any) => ind.max)
    expect(new Set(maxValues).size).toBe(1)
    expect(maxValues[0]).toBeGreaterThanOrEqual(100)
  })

  it('creates one radar data entry per series', () => {
    const option = buildRadarChartOption({
      xAxisData: ['X', 'Y', 'Z'],
      series: [
        { name: 'budget', data: [100, 200, 300] },
        { name: 'actual', data: [90, 210, 280] },
      ],
      colorPalette: COLOR_PALETTE,
    })

    const radarSeries = (option.series as any[])[0]
    expect(radarSeries.type).toBe('radar')
    expect(radarSeries.data).toHaveLength(2)
    expect(radarSeries.data[0].name).toBe('budget')
    expect(radarSeries.data[1].name).toBe('actual')
    expect(radarSeries.data[0].value).toEqual([100, 200, 300])
  })
})

describe('buildPieChartOption', () => {
  const COLOR_PALETTE = ['#16a085', '#2980b9', '#8e44ad', '#d35400', '#c0392b']

  it('produces a single pie series for single-series data', () => {
    const option = buildPieChartOption({
      xAxisData: ['Chrome', 'Firefox', 'Safari'],
      series: [{ name: 'Users', data: [60, 25, 15] }],
      colorPalette: COLOR_PALETTE,
    })

    const allSeries = option.series as any[]
    expect(allSeries).toHaveLength(1)
    expect(allSeries[0].type).toBe('pie')
    expect(allSeries[0].data).toHaveLength(3)
  })

  it('produces two pie series (inner + outer ring) for multi-series data', () => {
    const option = buildPieChartOption({
      xAxisData: ['US', 'UK'],
      series: [
        { name: 'Chrome', data: [40, 15] },
        { name: 'Firefox', data: [20, 25] },
      ],
      colorPalette: COLOR_PALETTE,
    })

    const allSeries = option.series as any[]
    expect(allSeries).toHaveLength(2)

    const inner = allSeries[0]
    expect(inner.type).toBe('pie')
    expect(inner.data).toHaveLength(2)
    expect(inner.data[0].name).toBe('US')
    expect(inner.data[0].value).toBe(60)
    expect(inner.data[1].name).toBe('UK')
    expect(inner.data[1].value).toBe(40)
    expect(inner.radius[1]).not.toBe(inner.radius[0])

    const outer = allSeries[1]
    expect(outer.type).toBe('pie')
    expect(outer.data).toHaveLength(4)
    const innerMax = parseInt(inner.radius[1])
    const outerMin = parseInt(outer.radius[0])
    expect(outerMin).toBeGreaterThan(innerMax)
  })
})

// ─── format-date-value.test.ts ───

const DATE = '2024-01-15T14:05:09Z'
const DATE_ONLY = '2024-01-15'

describe('formatDateValue', () => {
  describe('pattern-based formatting', () => {
    it('formats yyyy-MM-dd', () => {
      expect(formatDateValue(DATE, 'yyyy-MM-dd')).toBe('2024-01-15')
    })

    it('formats MM/dd/yyyy', () => {
      expect(formatDateValue(DATE, 'MM/dd/yyyy')).toBe('01/15/2024')
    })

    it('formats dd/MM/yyyy', () => {
      expect(formatDateValue(DATE, 'dd/MM/yyyy')).toBe('15/01/2024')
    })

    it('formats MMM dd, yyyy (short month)', () => {
      expect(formatDateValue(DATE, 'MMM dd, yyyy')).toBe('Jan 15, 2024')
    })

    it('formats MMMM dd, yyyy (full month)', () => {
      expect(formatDateValue(DATE, 'MMMM dd, yyyy')).toBe('January 15, 2024')
    })

    it("formats MMM'yy", () => {
      expect(formatDateValue(DATE, "MMM'yy")).toBe("Jan'24")
    })

    it('formats yyyy alone', () => {
      expect(formatDateValue(DATE, 'yyyy')).toBe('2024')
    })

    it('formats yy (2-digit year)', () => {
      expect(formatDateValue(DATE, 'yy')).toBe('24')
    })

    it('formats time HH:mm:ss', () => {
      expect(formatDateValue(DATE, 'HH:mm:ss')).toBe('14:05:09')
    })

    it('formats date + time yyyy-MM-dd HH:mm', () => {
      expect(formatDateValue(DATE, 'yyyy-MM-dd HH:mm')).toBe('2024-01-15 14:05')
    })

    it('handles date-only input strings', () => {
      expect(formatDateValue(DATE_ONLY, 'MM/dd/yyyy')).toBe('01/15/2024')
    })

    it('preserves literal separators', () => {
      expect(formatDateValue(DATE, 'dd.MM.yyyy')).toBe('15.01.2024')
      expect(formatDateValue(DATE, 'dd-MM-yyyy')).toBe('15-01-2024')
    })
  })

  describe('legacy named format compat', () => {
    it('maps "iso" to yyyy-MM-dd', () => {
      expect(formatDateValue(DATE, 'iso')).toBe('2024-01-15')
    })

    it('maps "us" to MM/dd/yyyy', () => {
      expect(formatDateValue(DATE, 'us')).toBe('01/15/2024')
    })

    it('maps "short" to MMM dd, yyyy', () => {
      expect(formatDateValue(DATE, 'short')).toBe('Jan 15, 2024')
    })

    it("maps 'month-year' to MMM'yy", () => {
      expect(formatDateValue(DATE, 'month-year')).toBe("Jan'24")
    })

    it('maps "year" to yyyy', () => {
      expect(formatDateValue(DATE, 'year')).toBe('2024')
    })
  })

  describe('edge cases', () => {
    it('returns original string for invalid date', () => {
      expect(formatDateValue('not-a-date', 'yyyy-MM-dd')).toBe('not-a-date')
    })

    it('returns original string for empty string', () => {
      expect(formatDateValue('', 'yyyy-MM-dd')).toBe('')
    })

    it('handles different months correctly', () => {
      expect(formatDateValue('2024-12-25', 'MMM')).toBe('Dec')
      expect(formatDateValue('2024-06-01', 'MMMM')).toBe('June')
      expect(formatDateValue('2024-02-14', 'MMM dd')).toBe('Feb 14')
    })

    it('zero-pads single-digit day and month', () => {
      expect(formatDateValue('2024-03-05', 'dd/MM/yyyy')).toBe('05/03/2024')
    })

    it('zero-pads midnight time', () => {
      expect(formatDateValue('2024-01-15T00:00:00Z', 'HH:mm:ss')).toBe('00:00:00')
    })
  })
})

// ─── geo-color-scale.test.ts ───

describe('interpolateColor', () => {
  it('returns start color at t=0', () => {
    expect(interpolateColor('#000000', '#ffffff', 0)).toBe('#000000')
  })

  it('returns end color at t=1', () => {
    expect(interpolateColor('#000000', '#ffffff', 1)).toBe('#ffffff')
  })

  it('returns midpoint color at t=0.5', () => {
    const mid = interpolateColor('#000000', '#ffffff', 0.5)
    expect(mid).toBe('#808080')
  })

  it('clamps t below 0 to start color', () => {
    expect(interpolateColor('#ff0000', '#0000ff', -0.5)).toBe('#ff0000')
  })

  it('clamps t above 1 to end color', () => {
    expect(interpolateColor('#ff0000', '#0000ff', 1.5)).toBe('#0000ff')
  })
})

describe('getColorScale', () => {
  it('returns low color for minimum value', () => {
    const color = getColorScale(0, 0, 100, 'light')
    expect(color).toBeDefined()
    expect(color).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('returns high color for maximum value', () => {
    const color = getColorScale(100, 0, 100, 'light')
    expect(color).toBeDefined()
    expect(color).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('returns different colors for different values', () => {
    const low = getColorScale(10, 0, 100, 'light')
    const high = getColorScale(90, 0, 100, 'light')
    expect(low).not.toBe(high)
  })

  it('handles min === max without crashing', () => {
    const color = getColorScale(50, 50, 50, 'light')
    expect(color).toMatch(/^#[0-9a-f]{6}$/)
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

  it('falls back to default scale for unknown key', () => {
    const defaultColor = getColorScale(50, 0, 100, 'light')
    const unknownColor = getColorScale(50, 0, 100, 'light', 'nonexistent')
    expect(unknownColor).toBe(defaultColor)
  })

  it('falls back to default scale for null/undefined', () => {
    const defaultColor = getColorScale(50, 0, 100, 'light')
    const nullColor = getColorScale(50, 0, 100, 'light', null)
    const undefColor = getColorScale(50, 0, 100, 'light', undefined)
    expect(nullColor).toBe(defaultColor)
    expect(undefColor).toBe(defaultColor)
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
  it('returns minimum radius for minimum value', () => {
    expect(getRadiusScale(0, 0, 100)).toBe(4)
  })

  it('returns maximum radius for maximum value', () => {
    expect(getRadiusScale(100, 0, 100)).toBe(30)
  })

  it('returns intermediate radius for middle value', () => {
    const r = getRadiusScale(50, 0, 100)
    expect(r).toBeGreaterThan(4)
    expect(r).toBeLessThan(30)
  })

  it('handles min === max', () => {
    const r = getRadiusScale(50, 50, 50)
    expect(r).toBe(4)
  })

  it('clamps values below min', () => {
    expect(getRadiusScale(-10, 0, 100)).toBe(4)
  })

  it('clamps values above max', () => {
    expect(getRadiusScale(200, 0, 100)).toBe(30)
  })

  it('uses custom minRadius when provided', () => {
    expect(getRadiusScale(0, 0, 100, 10)).toBe(10)
  })

  it('uses custom minRadius for min===max fallback', () => {
    expect(getRadiusScale(50, 50, 50, 10)).toBe(10)
  })

  it('scales between custom minRadius and MAX_RADIUS', () => {
    const r = getRadiusScale(100, 0, 100, 10)
    expect(r).toBe(30)
  })

  it('interpolates correctly with custom minRadius', () => {
    expect(getRadiusScale(50, 0, 100, 10)).toBe(20)
  })

  it('scale=2 doubles all radii', () => {
    expect(getRadiusScale(50, 0, 100, undefined, 2)).toBe(34)
  })

  it('scale=1 is same as default', () => {
    expect(getRadiusScale(50, 0, 100, undefined, 1)).toBe(getRadiusScale(50, 0, 100))
  })

  it('scale applies to min value too', () => {
    expect(getRadiusScale(0, 0, 100, undefined, 3)).toBe(12)
  })

  it('scale applies to min===max fallback', () => {
    expect(getRadiusScale(50, 50, 50, 10, 2)).toBe(20)
  })
})

// ─── geo-constraints.test.ts ───

const geoColumns = ['state', 'revenue', 'lat', 'lng', 'lat2', 'lng2', 'intensity']

describe('getGeoConstraintError', () => {
  describe('choropleth', () => {
    it('requires regionCol', () => {
      const config: GeoConfig = { subType: 'choropleth', mapName: 'us-states', valueCol: 'revenue' }
      const result = getGeoConstraintError(config, geoColumns)
      expect(result.error).toContain('Region')
    })

    it('requires valueCol', () => {
      const config: GeoConfig = { subType: 'choropleth', mapName: 'us-states', regionCol: 'state' }
      const result = getGeoConstraintError(config, geoColumns)
      expect(result.error).toContain('Value')
    })

    it('requires mapName', () => {
      const config: GeoConfig = { subType: 'choropleth', regionCol: 'state', valueCol: 'revenue' }
      const result = getGeoConstraintError(config, geoColumns)
      expect(result.error).toContain('map')
    })

    it('passes with valid config', () => {
      const config: GeoConfig = { subType: 'choropleth', mapName: 'us-states', regionCol: 'state', valueCol: 'revenue' }
      const result = getGeoConstraintError(config, geoColumns)
      expect(result.error).toBeNull()
    })

    it('errors when regionCol not in columns', () => {
      const config: GeoConfig = { subType: 'choropleth', mapName: 'us-states', regionCol: 'missing', valueCol: 'revenue' }
      const result = getGeoConstraintError(config, geoColumns)
      expect(result.error).toBeTruthy()
    })
  })

  describe('points', () => {
    it('requires latCol and lngCol', () => {
      const config: GeoConfig = { subType: 'points', latCol: 'lat' }
      const result = getGeoConstraintError(config, geoColumns)
      expect(result.error).toContain('Lng')
    })

    it('passes with valid config', () => {
      const config: GeoConfig = { subType: 'points', latCol: 'lat', lngCol: 'lng' }
      const result = getGeoConstraintError(config, geoColumns)
      expect(result.error).toBeNull()
    })

    it('passes with optional valueCol for bubble sizing', () => {
      const config: GeoConfig = { subType: 'points', latCol: 'lat', lngCol: 'lng', valueCol: 'revenue' }
      const result = getGeoConstraintError(config, geoColumns)
      expect(result.error).toBeNull()
    })

    it('errors when optional valueCol not in columns', () => {
      const config: GeoConfig = { subType: 'points', latCol: 'lat', lngCol: 'lng', valueCol: 'missing' }
      const result = getGeoConstraintError(config, geoColumns)
      expect(result.error).toBeTruthy()
    })
  })

  describe('lines', () => {
    it('requires all four coordinate columns', () => {
      const config: GeoConfig = { subType: 'lines', latCol: 'lat', lngCol: 'lng', latCol2: 'lat2' }
      const result = getGeoConstraintError(config, geoColumns)
      expect(result.error).toContain('Lng2')
    })

    it('passes with valid config', () => {
      const config: GeoConfig = { subType: 'lines', latCol: 'lat', lngCol: 'lng', latCol2: 'lat2', lngCol2: 'lng2' }
      const result = getGeoConstraintError(config, geoColumns)
      expect(result.error).toBeNull()
    })
  })

  describe('heatmap', () => {
    it('requires latCol and lngCol', () => {
      const config: GeoConfig = { subType: 'heatmap' }
      const result = getGeoConstraintError(config, geoColumns)
      expect(result.error).toBeTruthy()
    })

    it('passes with lat+lng (no value)', () => {
      const config: GeoConfig = { subType: 'heatmap', latCol: 'lat', lngCol: 'lng' }
      const result = getGeoConstraintError(config, geoColumns)
      expect(result.error).toBeNull()
    })

    it('passes with lat+lng+value', () => {
      const config: GeoConfig = { subType: 'heatmap', latCol: 'lat', lngCol: 'lng', valueCol: 'intensity' }
      const result = getGeoConstraintError(config, geoColumns)
      expect(result.error).toBeNull()
    })
  })

  describe('missing geoConfig', () => {
    it('returns error for undefined config', () => {
      const result = getGeoConstraintError(undefined, geoColumns)
      expect(result.error).toBeTruthy()
    })
  })
})

// ─── geo-heatmap-defaults.test.ts ───

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

// ─── geo-value-utils.test.ts ───

describe('parseGeoNumber', () => {
  it('returns numeric inputs unchanged', () => {
    expect(parseGeoNumber(42)).toBe(42)
    expect(parseGeoNumber(-122.41)).toBe(-122.41)
  })

  it('parses plain numeric strings', () => {
    expect(parseGeoNumber('37.78')).toBe(37.78)
  })

  it('parses strings with thousands separators', () => {
    expect(parseGeoNumber('33,076')).toBe(33076)
  })

  it('returns NaN for empty or invalid strings', () => {
    expect(parseGeoNumber('')).toBeNaN()
    expect(parseGeoNumber('SOMA')).toBeNaN()
  })
})

// ─── pivot-utils.test.ts ───

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

// ─── trend-utils.test.ts ───

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

// ─── viz-constraints.test.ts ───

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

    it('returns no error when X-axis column is a timestamp type', () => {
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

    it('returns no error when no X columns (shows aggregate)', () => {
      const result = getVizConstraintError('trend', {
        xColCount: 0,
        yColCount: 1,
        xColTypes: [],
      })
      expect(result.error).toBeNull()
    })
  })

  describe('other chart types unaffected', () => {
    it('bar chart ignores xColTypes', () => {
      const result = getVizConstraintError('bar', {
        xColCount: 1,
        yColCount: 1,
        xColTypes: ['text'],
      })
      expect(result.error).toBeNull()
    })
  })
})
