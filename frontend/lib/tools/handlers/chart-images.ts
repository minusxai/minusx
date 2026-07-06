/**
 * Render chart images for question files and upload to S3.
 * Returns image_url content blocks (OpenAI format — LiteLLM converts to Anthropic).
 * Browser-only. Never throws — returns [] on any failure.
 *
 * Shared by the ReadFiles and EditFile handlers.
 */
import type { AugmentedFile } from '@/lib/types';
import { clientChartImageRenderer } from '@/lib/chart/ChartImageRenderer.client';
import { RENDERABLE_CHART_TYPES } from '@/lib/chart/render-chart-svg';
import { uploadChartOrEmbed } from '@/lib/chart/chart-attachments';

/** Cap on chart images rendered per tool call (main-thread ECharts render + 2 uploads each). */
const MAX_CHART_IMAGE_BLOCKS = 8;

export async function renderFileChartImageBlocks(
  files: AugmentedFile[],
): Promise<{ type: 'image_url'; image_url: { url: string } }[]> {
  if (typeof document === 'undefined') return [];
  const colorMode: 'light' | 'dark' =
    document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';

  const entries = files.flatMap(f => {
    const vizType = (f.fileState.content as any)?.vizSettings?.type;
    const qr = f.queryResults?.[0];
    // Need actual rows to render — an empty/errored result yields no chart (the renderer returns
    // null), so skip it here rather than emit a blank image block.
    if (!qr || !qr.rows?.length || !RENDERABLE_CHART_TYPES.has(vizType)) return [];
    return [{ queryResult: qr, vizSettings: (f.fileState.content as any).vizSettings, titleOverride: f.fileState.name }];
  })
    // Each render is synchronous main-thread ECharts work plus two upload round-trips; uncapped, a
    // wide ReadFiles (20+ questions) freezes the tab for seconds and stalls the turn on uploads.
    .slice(0, MAX_CHART_IMAGE_BLOCKS);
  if (entries.length === 0) return [];

  try {
    const rendered = await clientChartImageRenderer.renderCharts(entries, {
      width: 512, colorMode, addWatermark: false, padding: false,
    });
    const blocks = await Promise.all(
      rendered.map(async r => {
        if (!r) return null;
        const url = await uploadChartOrEmbed(r.dataUrl);
        return { type: 'image_url' as const, image_url: { url } };
      })
    );
    return blocks.filter(Boolean) as { type: 'image_url'; image_url: { url: string } }[];
  } catch {
    return [];
  }
}
