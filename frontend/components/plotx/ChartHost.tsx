import { memo, type ReactNode, type RefObject } from 'react'
import { Box } from '@chakra-ui/react'
import type { EChartsOption } from 'echarts'
import type { EChartsType } from 'echarts/core'
import { E2E_MODE } from '@/lib/constants'
import { EChart } from './EChart'

// Production renders to canvas (perf). E2E builds render to SVG so charts are
// real DOM nodes Playwright can assert on (Tests/QA/Evals Arch V2). To make SVG
// the production default later, change this to a literal 'svg' — large-data
// charts would then need a per-chart canvas override.
const DEFAULT_CHART_SETTINGS = {
  useCoarsePointer: true,
  renderer: (E2E_MODE ? 'svg' : 'canvas') as 'svg' | 'canvas',
}

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

const ChartHostInner = ({
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

// memo with the default referential comparator: once the upstream `option`,
// `events`, and `onChartUpdate` are stable (via BaseChart's useDeepStable +
// ref-pattern callback), unrelated parent re-renders skip this subtree
// entirely. Pre-fix, ChartHost was flagged as 100% wasted (40/40 renders).
export const ChartHost = memo(ChartHostInner)
