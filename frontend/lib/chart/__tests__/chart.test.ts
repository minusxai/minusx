import { buildChartOption, buildRadarChartOption, buildPieChartOption, buildFunnelChartOption, formatDateValue, resolveXAxisTypes, resolveAnnotationY, findMatchingXIndex, resolveAnnotationX } from '@/lib/chart/chart-utils'
import { getColorScale, getHeatGradient, getRadiusScale, interpolateColor, COLOR_SCALES } from '@/lib/chart/geo-color-scale'
import { getGeoConstraintError } from '@/lib/chart/geo-constraints'
import type { GeoConfig } from '@/lib/types'
import { computeHeatmapOptions } from '../geo-heatmap-defaults'
import { parseGeoNumber } from '@/lib/chart/geo-value-utils'
import { aggregatePivotData } from '../pivot-utils'
import type { PivotConfig } from '@/lib/types'
import { computeTrendComparison } from '@/lib/chart/trend-utils'
import { getVizConstraintError, getVizSettingsWarning } from '@/lib/chart/viz-constraints'

// ─── chart-utils.test.ts ───

describe('buildChartOption animation default', () => {
  // Background: a Chrome perf trace showed zrender Animation.update / step / ZRText
  // ._updatePlainTexts dominating main-thread CPU (~590ms over a 16s session),
  // plus ~500ms of forced layout from measureText on every animation frame
  // (zrender appends a span → reads offsetWidth → removes it). ECharts' default
  // animation is decorative and not worth the cost in a BI tool; disable by
  // default and let callers opt back in per chart via additionalOptions.
  it('returns animation: false by default for standard charts', () => {
    const option = buildChartOption({
      chartType: 'bar',
      xAxisData: ['a', 'b', 'c'],
      series: [{ name: 's', data: [1, 2, 3] }],
      colorPalette: ['#16a085'],
    })
    expect(option.animation).toBe(false)
  })

  it('honours an explicit animation override from additionalOptions', () => {
    const option = buildChartOption({
      chartType: 'bar',
      xAxisData: ['a', 'b', 'c'],
      series: [{ name: 's', data: [1, 2, 3] }],
      colorPalette: ['#16a085'],
      additionalOptions: { animation: true },
    })
    expect(option.animation).toBe(true)
  })

  it('returns animation: false by default for pie charts', () => {
    const option = buildPieChartOption({
      xAxisData: ['a', 'b'],
      series: [{ name: 's', data: [1, 2] }],
      colorPalette: ['#16a085', '#27ae60'],
    } as any)
    expect(option.animation).toBe(false)
  })
})

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

describe('resolveXAxisTypes', () => {
  it.each([
    {
      desc: 'returns category for both when column type is text',
      columns: ['region'], columnTypes: { region: 'text' }, chartType: 'line', xScaleType: undefined,
      expected: { columnKind: 'category', axisType: 'category' },
    },
    {
      desc: 'returns time/time for line chart with date column',
      columns: ['date'], columnTypes: { date: 'date' }, chartType: 'line', xScaleType: undefined,
      expected: { columnKind: 'time', axisType: 'time' },
    },
    {
      desc: 'returns time/time for area chart with date column',
      columns: ['date'], columnTypes: { date: 'date' }, chartType: 'area', xScaleType: undefined,
      expected: { columnKind: 'time', axisType: 'time' },
    },
    {
      desc: 'returns time/time for scatter chart with date column',
      columns: ['date'], columnTypes: { date: 'date' }, chartType: 'scatter', xScaleType: undefined,
      expected: { columnKind: 'time', axisType: 'time' },
    },
    {
      desc: 'forces category axis for bar chart with date column',
      columns: ['date'], columnTypes: { date: 'date' }, chartType: 'bar', xScaleType: undefined,
      expected: { columnKind: 'time', axisType: 'category' },
    },
    {
      desc: 'forces category axis for bar chart with number column',
      columns: ['rank'], columnTypes: { rank: 'number' }, chartType: 'bar', xScaleType: undefined,
      expected: { columnKind: 'value', axisType: 'category' },
    },
    {
      desc: 'forces category axis for combo chart with date column',
      columns: ['date'], columnTypes: { date: 'date' }, chartType: 'combo', xScaleType: undefined,
      expected: { columnKind: 'time', axisType: 'category' },
    },
    {
      desc: 'forces category axis for waterfall chart',
      columns: ['date'], columnTypes: { date: 'date' }, chartType: 'waterfall', xScaleType: undefined,
      expected: { columnKind: 'time', axisType: 'category' },
    },
    {
      desc: 'returns value/value for line chart with number column',
      columns: ['rank'], columnTypes: { rank: 'number' }, chartType: 'line', xScaleType: undefined,
      expected: { columnKind: 'value', axisType: 'value' },
    },
    {
      desc: 'returns value/log when xScaleType is log',
      columns: ['cost'], columnTypes: { cost: 'number' }, chartType: 'scatter', xScaleType: 'log',
      expected: { columnKind: 'value', axisType: 'log' },
    },
    {
      desc: 'bar chart with log scale still gets category (bar overrides log)',
      columns: ['cost'], columnTypes: { cost: 'number' }, chartType: 'bar', xScaleType: 'log',
      expected: { columnKind: 'value', axisType: 'category' },
    },
    {
      desc: 'defaults to category when no columns provided',
      columns: undefined, columnTypes: undefined, chartType: 'line', xScaleType: undefined,
      expected: { columnKind: 'category', axisType: 'category' },
    },
  ])('$desc', ({ columns, columnTypes, chartType, xScaleType, expected }) => {
    const result = resolveXAxisTypes(columns as any, columnTypes as any, chartType as any, xScaleType as any)
    expect(result).toEqual(expected)
  })
})

describe('buildChartOption cartesian x-axis type resolution', () => {
  it.each([
    ['line'],
    ['area'],
  ] as const)('uses time axis for %s charts when x column is date', (chartType) => {
    const option = buildChartOption({
      chartType,
      xAxisData: ['2024-01-15', '2024-02-20', '2024-03-10'],
      series: [{ name: 'revenue', data: [100, 200, 300] }],
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
    ['bar'],
    ['combo'],
  ] as const)('uses category axis for %s charts when x column is date', (chartType) => {
    const option = buildChartOption({
      chartType,
      xAxisData: ['2024-01-31', '2024-02-28', '2024-03-31'],
      series: [{ name: 'revenue', data: [100, 200, 300] }],
      xAxisLabel: 'date',
      yAxisLabel: 'revenue',
      xAxisColumns: ['date'],
      colorPalette: ['#16a085'],
      columnTypes: { date: 'date' },
    })

    const xAxis = option.xAxis as any
    const chartSeries = (option.series as any[])[0]

    expect(xAxis.type).toBe('category')
    // Category axis: data is plain y values, xAxis.data has the raw date strings
    expect(xAxis.data).toEqual(['2024-01-31', '2024-02-28', '2024-03-31'])
    expect(chartSeries.data).toEqual([100, 200, 300])
  })

  it('bar chart with date column formats axis labels as dates', () => {
    const option = buildChartOption({
      chartType: 'bar',
      xAxisData: ['2024-02-28'],
      series: [{ name: 'revenue', data: [100] }],
      xAxisLabel: 'date',
      yAxisLabel: 'revenue',
      xAxisColumns: ['date'],
      colorPalette: ['#16a085'],
      columnTypes: { date: 'date' },
    })

    const xAxis = option.xAxis as any
    // The formatter should format date strings into human-readable labels
    expect(xAxis.axisLabel.formatter('2024-02-28')).toBe('28 Feb 2024')
  })

  describe('data label color', () => {
    const barWith = (styleConfig: any) => buildChartOption({
      chartType: 'bar',
      xAxisData: ['a', 'b', 'c'],
      series: [{ name: 'revenue', data: [100, 200, 300] }],
      xAxisLabel: 'zone',
      yAxisLabel: 'revenue',
      xAxisColumns: ['zone'],
      colorPalette: ['#16a085'],
      columnTypes: { zone: 'text' },
      styleConfig,
    })

    it('defaults bar data labels to black', () => {
      const series = (barWith({ showDataLabels: true }).series as any[])[0]
      expect(series.label.color).toBe('#000')
    })

    it('uses styleConfig.dataLabelColor when set', () => {
      const series = (barWith({ showDataLabels: true, dataLabelColor: '#ffffff' }).series as any[])[0]
      expect(series.label.color).toBe('#ffffff')
    })
  })

  it('bar chart with number column uses category axis with number-formatted labels', () => {
    const option = buildChartOption({
      chartType: 'bar',
      xAxisData: ['1000', '2000', '3000'],
      series: [{ name: 'revenue', data: [100, 200, 300] }],
      xAxisLabel: 'rank',
      yAxisLabel: 'revenue',
      xAxisColumns: ['rank'],
      colorPalette: ['#16a085'],
      columnTypes: { rank: 'number' },
    })

    const xAxis = option.xAxis as any
    const chartSeries = (option.series as any[])[0]

    expect(xAxis.type).toBe('category')
    expect(xAxis.data).toEqual(['1000', '2000', '3000'])
    expect(chartSeries.data).toEqual([100, 200, 300])
  })

  it.each([
    ['line'],
    ['area'],
  ] as const)('uses value axis for %s charts when x column is number', (chartType) => {
    const option = buildChartOption({
      chartType,
      xAxisData: ['10', '20', '30'],
      series: [{ name: 'revenue', data: [100, 200, 300] }],
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

  it('scatter chart with date column uses time axis (not category)', () => {
    const option = buildChartOption({
      chartType: 'scatter',
      xAxisData: ['2024-01-15', '2024-02-20'],
      series: [{ name: 'revenue', data: [100, 200] }],
      xAxisLabel: 'date',
      yAxisLabel: 'revenue',
      xAxisColumns: ['date'],
      colorPalette: ['#16a085'],
      columnTypes: { date: 'date' },
    })

    const xAxis = option.xAxis as any
    expect(xAxis.type).toBe('time')
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

describe('buildFunnelChartOption', () => {
  it('honors styleConfig.dataLabelColor on the funnel label', () => {
    const option = buildFunnelChartOption({
      xAxisData: ['Visit', 'Signup', 'Purchase'],
      series: [{ name: 'Stage', data: [100, 60, 30] }],
      colorPalette: ['#16a085', '#2980b9'],
      styleConfig: { dataLabelColor: '#ff00ff' },
    })
    expect((option.series as any[])[0].label.color).toBe('#ff00ff')
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

  it('honors styleConfig.dataLabelColor on the pie label', () => {
    const option = buildPieChartOption({
      xAxisData: ['Chrome', 'Firefox'],
      series: [{ name: 'Users', data: [60, 40] }],
      colorPalette: COLOR_PALETTE,
      styleConfig: { dataLabelColor: '#ff00ff' },
    })
    expect((option.series as any[])[0].label.color).toBe('#ff00ff')
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

// ─── geo-color-scale.test.ts ───

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

// ─── geo-constraints.test.ts ───

const geoColumns = ['state', 'revenue', 'lat', 'lng', 'lat2', 'lng2', 'intensity']

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

// ─── getVizSettingsWarning ───

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

// ─── resolveAnnotationY ───

describe('resolveAnnotationY', () => {
  const series = [
    { name: 'A', data: [10, 20, 30] },
    { name: 'B', data: [5, 15, 25] },
    { name: 'C', data: [3, 7, 12] },
  ]

  it('returns individual value when not stacked', () => {
    const result = resolveAnnotationY({
      series,
      matchedSeriesIndex: 1,
      pointIndex: 2,
      pointY: 25,
      isStacked: false,
      yAxisAssignments: [0, 0, 0],
    })
    expect(result).toBe(25)
  })

  it('returns cumulative value for bottom series when stacked', () => {
    // Series A is index 0 (bottom of stack), its cumulative = its own value
    const result = resolveAnnotationY({
      series,
      matchedSeriesIndex: 0,
      pointIndex: 1,
      pointY: 20,
      isStacked: true,
      yAxisAssignments: [0, 0, 0],
    })
    expect(result).toBe(20)
  })

  it('returns cumulative value for middle series when stacked', () => {
    // Series B is index 1, stacked on A. cumulative = A[1] + B[1] = 20 + 15 = 35
    const result = resolveAnnotationY({
      series,
      matchedSeriesIndex: 1,
      pointIndex: 1,
      pointY: 15,
      isStacked: true,
      yAxisAssignments: [0, 0, 0],
    })
    expect(result).toBe(35)
  })

  it('returns cumulative value for top series when stacked', () => {
    // Series C is index 2, stacked on A+B. cumulative = A[1] + B[1] + C[1] = 20 + 15 + 7 = 42
    const result = resolveAnnotationY({
      series,
      matchedSeriesIndex: 2,
      pointIndex: 1,
      pointY: 7,
      isStacked: true,
      yAxisAssignments: [0, 0, 0],
    })
    expect(result).toBe(42)
  })

  it('only sums series in the same stack group (dual axis)', () => {
    // A and C on left (axis 0), B on right (axis 1)
    // C is index 2, stacked with A only. cumulative = A[0] + C[0] = 10 + 3 = 13
    const result = resolveAnnotationY({
      series,
      matchedSeriesIndex: 2,
      pointIndex: 0,
      pointY: 3,
      isStacked: true,
      yAxisAssignments: [0, 1, 0],
    })
    expect(result).toBe(13)
  })

  it('returns null when no series specified (x-only annotation)', () => {
    const result = resolveAnnotationY({
      series,
      matchedSeriesIndex: null,
      pointIndex: null,
      pointY: null,
      isStacked: false,
      yAxisAssignments: [0, 0, 0],
    })
    expect(result).toBeNull()
  })

  it('skips NaN values in stack summation', () => {
    const seriesWithNaN = [
      { name: 'A', data: [10, NaN, 30] },
      { name: 'B', data: [5, 15, 25] },
    ]
    const result = resolveAnnotationY({
      series: seriesWithNaN,
      matchedSeriesIndex: 1,
      pointIndex: 1,
      pointY: 15,
      isStacked: true,
      yAxisAssignments: [0, 0],
    })
    // A[1] is NaN, so only B[1] = 15
    expect(result).toBe(15)
  })
})

// ─── findMatchingXIndex ───

describe('findMatchingXIndex', () => {
  it('returns exact match index', () => {
    const xAxisData = ['Jan', 'Feb', 'Mar']
    expect(findMatchingXIndex(xAxisData, 'Feb')).toBe(1)
  })

  it('matches date-only string against full ISO timestamp', () => {
    const xAxisData = ['2026-01-01T00:00:00.000Z', '2026-02-28T00:00:00.000Z', '2026-03-15T00:00:00.000Z']
    expect(findMatchingXIndex(xAxisData, '2026-02-28')).toBe(1)
  })

  it('matches full ISO against date-only xAxisData', () => {
    const xAxisData = ['2026-01-01', '2026-02-28', '2026-03-15']
    expect(findMatchingXIndex(xAxisData, '2026-02-28T00:00:00.000Z')).toBe(1)
  })

  it('returns -1 when no match found', () => {
    const xAxisData = ['2026-01-01T00:00:00.000Z', '2026-03-15T00:00:00.000Z']
    expect(findMatchingXIndex(xAxisData, '2026-02-28')).toBe(-1)
  })

  it('prefers exact match over prefix match', () => {
    const xAxisData = ['2026-02-28', '2026-02-28T00:00:00.000Z']
    expect(findMatchingXIndex(xAxisData, '2026-02-28')).toBe(0)
  })

  it('works with numeric x values', () => {
    const xAxisData = ['10', '20', '30']
    expect(findMatchingXIndex(xAxisData, 20)).toBe(1)
  })
})

// ─── resolveAnnotationX ───

describe('resolveAnnotationX', () => {
  const xAxisData = ['2026-01-01T00:00:00.000Z', '2026-02-28T00:00:00.000Z', '2026-03-15T00:00:00.000Z']

  it('snaps to nearest xAxisData for category axis', () => {
    const result = resolveAnnotationX({ annotationX: '2026-02-28', xAxisData, axisType: 'category' })
    expect(result).toEqual({ xValue: '2026-02-28T00:00:00.000Z', matchedIndex: 1 })
  })

  it('uses raw value for time axis even when data point exists', () => {
    const result = resolveAnnotationX({ annotationX: '2026-02-28', xAxisData, axisType: 'time' })
    expect(result).toEqual({ xValue: '2026-02-28', matchedIndex: -1 })
  })

  it('uses raw value for time axis with arbitrary date', () => {
    const result = resolveAnnotationX({ annotationX: '2026-02-15', xAxisData, axisType: 'time' })
    expect(result).toEqual({ xValue: '2026-02-15', matchedIndex: -1 })
  })

  it('uses raw number for value axis', () => {
    const result = resolveAnnotationX({ annotationX: 42, xAxisData: ['10', '20', '30'], axisType: 'value' })
    expect(result).toEqual({ xValue: 42, matchedIndex: -1 })
  })

  it('snaps numeric value on category axis', () => {
    const result = resolveAnnotationX({ annotationX: 20, xAxisData: ['10', '20', '30'], axisType: 'category' })
    expect(result).toEqual({ xValue: '20', matchedIndex: 1 })
  })

  it('returns raw value for category axis when no match found', () => {
    const result = resolveAnnotationX({ annotationX: 'missing', xAxisData: ['a', 'b', 'c'], axisType: 'category' })
    expect(result).toEqual({ xValue: 'missing', matchedIndex: -1 })
  })
})
