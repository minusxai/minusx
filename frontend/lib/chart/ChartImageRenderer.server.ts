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
import { renderVizEnvelopeToJpeg } from '@/lib/chart/render-viz-image'
import { getChartHeight } from '@/lib/chart/renderable-types'
import { getEnvelopeVizType } from '@/lib/viz/encoding-edit'
import { resolveImageEnvelope } from '@/lib/viz/from-vizsettings'
import type { IChartImageRenderer, ChartInput, ChartRenderOptions, RenderedChart } from './IChartImageRenderer'

// Path that does not exist — the JPEG encoder skips the logo overlay when the file is absent
const NO_LOGO = '/dev/null/no-logo'

export const serverChartImageRenderer: IChartImageRenderer = {
  async renderCharts(inputs: ChartInput[], options: ChartRenderOptions): Promise<RenderedChart[]> {
    const { width, colorMode, addWatermark, padding, logoSrc } = options
    // logoSrc is a public-relative URL (e.g. "/static/logo.svg"); resolve to a file under public/.
    // Omitted → the default brand mark; watermark off → NO_LOGO sentinel.
    const logoPath = addWatermark
      ? (logoSrc ? path.join(process.cwd(), 'public', logoSrc.replace(/^\//, '')) : undefined)
      : NO_LOGO
    const results: RenderedChart[] = []

    for (const { queryResult, vizSettings, viz, titleOverride } of inputs) {
      // Vega-only rendering: a V2 `viz` renders directly; legacy `vizSettings` converts
      // through the SAME bridge as the on-screen chart, so images match what users see.
      // (Renderer_v2 Phase 2: the ECharts crash-fallback is deleted.)
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
          // Render-only path: a failed chart is SKIPPED, never a crash (the ECharts
          // fallback is deleted — Renderer_v2 Phase 2; the bridge is the only renderer).
          console.error('[ChartImageRenderer] vega render failed, skipping chart:', e)
        }
      }
      if (!buf) continue
      results.push({ label: label ?? 'chart', dataUrl: `data:image/jpeg;base64,${buf.toString('base64')}` })
    }

    return results
  },
}
