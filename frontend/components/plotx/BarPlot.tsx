import { BaseChart } from './BaseChart'
import type { ChartProps } from '@/lib/chart/chart-utils'

export const BarPlot = (props: ChartProps) => {
  return <BaseChart {...props} chartType="bar" emptyMessage="No data available for bar chart" />
}
