import { buildChartOption, buildRadarChartOption, buildPieChartOption } from '@/lib/chart/chart-utils'

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
    // All indicators should share the same max
    expect(new Set(maxValues).size).toBe(1)
    // Max should be >= 100 (the largest data value) with headroom
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
    // Simulates aggregateData output when xCols = ['Region', 'Browser']
    // xAxisData = primary X values, series = one per split-by group
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

    // Inner ring: one slice per xAxisData entry, values summed across series
    const inner = allSeries[0]
    expect(inner.type).toBe('pie')
    expect(inner.data).toHaveLength(2)
    expect(inner.data[0].name).toBe('US')
    expect(inner.data[0].value).toBe(60) // 40 + 20
    expect(inner.data[1].name).toBe('UK')
    expect(inner.data[1].value).toBe(40) // 15 + 25

    // Inner ring should have smaller radius
    expect(inner.radius[1]).not.toBe(inner.radius[0])

    // Outer ring: one slice per (xAxisData, series) pair
    const outer = allSeries[1]
    expect(outer.type).toBe('pie')
    expect(outer.data).toHaveLength(4) // 2 regions × 2 browsers
    // Outer ring should have larger radius than inner
    const innerMax = parseInt(inner.radius[1])
    const outerMin = parseInt(outer.radius[0])
    expect(outerMin).toBeGreaterThan(innerMax)
  })
})
