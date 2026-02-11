import { BaseChart } from './BaseChart'
import type { ChartProps } from '@/lib/chart/chart-utils'

export const LinePlot = (props: ChartProps) => {
  return <BaseChart {...props} chartType="line" emptyMessage="No data available for line plot" />
}
