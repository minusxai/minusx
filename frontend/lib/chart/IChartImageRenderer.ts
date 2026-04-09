import type { QueryResult } from '@/lib/types'
import type { VizSettings } from '@/lib/types.gen'

export interface ChartInput {
  queryResult: QueryResult
  vizSettings: VizSettings
  titleOverride?: string
}

export interface ChartRenderOptions {
  width: number
  colorMode: 'light' | 'dark'
  addWatermark: boolean
}

export interface RenderedChart {
  label: string
  dataUrl: string
}

export interface IChartImageRenderer {
  renderCharts(inputs: ChartInput[], options: ChartRenderOptions): Promise<RenderedChart[]>
}
