import { useMemo } from 'react'
import { Box, HStack, Text } from '@chakra-ui/react'
import { useAppSelector } from '@/store/hooks'
import { EChart } from './EChart'
import { withAtlasTheme } from '@/lib/chart/echarts-theme'

interface MiniHistogramProps {
  data: Array<{ bin: number; binMin: number; binMax: number; count: number }>
  color?: string
  height?: number
  isDate?: boolean
  isFirstColumn?: boolean  // Reserved for future use
  isLastColumn?: boolean   // Reserved for future use
}

export const MiniHistogram = ({
  data,
  color = '#2980b9',
  isDate = false,
}: MiniHistogramProps) => {
  const colorMode = useAppSelector((state) => state.ui.colorMode)

  const option = useMemo(() => {
    if (!data || data.length === 0) return {}

    return withAtlasTheme({
      grid: {
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        containLabel: false,
      },
      xAxis: {
        type: 'category' as const,
        show: false,
        data: data.map((_, index) => index),
      },
      yAxis: {
        type: 'value' as const,
        show: false,
      },
      series: [
        {
          type: 'bar' as const,
          data: data.map(d => d.count),
          itemStyle: {
            color: color,
            borderRadius: [1, 1, 0, 0],
          },
          barWidth: '95%',
          animation: false,
        },
      ],
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'shadow',
        },
        confine: true,
        formatter: (params: any) => {
          const param = params[0]
          const binData = data[param.dataIndex]
          if (isDate) {
            const minDate = new Date(binData.binMin * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            const maxDate = new Date(binData.binMax * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            return `${minDate} - ${maxDate}<br/>Count: ${binData.count.toLocaleString()}`
          }
          return `Range: ${binData.binMin.toLocaleString()} - ${binData.binMax.toLocaleString()}<br/>Count: ${binData.count.toLocaleString()}`
        },
      },
    }, colorMode)
  }, [data, color, isDate, colorMode])

  if (!data || data.length === 0) return null

  const min = data[0]?.binMin
  const max = data[data.length - 1]?.binMax

  const formatLabel = (value: number) => {
    if (isDate) {
      // Convert epoch back to date string - only month and year for labels
      const date = new Date(value * 1000)
      const month = date.toLocaleDateString('en-US', { month: 'short' })
      const year = date.toLocaleDateString('en-US', { year: '2-digit' })
      return `${month} ${year}`
    }

    // Format numbers with k/M suffix
    const abs = Math.abs(value)
    if (abs >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(1)}M`
    } else if (abs >= 1_000) {
      return `${(value / 1_000).toFixed(1)}k`
    }
    return value.toFixed(0)
  }

  return (
    <Box position="relative">
      <EChart
        option={option}
        style={{ width: '100%', height: `40px`, display: 'flex', justifyContent: 'center' }}
      />
      <HStack justify="space-between" fontSize="3xs" color="fg.subtle" fontFamily="mono" mt={0.5}>
        <Text>{formatLabel(min)}</Text>
        <Text>{formatLabel(max)}</Text>
      </HStack>
    </Box>
  )
}
