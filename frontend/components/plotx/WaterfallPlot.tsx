import { useMemo } from 'react'
import { Box } from '@chakra-ui/react'
import { useAppSelector } from '@/store/hooks'
import { EChart } from './EChart'
import { useChartContainer } from './useChartContainer'
import { ChartError } from './ChartError'
import { isValidChartData, resolveChartFormats, buildToolbox, getTimestamp, type ChartProps } from '@/lib/chart/chart-utils'
import { withMinusXTheme, COLOR_PALETTE } from '@/lib/chart/echarts-theme'
import type { EChartsOption } from 'echarts'

interface WaterfallPlotProps extends ChartProps {
  emptyMessage?: string
}

export const WaterfallPlot = (props: WaterfallPlotProps) => {
  const { xAxisData, series, emptyMessage, onChartClick, columnFormats, yAxisColumns, xAxisColumns, chartTitle, showChartTitle = true } = props
  const colorMode = useAppSelector((state) => state.ui.colorMode)
  const { containerRef, containerWidth, containerHeight, chartEvents } = useChartContainer(onChartClick)

  const xColCount = xAxisColumns?.length ?? 0
  const yColCount = yAxisColumns?.length ?? 0

  const { fmtName, fmtValue } = resolveChartFormats(columnFormats, xAxisColumns, yAxisColumns)

  const option: EChartsOption = useMemo(() => {
    if (!isValidChartData(xAxisData, series)) {
      return {}
    }

    // Sum values across all series for each x-index to get a single value per step
    const values = xAxisData.map((_, index) =>
      series.reduce((sum, s) => {
        const val = s.data[index]
        return sum + (typeof val === 'number' && !isNaN(val) ? val : 0)
      }, 0)
    )

    // Compute running totals and base offsets
    const runningTotals: number[] = []
    const bases: number[] = []
    let cumulative = 0
    for (let i = 0; i < values.length; i++) {
      bases.push(values[i] >= 0 ? cumulative : cumulative + values[i])
      cumulative += values[i]
      runningTotals.push(cumulative)
    }

    // Append a "Total" bar
    const totalValue = cumulative
    const allLabels = [...xAxisData.map(fmtName), 'Total']
    const allValues = [...values, totalValue]
    const allRunningTotals = [...runningTotals, totalValue]
    const allBases = [...bases, 0]

    // Split into increase/decrease/total series
    const increaseData = allValues.map((v, i) => (i === allValues.length - 1 ? 0 : v >= 0 ? v : 0))
    const decreaseData = allValues.map((v, i) => (i === allValues.length - 1 ? 0 : v < 0 ? Math.abs(v) : 0))
    const totalData = allValues.map((v, i) => (i === allValues.length - 1 ? v : 0))

    // CSV download
    const downloadCsv = () => {
      const headers = ['Step', 'Value', 'Running Total']
      const rows = allLabels.map((name, i) => [
        name,
        allValues[i],
        allRunningTotals[i],
      ])

      const escapeCsvValue = (val: string | number) => {
        const str = String(val)
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`
        }
        return str
      }

      const csvContent = [
        headers.map(escapeCsvValue).join(','),
        ...rows.map(row => row.map(escapeCsvValue).join(','))
      ].join('\n')

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `chart-${getTimestamp()}.csv`
      link.click()
      URL.revokeObjectURL(url)
    }

    const increaseColor = COLOR_PALETTE[0] // teal
    const decreaseColor = '#e74c3c' // red

    const baseOption: EChartsOption = {
      ...(chartTitle ? { title: { text: chartTitle, left: 'center', top: 5, show: showChartTitle } } : {}),
      toolbox: buildToolbox(colorMode, downloadCsv, chartTitle),
      tooltip: {
        trigger: 'axis',
        appendToBody: true,
        z: 9999,
        confine: false,
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const items = Array.isArray(params) ? params : [params]
          const idx = items[0]?.dataIndex ?? 0
          const name = allLabels[idx]
          const value = allValues[idx]
          const total = allRunningTotals[idx]
          const isTotal = idx === allLabels.length - 1
          if (isTotal) {
            return `${name}<br/>Total: ${fmtValue(total)}`
          }
          const sign = value >= 0 ? '+' : ''
          return `${name}<br/>Change: ${sign}${fmtValue(value)}<br/>Running Total: ${fmtValue(total)}`
        },
      },
      xAxis: {
        type: 'category',
        data: allLabels,
        axisLabel: {
          rotate: allLabels.length > 8 ? 30 : 0,
          hideOverlap: true,
        },
      },
      yAxis: {
        type: 'value',
      },
      series: [
        {
          name: 'Base',
          type: 'bar',
          stack: 'waterfall',
          itemStyle: { color: 'transparent' },
          emphasis: { itemStyle: { color: 'transparent' } },
          data: allBases,
          tooltip: { show: false },
        },
        {
          name: 'Increase',
          type: 'bar',
          stack: 'waterfall',
          itemStyle: { color: increaseColor },
          data: increaseData,
        },
        {
          name: 'Decrease',
          type: 'bar',
          stack: 'waterfall',
          itemStyle: { color: decreaseColor },
          data: decreaseData,
        },
        {
          name: 'Total',
          type: 'bar',
          stack: 'waterfall',
          itemStyle: { color: COLOR_PALETTE[1] },
          data: totalData,
        },
      ],
      legend: { show: false },
    }

    return withMinusXTheme(baseOption, colorMode)
  }, [xAxisData, series, colorMode, containerWidth, containerHeight, fmtName, fmtValue])

  if (xColCount > 1) {
    return <ChartError message="Waterfall charts support only a single X-axis column. Remove extra columns from the X axis to continue." />
  }

  if (yColCount > 1) {
    return <ChartError message="Waterfall charts support only a single Y-axis column. Remove extra columns from the Y axis to continue." />
  }

  if (!isValidChartData(xAxisData, series)) {
    return (
      <Box color="fg.subtle" fontSize="sm" textAlign="center" py={8}>
        {emptyMessage || 'No data available for waterfall chart'}
      </Box>
    )
  }

  return (
    <Box ref={containerRef} width="100%" height={props.height || '100%'} flex="1" minHeight="300px" overflow="visible" position="relative">
      <EChart
        option={option}
        style={{ width: '100%', height: '100%', minHeight: '300px' }}
        chartSettings={{ useCoarsePointer: true, renderer: 'canvas' }}
        events={chartEvents}
      />
    </Box>
  )
}
