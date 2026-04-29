import { useMemo } from 'react'
import { Box } from '@chakra-ui/react'
import { useAppSelector } from '@/store/hooks'
import { ChartHost } from './ChartHost'
import { useChartContainer } from './useChartContainer'
import { buildWaterfallChartOption, isValidChartData, type ChartProps } from '@/lib/chart/chart-utils'
import { downloadChartCsv } from './build-chart-download'

interface WaterfallPlotProps extends ChartProps {
  emptyMessage?: string
}

export const WaterfallPlot = (props: WaterfallPlotProps) => {
  const { xAxisData, series, emptyMessage, onChartClick, columnFormats, yAxisColumns, xAxisColumns, xAxisLabel, yAxisLabel, chartTitle, showChartTitle = true, colorPalette: customPalette, styleConfig, exportBranding, onDownloadImage } = props
  const colorMode = useAppSelector((state) => state.ui.colorMode)
  const { containerRef, containerWidth, containerHeight, chartEvents } = useChartContainer(onChartClick)

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
      containerWidth,
      columnFormats,
      xAxisColumns,
      yAxisColumns,
      xAxisLabel,
      yAxisLabel,
      chartTitle,
      showChartTitle,
      colorPalette: customPalette,
      styleConfig,
      exportBranding,
      downloadCsv,
      onDownloadImage,
    })
  }, [xAxisData, series, colorMode, containerWidth, containerHeight, columnFormats, xAxisColumns, yAxisColumns, chartTitle, showChartTitle, customPalette, styleConfig, exportBranding, onDownloadImage])

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
