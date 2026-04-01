import { buildChartOption } from '@/lib/chart/chart-utils'

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
