import { useMemo, useRef, useState, useEffect } from 'react'
import { Box } from '@chakra-ui/react'
import { useAppSelector } from '@/store/hooks'
import { EChart } from './EChart'
import { buildChartOption, isValidChartData, type ChartProps } from '@/lib/chart/chart-utils'
import type { EChartsOption } from 'echarts'

interface BaseChartProps extends ChartProps {
  chartType: 'line' | 'bar' | 'area' | 'scatter'
  emptyMessage?: string
  additionalOptions?: Partial<EChartsOption>
  height?: string | number
}

export const BaseChart = (props: BaseChartProps) => {
  const { xAxisData, series, xAxisLabel, yAxisLabel, yAxisColumns, chartType, emptyMessage, additionalOptions } = props
  const colorMode = useAppSelector((state) => state.ui.colorMode)
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState<number | undefined>(undefined)
  const [containerHeight, setContainerHeight] = useState<number | undefined>(undefined)

  // Measure container dimensions
  useEffect(() => {
    if (!containerRef.current) return

    const updateDimensions = () => {
      if (containerRef.current) {
        const newWidth = containerRef.current.offsetWidth
        const newHeight = containerRef.current.offsetHeight
        if (newWidth > 0) setContainerWidth(newWidth)
        if (newHeight > 0) setContainerHeight(newHeight)
      }
    }

    // Immediate measurement
    updateDimensions()

    // Use ResizeObserver for dynamic changes
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width > 0) setContainerWidth(width)
        if (height > 0) setContainerHeight(height)
      }
    })

    resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
    }
  }, [])

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
      chartType,
      additionalOptions,
      colorMode,
      containerWidth,
      containerHeight,
    })
  }, [xAxisData, series, xAxisLabel, yAxisLabel, yAxisColumns, chartType, additionalOptions, colorMode, containerWidth, containerHeight])

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
      />
    </Box>
  )
}
