import { useMemo } from 'react'
import { useAppSelector } from '@/store/hooks'
import { EChart } from './EChart'
import { withAtlasTheme } from '@/lib/chart/echarts-theme'

interface MiniBarChartProps {
  data: Array<{ value: string; count: number }>
  totalUnique: number
  color?: string
  height?: number
}

export const MiniBarChart = ({
  data,
  totalUnique,
  color = '#f39c12',
}: MiniBarChartProps) => {
  const colorMode = useAppSelector((state) => state.ui.colorMode)

  const option = useMemo(() => {
    if (!data || data.length === 0) return {}

    const remaining = totalUnique - data.length

    return withAtlasTheme({
      grid: {
        left: 0,
        right: 0,
        top: 0,
        bottom: remaining > 0 ? 15 : 0,
        containLabel: true,
      },
      xAxis: {
        type: 'value' as const,
        show: false,
      },
      yAxis: {
        type: 'category' as const,
        data: data.map(d => d.value),
        axisLabel: {
          fontSize: 9,
          width: 60,
          overflow: 'truncate' as const,
        },
        axisTick: {
          show: false,
        },
        axisLine: {
          show: false,
        },
      },
      series: [
        {
          type: 'bar' as const,
          data: data.map(d => d.count),
          itemStyle: {
            color: color,
            borderRadius: [0, 2, 2, 0],
          },
          barWidth: '70%',
          animation: false,
          label: {
            show: false,
          },
        },
      ],
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'shadow',
        },
        extraCssText: 'z-index: 9999;',
        confine: true,
        formatter: (params: any) => {
          const param = params[0]
          return `${param.name}<br/>Count: ${param.value.toLocaleString()}`
        },
      },
    }, colorMode)
  }, [data, color, totalUnique, colorMode])

  if (!data || data.length === 0) return null

  return (
    <EChart
      option={option}
      style={{ width: '100%', height: `75px`, display: 'flex', justifyContent: 'center' }}
    />
  )
}
