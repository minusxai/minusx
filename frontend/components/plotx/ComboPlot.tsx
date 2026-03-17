import { BaseChart } from './BaseChart'
import type { ChartProps } from '@/lib/chart/chart-utils'

export const ComboPlot = (props: ChartProps) => {
  return <BaseChart {...props} chartType="combo" emptyMessage="No data available for combo chart" />
}
