import type { ReactNode, RefObject } from 'react'
import { Box } from '@chakra-ui/react'
import type { EChartsOption } from 'echarts'
import type { EChartsType } from 'echarts/core'
import { EChart } from './EChart'

export const DEFAULT_CHART_SETTINGS = { useCoarsePointer: true, renderer: 'canvas' as const }

const DEFAULT_CHART_STYLE = { width: '100%', height: '100%', minHeight: '300px' } as const

interface ChartHostProps {
  containerRef: RefObject<HTMLDivElement | null>
  height?: number | string
  option: EChartsOption
  events?: Record<string, (param: any) => void>
  onChartUpdate?: (chart: EChartsType) => void
  chartKey?: string
  children?: ReactNode
}

export const ChartHost = ({
  containerRef,
  height,
  option,
  events,
  onChartUpdate,
  chartKey,
  children,
}: ChartHostProps) => {
  return (
    <Box
      ref={containerRef}
      width="100%"
      height={height || '100%'}
      flex="1"
      minHeight="300px"
      overflow="visible"
      position="relative"
    >
      {children}
      <EChart
        key={chartKey}
        option={option}
        style={DEFAULT_CHART_STYLE}
        chartSettings={DEFAULT_CHART_SETTINGS}
        events={events}
        onChartUpdate={onChartUpdate}
      />
    </Box>
  )
}
