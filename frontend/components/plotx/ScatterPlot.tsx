import { BaseChart } from './BaseChart'
import type { ChartProps } from '@/lib/chart/chart-utils'

export const ScatterPlot = (props: ChartProps) => {
  return <BaseChart {...props} chartType="scatter" emptyMessage="No data available for scatter plot" />
}
