import { useMemo } from 'react'
import { Box } from '@chakra-ui/react'
import { useAppSelector } from '@/store/hooks'
import { ChartHost } from './ChartHost'
import { useChartContainer } from './useChartContainer'
import { buildPieChartOption, isValidChartData, type ChartProps } from '@/lib/chart/chart-utils'
import { downloadChartCsv } from './build-chart-download'

interface PiePlotProps extends ChartProps {
  emptyMessage?: string
}

export const PiePlot = (props: PiePlotProps) => {
  const { xAxisData, series, emptyMessage, onChartClick, columnFormats, yAxisColumns, xAxisColumns, chartTitle, showChartTitle = true, colorPalette: customPalette, styleConfig, exportBranding, onDownloadImage } = props
  const colorMode = useAppSelector((state) => state.ui.colorMode)
  const { containerRef, containerWidth, containerHeight, chartEvents } = useChartContainer(onChartClick)

  const downloadCsv = useMemo(() => {
    if (!isValidChartData(xAxisData, series)) return undefined
    return () => {
      if (series.length > 1) {
        // Nested pie: one row per (category, split-by group)
        const headers = ['Category', 'Group', 'Value']
        const rows = xAxisData.flatMap((name, xIdx) =>
          series.map(s => {
            const val = s.data[xIdx]
            return [name, s.name, typeof val === 'number' && !isNaN(val) ? val : 0]
          })
        )
        downloadChartCsv(headers, rows)
      } else {
        const pieData = xAxisData.map((name, index) => {
          const value = series.reduce((sum, s) => {
            const val = s.data[index]
            return sum + (typeof val === 'number' && !isNaN(val) ? val : 0)
          }, 0)
          return { name, value }
        })
        const total = pieData.reduce((sum, item) => sum + item.value, 0)
        downloadChartCsv(['Name', 'Value', 'Percent'], pieData.map(item => [
          item.name,
          item.value,
          `${((item.value / total) * 100).toFixed(1)}%`,
        ]))
      }
    }
  }, [xAxisData, series])

  const option = useMemo(() => {
    if (!isValidChartData(xAxisData, series)) {
      return {}
    }

    return buildPieChartOption({
      xAxisData,
      series,
      colorMode,
      containerWidth,
      columnFormats,
      xAxisColumns,
      yAxisColumns,
      chartTitle,
      showChartTitle,
      colorPalette: customPalette,
      styleConfig,
      exportBranding,
      downloadCsv,
      onDownloadImage,
    })
  }, [xAxisData, series, colorMode, containerWidth, containerHeight, columnFormats, xAxisColumns, yAxisColumns, chartTitle, showChartTitle, customPalette, styleConfig, exportBranding, downloadCsv, onDownloadImage])

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
