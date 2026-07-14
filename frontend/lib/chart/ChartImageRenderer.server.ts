/**
 * Server-side chart image renderer.
 *
 * Renders charts using ECharts SSR (SVG → Resvg → Sharp JPEG). Works for
 * the same chart types as the client renderer, but runs in Node.js only.
 *
 * Node.js only — not safe for browser bundles.
 * For browser-side rendering, use ChartImageRenderer.client.ts.
 */
import 'server-only'

import path from 'path'
import { renderChartToJpeg } from '@/lib/chart/render-chart'
import { renderVizEnvelopeToJpeg } from '@/lib/chart/render-viz-image'
import { getChartHeight } from '@/lib/chart/render-chart-svg'
import { getEnvelopeVizType } from '@/lib/viz/encoding-edit'
import type { IChartImageRenderer, ChartInput, ChartRenderOptions, RenderedChart } from './IChartImageRenderer'

// Path that does not exist — renderChartToJpeg skips logo overlay when file not found
const NO_LOGO = '/dev/null/no-logo'

export const serverChartImageRenderer: IChartImageRenderer = {
  async renderCharts(inputs: ChartInput[], options: ChartRenderOptions): Promise<RenderedChart[]> {
    const { width, colorMode, addWatermark, padding, logoSrc } = options
    // logoSrc is a public-relative URL (e.g. "/static/logo.svg"); resolve to a file under public/.
    // Omitted → renderChartToJpeg uses the default brand mark; watermark off → NO_LOGO sentinel.
    const logoPath = addWatermark
      ? (logoSrc ? path.join(process.cwd(), 'public', logoSrc.replace(/^\//, '')) : undefined)
      : NO_LOGO
    const results: RenderedChart[] = []

    for (const { queryResult, vizSettings, viz, titleOverride } of inputs) {
      // V2 `viz` envelope → the Vega pipeline; legacy `vizSettings` → the ECharts pipeline.
      let buf: Buffer | null = null
      let label = titleOverride
      if (viz) {
        buf = await renderVizEnvelopeToJpeg(viz, queryResult.rows, {
          width, height: getChartHeight(getEnvelopeVizType(viz) ?? 'bar', width), colorMode, padding, logoPath,
        })
        label = label ?? getEnvelopeVizType(viz) ?? 'chart'
      } else if (vizSettings) {
        buf = await renderChartToJpeg(queryResult, vizSettings, {
          width, height: getChartHeight(vizSettings.type, width), colorMode, logoPath, titleOverride, padding,
        })
        label = label ?? vizSettings.type
      }
      if (!buf) continue
      results.push({ label: label ?? 'chart', dataUrl: `data:image/jpeg;base64,${buf.toString('base64')}` })
    }

    return results
  },
}
