import { useMemo, useState } from 'react'
import { Box, Button } from '@chakra-ui/react'
import { LuArrowRightLeft } from 'react-icons/lu'
import { useAppSelector } from '@/store/hooks'
import { ChartHost } from './ChartHost'
import { useChartContainer } from './useChartContainer'
import { ChartError } from './ChartError'
import { buildFunnelChartOption, isValidChartData, type ChartProps } from '@/lib/chart/chart-utils'
import { downloadChartCsv } from './build-chart-download'

interface FunnelPlotProps extends ChartProps {
  emptyMessage?: string
}

export const FunnelPlot = (props: FunnelPlotProps) => {
  const { xAxisData, series, emptyMessage, onChartClick, columnFormats, yAxisColumns, xAxisColumns, chartTitle, showChartTitle = true, colorPalette: customPalette, styleConfig, exportBranding } = props
  const colorMode = useAppSelector((state) => state.ui.colorMode)
  const { containerRef, containerWidth, containerHeight, chartEvents } = useChartContainer(onChartClick)
  const [orientation, setOrientation] = useState<'horizontal' | 'vertical'>('horizontal')

  const option = useMemo(() => {
    if (!isValidChartData(xAxisData, series)) {
      return {}
    }

    const rawData = xAxisData.map((name, index) => {
      const value = series.reduce((sum, s) => {
        const val = s.data[index]
        return sum + (typeof val === 'number' && !isNaN(val) ? val : 0)
      }, 0)
      return { name, value }
    })
    const downloadCsv = () => {
      const maxValue = Math.max(...rawData.map(item => item.value))
      const topValue = maxValue > 0 ? maxValue : 1
      downloadChartCsv(['Name', 'Value', 'Percent of Top'], rawData.map(item => [
        item.name,
        item.value,
        `${((item.value / topValue) * 100).toFixed(1)}%`,
      ]))
    }

    return buildFunnelChartOption({
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
      orientation,
    })
  }, [xAxisData, series, colorMode, containerWidth, containerHeight, orientation, columnFormats, xAxisColumns, yAxisColumns, chartTitle, showChartTitle, customPalette, styleConfig, exportBranding])

  if ((xAxisColumns?.length ?? 0) > 1) {
    return <ChartError message="Funnel charts support only a single X-axis column. Remove extra columns from the X axis to continue." />
  }

  if ((yAxisColumns?.length ?? 0) > 1) {
    return <ChartError message="Funnel charts support only a single Y-axis column. Remove extra columns from the Y axis to continue." />
  }

  if (!isValidChartData(xAxisData, series)) {
    return (
      <Box color="fg.subtle" fontSize="sm" textAlign="center" py={8}>
        {emptyMessage || 'No data available for funnel chart'}
      </Box>
    )
  }

  return (
    <ChartHost
      containerRef={containerRef}
      height={props.height}
      option={option}
      events={chartEvents}
    >
      <Button
        size="xs"
        variant="ghost"
        position="absolute"
        bottom={2}
        left={2}
        zIndex={10}
        onClick={() => setOrientation(o => o === 'horizontal' ? 'vertical' : 'horizontal')}
      >
        <LuArrowRightLeft style={{ transform: orientation === 'vertical' ? 'rotate(90deg)' : 'none' }} />
        {"orientation"}
      </Button>
    </ChartHost>
  )
}
