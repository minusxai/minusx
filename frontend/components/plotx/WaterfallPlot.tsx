import { useMemo } from 'react'
import { Box } from '@chakra-ui/react'
import { useAppSelector } from '@/store/hooks'
import { ChartHost } from './ChartHost'
import { useChartContainer } from './useChartContainer'
import { ChartError } from './ChartError'
import { buildWaterfallChartOption, isValidChartData, type ChartProps } from '@/lib/chart/chart-utils'
import { downloadChartCsv } from './build-chart-download'

interface WaterfallPlotProps extends ChartProps {
  emptyMessage?: string
}

export const WaterfallPlot = (props: WaterfallPlotProps) => {
  const { xAxisData, series, emptyMessage, onChartClick, columnFormats, yAxisColumns, xAxisColumns, chartTitle, showChartTitle = true, colorPalette: customPalette, styleConfig, exportBranding } = props
  const colorMode = useAppSelector((state) => state.ui.colorMode)
  const { containerRef, containerWidth, containerHeight, chartEvents } = useChartContainer(onChartClick)

  const xColCount = xAxisColumns?.length ?? 0
  const yColCount = yAxisColumns?.length ?? 0

  const option = useMemo(() => {
    if (!isValidChartData(xAxisData, series)) {
      return {}
    }

    const values = xAxisData.map((_, index) =>
      series.reduce((sum, s) => {
        const val = s.data[index]
        return sum + (typeof val === 'number' && !isNaN(val) ? val : 0)
      }, 0)
    )

    const runningTotals: number[] = []
    let cumulative = 0
    for (let i = 0; i < values.length; i++) {
      cumulative += values[i]
      runningTotals.push(cumulative)
    }

    const totalValue = cumulative
    const allLabels = [...xAxisData, 'Total']
    const allValues = [...values, totalValue]
    const allRunningTotals = [...runningTotals, totalValue]

    const downloadCsv = () => {
      downloadChartCsv(['Step', 'Value', 'Running Total'], allLabels.map((name, i) => [
        name,
        allValues[i],
        allRunningTotals[i],
      ]))
    }

    return buildWaterfallChartOption({
      xAxisData,
      series,
      colorMode,
      columnFormats,
      xAxisColumns,
      yAxisColumns,
      chartTitle,
      showChartTitle,
      colorPalette: customPalette,
      styleConfig,
      exportBranding,
      downloadCsv,
    })
  }, [xAxisData, series, colorMode, containerWidth, containerHeight, columnFormats, xAxisColumns, yAxisColumns, chartTitle, showChartTitle, customPalette, styleConfig, exportBranding])

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
    <ChartHost
      containerRef={containerRef}
      height={props.height}
      option={option}
      events={chartEvents}
    />
  )
}
