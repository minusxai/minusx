/**
 * Render chart images for question files and upload to S3.
 * Returns image_url content blocks (OpenAI format — LiteLLM converts to Anthropic).
 * Browser-only. Never throws — returns [] on any failure.
 *
 * Shared by the ReadFiles and EditFile handlers.
 */
import type { AugmentedFile, VizSettings } from '@/lib/types';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';
import { renderEnvelopeImageDataUrl } from '@/lib/chart/VizImageRenderer.client';
import { resolveImageEnvelope } from '@/lib/viz/from-vizsettings';
import { uploadChartOrEmbed } from '@/lib/chart/chart-attachments';

/** Cap on chart images rendered per tool call (main-thread render + 2 uploads each). */
const MAX_CHART_IMAGE_BLOCKS = 8;

/** A deferred single-chart render → JPEG object URL (always the Vega pipeline —
 *  legacy vizSettings convert through the same bridge as the on-screen chart). */
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

    // One pipeline (retirement stage 2): a V2 `viz` renders directly; a legacy
    // vizSettings chart converts through the same bridge as the on-screen chart.
    const envelope = resolveImageEnvelope({
      viz: content?.viz, vizSettings: content?.vizSettings, columns: qr.columns, types: qr.types,
    });
    if (envelope) {
      thunks.push(() => renderEnvelopeImageDataUrl(envelope, qr.rows, { width: 512, colorMode, addWatermark: false, padding: false }));
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
