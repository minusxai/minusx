import { useCallback, useMemo } from 'react'
import { Box } from '@chakra-ui/react'
import { useAppSelector } from '@/store/hooks'
import { useChartContainer } from './useChartContainer'
import { ChartHost } from './ChartHost'
import { buildAnnotationGraphics, buildChartOption, isValidChartData, type ChartProps } from '@/lib/chart/chart-utils'
import type { EChartsOption } from 'echarts'
import type { EChartsType } from 'echarts/core'

interface BaseChartProps extends ChartProps {
  chartType: 'line' | 'bar' | 'area' | 'scatter' | 'combo'
  emptyMessage?: string
  additionalOptions?: Partial<EChartsOption>
  height?: string | number
}

export const BaseChart = (props: BaseChartProps) => {
  const { xAxisData, series, xAxisLabel, yAxisLabel, yAxisColumns, yRightCols, xAxisColumns, pointMeta, tooltipColumns, chartType, emptyMessage, additionalOptions, onChartClick, columnFormats, chartTitle, showChartTitle, colorPalette, axisConfig, styleConfig, annotations, exportBranding, onDownloadImage, columnTypes } = props
  const colorMode = useAppSelector((state) => state.ui.colorMode)
  const { containerRef, containerWidth, containerHeight, chartEvents } = useChartContainer(onChartClick)
  const chartInstanceKey = useMemo(
    () => JSON.stringify({
      chartType,
      xScale: axisConfig?.xScale ?? 'linear',
      yScale: axisConfig?.yScale ?? 'linear',
    }),
    [chartType, axisConfig?.xScale, axisConfig?.yScale]
  )

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
      yRightCols,
      xAxisColumns,
      pointMeta,
      tooltipColumns,
      chartType,
      additionalOptions,
      colorMode,
      containerWidth,
      containerHeight,
      columnFormats,
      chartTitle,
      showChartTitle,
      colorPalette,
      axisConfig,
      styleConfig,
      annotations,
      columnTypes,
      exportBranding,
      onDownloadImage,
    })
  }, [xAxisData, series, xAxisLabel, yAxisLabel, yAxisColumns, yRightCols, xAxisColumns, pointMeta, tooltipColumns, chartType, additionalOptions, colorMode, containerWidth, containerHeight, columnFormats, chartTitle, showChartTitle, colorPalette, axisConfig, styleConfig, annotations, columnTypes, exportBranding, onDownloadImage])

  const handleChartUpdate = useCallback((chart: EChartsType) => {
    const graphic = buildAnnotationGraphics({
      chart,
      xAxisData,
      series,
      chartType,
      xAxisColumns,
      yAxisColumns,
      yRightCols,
      columnFormats,
      annotations,
      axisConfig,
      colorMode,
      colorPalette,
      columnTypes,
    })

    chart.setOption(
      { graphic },
      { notMerge: false, replaceMerge: ['graphic'] }
    )
  }, [annotations, chartType, colorMode, colorPalette, columnFormats, series, xAxisColumns, xAxisData, yAxisColumns, yRightCols, axisConfig, columnTypes])

  if (!isValidChartData(xAxisData, series)) {
    return (
      <Box color="fg.subtle" fontSize="sm" textAlign="center" py={8}>
        {emptyMessage || `No data available for ${chartType} chart`}
      </Box>
    )
  }

  return (
    <ChartHost
      containerRef={containerRef}
      height={props.height}
      option={option}
      events={chartEvents}
      onChartUpdate={handleChartUpdate}
      chartKey={chartInstanceKey}
    />
  )
}
