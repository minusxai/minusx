import { useCallback, useMemo, useRef, useEffect } from 'react'
import { Box } from '@chakra-ui/react'
import { useAppSelector } from '@/store/hooks'
import { useChartContainer } from './useChartContainer'
import { ChartHost } from './ChartHost'
import { useDeepStableIgnoreFunctions } from '@/lib/hooks/use-deep-stable'
import { buildAnnotationGraphics, buildChartOption, isValidChartData, type ChartProps, type StandardChartType } from '@/lib/chart/chart-utils'
import type { EChartsOption } from 'echarts'
import type { EChartsType } from 'echarts/core'

interface BaseChartProps extends ChartProps {
  chartType: StandardChartType
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

  const rawOption: EChartsOption = useMemo(() => {
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

  // Callers above (ChartBuilder and beyond) pass referentially-unstable config
  // objects (axisConfig, styleConfig, annotations, columnFormats…) on every
  // render, so the useMemo above re-runs each time and `rawOption` is a fresh
  // tree even when nothing semantically changed. Collapsing the boundary
  // with a deep-equal stabiliser means EChart's `option`-change effect (and
  // ECharts' own option-diff walk) only fire on genuine option changes.
  //
  // We use the *ignore-functions* variant because `buildChartOption` produces
  // nested formatter closures (`tooltip.formatter`, `yAxis.axisLabel.formatter`,
  // `toolbox.feature.*.tooltip.formatter`, ...) inline each render. Their
  // identities are never stable but their behaviour is derived from data we're
  // also comparing (columnFormats, colorPalette, chartType, ...), so treating
  // them as equal is sound here. The first-iteration trace (Tasks.md #1)
  // showed ChartHost still 100% wasted because plain `isEqual` strictly
  // compared these function refs and bailed.
  const option = useDeepStableIgnoreFunctions(rawOption)

  // Stable callback: read latest props + colorMode from a ref instead of
  // closing over them as closure variables, so the function identity doesn't
  // change every render. The previous useCallback listed 13 deps, several of
  // which were inline-rebuilt by callers upstream. EChart binds onChartUpdate
  // once at init time, so a stable identity matters.
  const annotationCtxRef = useRef({ props, colorMode })
  useEffect(() => { annotationCtxRef.current = { props, colorMode } })
  const handleChartUpdate = useCallback((chart: EChartsType) => {
    const { props: p, colorMode: cm } = annotationCtxRef.current
    // Spread props (rather than re-listing every field) so adding a new
    // ChartProps key flows through automatically.
    const graphic = buildAnnotationGraphics({ chart, ...p, colorMode: cm })
    chart.setOption({ graphic }, { notMerge: false, replaceMerge: ['graphic'] })
  }, [])

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
