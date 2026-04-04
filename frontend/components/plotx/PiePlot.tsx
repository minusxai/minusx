import { useMemo } from 'react'
import { Box } from '@chakra-ui/react'
import { useAppSelector } from '@/store/hooks'
import { ChartHost } from './ChartHost'
import { useChartContainer } from './useChartContainer'
import { ChartError } from './ChartError'
import { buildPieChartOption, isValidChartData, type ChartProps } from '@/lib/chart/chart-utils'
import { downloadChartCsv } from './build-chart-download'

interface PiePlotProps extends ChartProps {
  emptyMessage?: string
}

export const PiePlot = (props: PiePlotProps) => {
  const { xAxisData, series, emptyMessage, onChartClick, columnFormats, yAxisColumns, xAxisColumns, chartTitle, showChartTitle = true, colorPalette: customPalette, styleConfig, exportBranding } = props
  const colorMode = useAppSelector((state) => state.ui.colorMode)
  const { containerRef, containerWidth, containerHeight, chartEvents } = useChartContainer(onChartClick)

  const option = useMemo(() => {
    if (!isValidChartData(xAxisData, series)) {
      return {}
    }

    const pieData = xAxisData.map((name, index) => {
      const value = series.reduce((sum, s) => {
        const val = s.data[index]
        return sum + (typeof val === 'number' && !isNaN(val) ? val : 0)
      }, 0)
      return { name, value }
    })
    const total = pieData.reduce((sum, item) => sum + item.value, 0)

    const downloadCsv = () => {
      downloadChartCsv(['Name', 'Value', 'Percent'], pieData.map(item => [
        item.name,
        item.value,
        `${((item.value / total) * 100).toFixed(1)}%`,
      ]))
    }

    return buildPieChartOption({
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

  if ((xAxisColumns?.length ?? 0) > 1) {
    return <ChartError message="Pie charts support only a single X-axis column. Remove extra columns from the X axis to continue." />
  }

  if ((yAxisColumns?.length ?? 0) > 1) {
    return <ChartError message="Pie charts support only a single Y-axis column. Remove extra columns from the Y axis to continue." />
  }

  if (!isValidChartData(xAxisData, series)) {
    return (
      <Box color="fg.subtle" fontSize="sm" textAlign="center" py={8}>
        {emptyMessage || 'No data available for pie chart'}
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
