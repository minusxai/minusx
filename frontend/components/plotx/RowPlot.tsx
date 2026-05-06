import { BaseChart } from './BaseChart'
import type { ChartProps } from '@/lib/chart/chart-utils'

export const RowPlot = (props: ChartProps) => {
  return <BaseChart {...props} chartType="row" emptyMessage="No data available for row chart" />
}
