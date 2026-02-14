import { useMemo, useRef, useState, useEffect } from 'react'
import { Box } from '@chakra-ui/react'
import { useAppSelector } from '@/store/hooks'
import { EChart } from './EChart'
import { isValidChartData, formatLargeNumber, buildToolbox, getTimestamp, type ChartProps } from '@/lib/chart/chart-utils'
import { withMinusXTheme, COLOR_PALETTE } from '@/lib/chart/echarts-theme'
import type { EChartsOption } from 'echarts'

interface PiePlotProps extends ChartProps {
  emptyMessage?: string
}

export const PiePlot = (props: PiePlotProps) => {
  const { xAxisData, series, emptyMessage, onChartClick } = props
  const colorMode = useAppSelector((state) => state.ui.colorMode)
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState<number | undefined>(undefined)
  const [containerHeight, setContainerHeight] = useState<number | undefined>(undefined)

  // Stable click handler via ref
  const onClickRef = useRef(onChartClick)
  useEffect(() => { onClickRef.current = onChartClick })
  const chartEvents = useMemo(() => ({
    click: (params: unknown) => onClickRef.current?.(params),
  }), [])

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

    updateDimensions()

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

    // Transform data for pie chart
    // Each x-axis value becomes a slice
    // Sum values across all series for each slice
    const pieData = xAxisData.map((name, index) => {
      const value = series.reduce((sum, s) => {
        const val = s.data[index]
        return sum + (typeof val === 'number' && !isNaN(val) ? val : 0)
      }, 0)
      return { name, value }
    })

    // Calculate total for percentage
    const total = pieData.reduce((sum, item) => sum + item.value, 0)

    // Assign colors from palette
    const coloredData = pieData.map((item, index) => ({
      ...item,
      itemStyle: {
        color: COLOR_PALETTE[index % COLOR_PALETTE.length],
      },
    }))

    // CSV download for pie chart
    const downloadCsv = () => {
      const headers = ['Name', 'Value', 'Percent']
      const rows = pieData.map(item => [
        item.name,
        item.value,
        ((item.value / total) * 100).toFixed(1) + '%'
      ])

      const escapeCsvValue = (val: string | number) => {
        const str = String(val)
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`
        }
        return str
      }

      const csvContent = [
        headers.map(escapeCsvValue).join(','),
        ...rows.map(row => row.map(escapeCsvValue).join(','))
      ].join('\n')

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `chart-${getTimestamp()}.csv`
      link.click()
      URL.revokeObjectURL(url)
    }

    const baseOption: EChartsOption = {
      toolbox: buildToolbox(colorMode, downloadCsv),
      tooltip: {
        trigger: 'item',
        appendToBody: true,
        z: 9999,
        confine: false,
        formatter: (params: any) => {
          const { name, value, percent } = params
          return `${name}<br/>Value: ${formatLargeNumber(value)}<br/>Percent: ${percent.toFixed(1)}%`
        },
      },
      legend: {
        data: pieData.map(d => d.name),
        top: 10,
        orient: 'horizontal',
        type: pieData.length > 10 ? 'scroll' : 'plain',
        pageIconSize: 10,
        pageTextStyle: { fontSize: 10 },
      },
      series: [
        {
          name: 'Pie',
          type: 'pie',
          radius: ['30%', '70%'],
          center: ['50%', '55%'],
          avoidLabelOverlap: true,
          itemStyle: {
            borderRadius: 10,
            borderColor: colorMode === 'dark' ? '#1a1a1a' : '#ffffff',
            borderWidth: 2,
          },
          label: {
            show: true,
            position: 'outside',
            formatter: (params: any) => {
              const percent = ((params.value / total) * 100).toFixed(1)
              return `${params.name}\n${percent}%`
            },
            textBorderColor: 'transparent',
            textBorderWidth: 0,
            textShadowColor: 'transparent',
            textShadowBlur: 0,
            color: colorMode === 'dark' ?  '#ffffff' : '#1a1a1a',
          },
          labelLine: {
            show: true,
            length: 15,
            length2: 10,
          },
          emphasis: {
            label: {
              show: true,
              fontSize: 14,
              fontWeight: 'bold',
              textBorderColor: 'transparent',
              textBorderWidth: 0,
              textShadowColor: 'transparent',
              textShadowBlur: 0,
            },
          },
          data: coloredData,
        },
      ],
    }

    return withMinusXTheme(baseOption, colorMode)
  }, [xAxisData, series, colorMode, containerWidth, containerHeight])

  if (!isValidChartData(xAxisData, series)) {
    return (
      <Box color="fg.subtle" fontSize="sm" textAlign="center" py={8}>
        {emptyMessage || 'No data available for pie chart'}
      </Box>
    )
  }

  return (
    <Box ref={containerRef} width="100%" height={props.height || '100%'} flex="1" minHeight="300px" overflow="visible" position="relative">
      <EChart
        option={option}
        style={{ width: '100%', height: '100%', minHeight: '300px' }}
        chartSettings={{ useCoarsePointer: true, renderer: 'canvas' }}
        events={chartEvents}
      />
    </Box>
  )
}
