import { buildChartOption, buildRadarChartOption } from '@/lib/chart/chart-utils'

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
