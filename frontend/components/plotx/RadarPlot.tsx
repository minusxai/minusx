import { useMemo } from 'react'
import { Box } from '@chakra-ui/react'
import { useAppSelector } from '@/store/hooks'
import { ChartHost } from './ChartHost'
import { useChartContainer } from './useChartContainer'
import { buildRadarChartOption, isValidChartData, type ChartProps } from '@/lib/chart/chart-utils'
import { downloadChartCsv } from './build-chart-download'

interface RadarPlotProps extends ChartProps {
  emptyMessage?: string
}

export const RadarPlot = (props: RadarPlotProps) => {
  const { xAxisData, series, emptyMessage, onChartClick, columnFormats, yAxisColumns, xAxisColumns, chartTitle, showChartTitle = true, colorPalette: customPalette, styleConfig, exportBranding, onDownloadImage } = props
  const colorMode = useAppSelector((state) => state.ui.colorMode)
  const { containerRef, containerWidth, containerHeight, chartEvents } = useChartContainer(onChartClick)

  const option = useMemo(() => {
    if (!isValidChartData(xAxisData, series)) {
      return {}
    }

    const downloadCsv = () => {
      const headers = ['Indicator', ...series.map(s => s.name)]
      const rows = xAxisData.map((name, i) => [
        name,
        ...series.map(s => s.data[i] ?? 0),
      ])
      downloadChartCsv(headers, rows)
    }

    return buildRadarChartOption({
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
  }, [xAxisData, series, colorMode, containerWidth, containerHeight, columnFormats, xAxisColumns, yAxisColumns, chartTitle, showChartTitle, customPalette, styleConfig, exportBranding, onDownloadImage])

  if (!isValidChartData(xAxisData, series)) {
    return (
      <Box color="fg.subtle" fontSize="sm" textAlign="center" py={8}>
        {emptyMessage || 'No data available for radar chart'}
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
