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

import { renderChartToJpeg } from '@/lib/chart/render-chart'
import type { IChartImageRenderer, ChartInput, ChartRenderOptions, RenderedChart } from './IChartImageRenderer'

// Path that does not exist — renderChartToJpeg skips logo overlay when file not found
const NO_LOGO = '/dev/null/no-logo'

export const serverChartImageRenderer: IChartImageRenderer = {
  async renderCharts(inputs: ChartInput[], options: ChartRenderOptions): Promise<RenderedChart[]> {
    const { width, colorMode, addWatermark, padding } = options
    const height = Math.round(width * 0.5625) // 16:9
    const logoPath = addWatermark ? undefined : NO_LOGO
    const results: RenderedChart[] = []

    for (const { queryResult, vizSettings, titleOverride } of inputs) {
      const buf = await renderChartToJpeg(queryResult, vizSettings, {
        width,
        height,
        colorMode,
        logoPath,
        titleOverride,
        padding,
      })
      if (!buf) continue
      const label = titleOverride ?? vizSettings.type
      results.push({ label, dataUrl: `data:image/jpeg;base64,${buf.toString('base64')}` })
    }

    return results
  },
}
