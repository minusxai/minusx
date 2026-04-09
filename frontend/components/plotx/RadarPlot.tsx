import { useMemo } from 'react'
import { Box } from '@chakra-ui/react'
import { useAppSelector } from '@/store/hooks'
import { ChartHost } from './ChartHost'
import { useChartContainer } from './useChartContainer'
import { ChartError } from './ChartError'
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

  if ((xAxisColumns?.length ?? 0) > 1) {
    return <ChartError message="Radar charts support only a single X-axis column. Remove extra columns from the X axis to continue." />
  }


  if (!isValidChartData(xAxisData, series)) {
    return (
      <Box color="fg.subtle" fontSize="sm" textAlign="center" py={8}>
        {emptyMessage || 'No data available for radar chart'}
      </Box>
    )
  }

  if (xAxisData.length < 3) {
    return <ChartError variant="info" message="Radar charts need at least 3 categories to display meaningfully. Add more data or choose a different chart type." />
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
