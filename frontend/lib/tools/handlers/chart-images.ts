/**
 * Render chart images for question files and upload to S3.
 * Returns image_url content blocks (OpenAI format — LiteLLM converts to Anthropic).
 * Browser-only. Never throws — returns [] on any failure.
 *
 * Shared by the ReadFiles and EditFile handlers.
 */
import type { AugmentedFile, VizSettings } from '@/lib/types';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';
import { clientChartImageRenderer } from '@/lib/chart/ChartImageRenderer.client';
import { renderEnvelopeImageDataUrl } from '@/lib/chart/VizImageRenderer.client';
import { RENDERABLE_CHART_TYPES } from '@/lib/chart/render-chart-svg';
import { isEnvelopeImageViz } from '@/lib/viz/encoding-edit';
import { uploadChartOrEmbed } from '@/lib/chart/chart-attachments';

/** Cap on chart images rendered per tool call (main-thread render + 2 uploads each). */
const MAX_CHART_IMAGE_BLOCKS = 8;

/** A deferred single-chart render → JPEG object URL (V2 Vega or legacy ECharts). */
type ImageThunk = () => Promise<string | null>;

export async function renderFileChartImageBlocks(
  files: AugmentedFile[],
): Promise<{ type: 'image_url'; image_url: { url: string } }[]> {
  if (typeof document === 'undefined') return [];
  const colorMode: 'light' | 'dark' =
    document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';

  const thunks: ImageThunk[] = [];
  for (const f of files) {
    const content = f.fileState.content as { viz?: VizEnvelope; vizSettings?: VizSettings } | undefined;
    const qr = f.queryResults?.[0];
    // Need actual rows to render — an empty/errored result yields no chart, so skip it
    // here rather than emit a blank image block.
    if (!qr || !qr.rows?.length) continue;

    // A V2 `viz` envelope is authoritative: render its chart through Vega (canvas → JPEG).
    if (content?.viz && isEnvelopeImageViz(content.viz)) {
      const viz = content.viz;
      thunks.push(() => renderEnvelopeImageDataUrl(viz, qr.rows, { width: 512, colorMode, addWatermark: false, padding: false }));
    } else if (content?.vizSettings && RENDERABLE_CHART_TYPES.has(content.vizSettings.type)) {
      // Legacy V1 question (no envelope) — the ECharts renderer, unchanged.
      const vizSettings = content.vizSettings;
      const titleOverride = f.fileState.name;
      thunks.push(async () => {
        const [r] = await clientChartImageRenderer.renderCharts(
          [{ queryResult: qr, vizSettings, titleOverride }],
          { width: 512, colorMode, addWatermark: false, padding: false },
        );
        return r?.dataUrl ?? null;
      });
    }
  }

  // Each render is main-thread work plus two upload round-trips; uncapped, a wide ReadFiles
  // (20+ questions) freezes the tab and stalls the turn on uploads.
  const capped = thunks.slice(0, MAX_CHART_IMAGE_BLOCKS);
  if (capped.length === 0) return [];

  try {
    const dataUrls = await Promise.all(capped.map(t => t().catch(() => null)));
    const blocks = await Promise.all(
      dataUrls.map(async url => {
        if (!url) return null;
        return { type: 'image_url' as const, image_url: { url: await uploadChartOrEmbed(url) } };
      })
    );
    return blocks.filter(Boolean) as { type: 'image_url'; image_url: { url: string } }[];
  } catch {
    return [];
  }
}
