import type { QueryResult } from '@/lib/types'
import type { VizSettings, VizEnvelope } from '@/lib/validation/atlas-schemas'

export interface ChartInput {
  queryResult: QueryResult
  /** Legacy V1 chart settings. Omit when a V2 `viz` envelope is supplied. */
  vizSettings?: VizSettings
  /** V2 viz envelope (preferred). Rendered via the Vega pipeline when present. */
  viz?: VizEnvelope
  titleOverride?: string
}

export interface ChartRenderOptions {
  width: number
  colorMode: 'light' | 'dark'
  addWatermark: boolean
  /** When true, adds a bottom strip equal to the watermark height so the logo
   *  sits inside the strip rather than overlapping chart content. */
  padding?: boolean
  /** Watermark logo URL (already resolved for the given colorMode). Falls back to the
   *  default brand mark when omitted. */
  logoSrc?: string
}

export interface RenderedChart {
  label: string
  dataUrl: string
}

export interface IChartImageRenderer {
  renderCharts(inputs: ChartInput[], options: ChartRenderOptions): Promise<RenderedChart[]>
}
