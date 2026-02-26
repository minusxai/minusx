import { useMemo, useState } from 'react'
import { Box, Button } from '@chakra-ui/react'
import { LuArrowRightLeft } from 'react-icons/lu'
import { useAppSelector } from '@/store/hooks'
import { EChart } from './EChart'
import { useChartContainer } from './useChartContainer'
import { ChartError } from './ChartError'
import { isValidChartData, resolveChartFormats, buildToolbox, getTimestamp, type ChartProps } from '@/lib/chart/chart-utils'
import { withMinusXTheme, COLOR_PALETTE } from '@/lib/chart/echarts-theme'
import type { EChartsOption } from 'echarts'

// Theme-aware text colors
const LABEL_COLORS = {
  light: '#0D1117',
  dark: '#E6EDF3',
}

interface FunnelPlotProps extends ChartProps {
  emptyMessage?: string
}

export const FunnelPlot = (props: FunnelPlotProps) => {
  const { xAxisData, series, emptyMessage, onChartClick, columnFormats, yAxisColumns, xAxisColumns, chartTitle, showChartTitle = true } = props
  const colorMode = useAppSelector((state) => state.ui.colorMode)
  const { containerRef, containerWidth, containerHeight, chartEvents } = useChartContainer(onChartClick)
  const [orientation, setOrientation] = useState<'horizontal' | 'vertical'>('horizontal')

  const { fmtName, fmtValue } = resolveChartFormats(columnFormats, xAxisColumns, yAxisColumns)

  const option: EChartsOption = useMemo(() => {
    if (!isValidChartData(xAxisData, series)) {
      return {}
    }

    // Transform data for funnel chart
    // Each x-axis value becomes a funnel stage
    // Sum values across all series for each stage
    const rawData = xAxisData.map((name, index) => {
      const value = series.reduce((sum, s) => {
        const val = s.data[index]
        return sum + (typeof val === 'number' && !isNaN(val) ? val : 0)
      }, 0)
      return { name: fmtName(name), value }
    })

    // Sort by value descending for proper funnel display
    rawData.sort((a, b) => b.value - a.value)

    // Use single base color with decreasing opacity
    const baseColor = COLOR_PALETTE[0] // Teal
    const funnelData = rawData.map((item, index) => {
      // Opacity decreases from 1.0 to 0.3 based on position
      const opacity = 1.0 - (index * 0.6) / Math.max(rawData.length - 1, 1)
      return {
        ...item,
        itemStyle: {
          color: baseColor,
          opacity: Math.max(0.4, opacity),
        },
      }
    })

    // Top value for calculating percentage (first item after sorting is largest)
    const topValue = funnelData.length > 0 ? funnelData[0].value : 1

    // CSV download for funnel chart
    const downloadCsv = () => {
      const headers = ['Name', 'Value', 'Percent of Top']
      const rows = funnelData.map(item => [
        item.name,
        item.value,
        ((item.value / topValue) * 100).toFixed(1) + '%'
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
      ...(chartTitle ? { title: { text: chartTitle, left: 'center', top: 5, show: showChartTitle } } : {}),
      toolbox: buildToolbox(colorMode, downloadCsv, chartTitle),
      tooltip: {
        trigger: 'item',
        appendToBody: true,
        z: 9999,
        confine: false,
        formatter: (params: any) => {
          const { name, value } = params
          // Calculate percentage relative to top stage
          const percentOfTop = (value / topValue) * 100
          return `${name}<br/>Value: ${fmtValue(value)}<br/>Percent: ${percentOfTop.toFixed(1)}%`
        },
      },
      legend: {
        data: funnelData.map(d => d.name),
        top: chartTitle && showChartTitle ? 35 : 10,
        orient: 'horizontal',
        type: funnelData.length > 10 ? 'scroll' : 'plain',
        pageIconSize: 10,
        pageTextStyle: { fontSize: 10 },
      },
      series: [
        {
          name: 'Funnel',
          type: 'funnel',
          orient: orientation,
          ...(orientation === 'horizontal'
            ? { left: '5%', right: '5%', top: 60, bottom: 20, width: '90%', height: '70%' }
            : { left: '10%', top: 60, bottom: 20, width: '80%' }
          ),
          min: 0,
          max: Math.max(...funnelData.map(d => d.value)),
          minSize: '0%',
          maxSize: '100%',
          sort: 'descending',
          gap: 2,
          label: {
            show: true,
            position: 'inside',
            color: LABEL_COLORS[colorMode],
            fontWeight: 'bold',
            formatter: (params: any) => {
              return `${params.name}\n${fmtValue(params.value)}`
            },
          },
          labelLine: {
            length: 10,
            lineStyle: {
              width: 1,
            },
          },
          itemStyle: {
            borderColor: 'transparent',
            borderWidth: 1,
          },
          emphasis: {
            label: {
              fontSize: 14,
              color: LABEL_COLORS[colorMode],
            },
          },
          data: funnelData,
        },
      ],
    }

    return withMinusXTheme(baseOption, colorMode)
  }, [xAxisData, series, colorMode, containerWidth, containerHeight, orientation, fmtName, fmtValue])

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
    <Box ref={containerRef} width="100%" height={props.height || '100%'} flex="1" minHeight="300px" overflow="visible" position="relative">
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
      <EChart
        option={option}
        style={{ width: '100%', height: '100%', minHeight: '300px' }}
        chartSettings={{ useCoarsePointer: true, renderer: 'canvas' }}
        events={chartEvents}
      />
    </Box>
  )
}
