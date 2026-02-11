import { BaseChart } from './BaseChart'
import type { ChartProps } from '@/lib/chart/chart-utils'

export const AreaPlot = (props: ChartProps) => {
  return <BaseChart {...props} chartType="area" emptyMessage="No data available for area chart" />
}
