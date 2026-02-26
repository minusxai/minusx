import { useMemo } from 'react'
import { Box } from '@chakra-ui/react'
import { useAppSelector } from '@/store/hooks'
import { EChart } from './EChart'
import { useChartContainer } from './useChartContainer'
import { buildChartOption, isValidChartData, type ChartProps } from '@/lib/chart/chart-utils'
import type { EChartsOption } from 'echarts'

interface BaseChartProps extends ChartProps {
  chartType: 'line' | 'bar' | 'area' | 'scatter'
  emptyMessage?: string
  additionalOptions?: Partial<EChartsOption>
  height?: string | number
}

export const BaseChart = (props: BaseChartProps) => {
  const { xAxisData, series, xAxisLabel, yAxisLabel, yAxisColumns, xAxisColumns, chartType, emptyMessage, additionalOptions, onChartClick, columnFormats, chartTitle, showChartTitle } = props
  const colorMode = useAppSelector((state) => state.ui.colorMode)
  const { containerRef, containerWidth, containerHeight, chartEvents } = useChartContainer(onChartClick)

  const option: EChartsOption = useMemo(() => {
    if (!isValidChartData(xAxisData, series)) {
      return {}
    }

    return buildChartOption({
      xAxisData,
      series,
      xAxisLabel,
      yAxisLabel,
      yAxisColumns,
      xAxisColumns,
      chartType,
      additionalOptions,
      colorMode,
      containerWidth,
      containerHeight,
      columnFormats,
      chartTitle,
      showChartTitle,
    })
  }, [xAxisData, series, xAxisLabel, yAxisLabel, yAxisColumns, xAxisColumns, chartType, additionalOptions, colorMode, containerWidth, containerHeight, columnFormats, chartTitle, showChartTitle])

  if (!isValidChartData(xAxisData, series)) {
    return (
      <Box color="fg.subtle" fontSize="sm" textAlign="center" py={8}>
        {emptyMessage || `No data available for ${chartType} chart`}
      </Box>
    )
  }

  return (
    <Box ref={containerRef} width="100%" height={props.height || '100%'} flex="1" minHeight="300px" overflow="visible">
      <EChart
        option={option}
        style={{ width: '100%', height: '100%', minHeight: '300px' }}
        chartSettings={{ useCoarsePointer: true, renderer: 'canvas' }}
        events={chartEvents}
      />
    </Box>
  )
}
