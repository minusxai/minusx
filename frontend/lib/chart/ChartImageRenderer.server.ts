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
import { resolveImageEnvelope } from '@/lib/viz/from-vizsettings'
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
      // Vega-only rendering (retirement stage 2): a V2 `viz` renders directly; legacy
      // `vizSettings` converts through the SAME bridge as the on-screen chart, so images
      // match what users see. ECharts remains only as a crash fallback until stage 4.
      let buf: Buffer | null = null
      let label = titleOverride
      const envelope = resolveImageEnvelope({
        viz, vizSettings, columns: queryResult.columns, types: queryResult.types,
      })
      if (envelope) {
        try {
          buf = await renderVizEnvelopeToJpeg(envelope, queryResult.rows, {
            width, height: getChartHeight(getEnvelopeVizType(envelope) ?? 'bar', width), colorMode, padding, logoPath,
          })
          label = label ?? getEnvelopeVizType(envelope) ?? 'chart'
        } catch (e) {
          console.error('[ChartImageRenderer] vega render failed, falling back to echarts:', e)
        }
      }
      if (!buf && !viz && vizSettings) {
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
