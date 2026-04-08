/**
 * Client-side chart → JPEG → S3 helper.
 *
 * Renders a chart to SVG using ECharts SSR mode (no DOM needed, works in browser),
 * converts to JPEG blob via Canvas API, uploads to S3 via the presigned URL flow,
 * and returns the public URL.
 *
 * Used by ChatInterface to attach chart images as vision context for Claude.
 */

import { renderChartToSvg } from './render-chart-svg';
import { uploadFile } from '@/lib/object-store/client';
import type { QueryResult } from '@/lib/types';
import type { VizSettings } from '@/lib/types.gen';

const CHART_WIDTH = 800;
const CHART_HEIGHT = 400;
const JPEG_QUALITY = 0.85;

/**
 * Convert an SVG string to a JPEG Blob via Canvas API.
 * Browser-only — requires document and HTMLCanvasElement.
 */
function svgToJpegBlob(svg: string, width: number, height: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const svgBlob = new Blob([svg], { type: 'image/svg+xml' });
    const objectUrl = URL.createObjectURL(svgBlob);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas 2D context unavailable'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Canvas toBlob failed'))),
        'image/jpeg',
        JPEG_QUALITY,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load SVG into Image'));
    };

    img.src = objectUrl;
  });
}

// eslint-disable-next-line no-restricted-syntax -- intentional per-user cache: keys include queryResult.id (which encodes query+params+database, scoped per company/tenant). Avoids re-uploading the same chart on every message send.
const chartUrlCache = new Map<string, string | null>();

function cacheKey(queryResult: QueryResult, vizSettings: VizSettings): string {
  return [
    queryResult.id ?? '',
    vizSettings.type,
    (vizSettings.xCols ?? []).join(','),
    (vizSettings.yCols ?? []).join(','),
  ].join(':');
}

/**
 * Render a chart to JPEG, upload to S3, and return the public URL.
 *
 * Returns null for unsupported viz types (table, pivot) or empty data.
 * Results are cached by queryResult.id + viz axes — re-sending the same
 * chart with the same data will not trigger a second upload.
 *
 * @param queryResult  Full QueryResult with rows (from Redux queryResults store)
 * @param vizSettings  Current visualization settings
 * @param colorMode    'dark' (default) or 'light'
 */
export async function getChartImageUrl(
  queryResult: QueryResult,
  vizSettings: VizSettings,
  colorMode: 'light' | 'dark' = 'dark',
): Promise<string | null> {
  const key = cacheKey(queryResult, vizSettings);

  if (chartUrlCache.has(key)) {
    return chartUrlCache.get(key)!;
  }

  const svg = renderChartToSvg(queryResult, vizSettings, {
    width: CHART_WIDTH,
    height: CHART_HEIGHT,
    colorMode,
  });

  if (!svg) {
    chartUrlCache.set(key, null);
    return null;
  }

  const blob = await svgToJpegBlob(svg, CHART_WIDTH, CHART_HEIGHT);
  const file = new File([blob], 'chart.jpg', { type: 'image/jpeg' });

  // Pass keyType=charts so the server puts the object under the charts/ prefix
  const { publicUrl } = await uploadFile(file, undefined, { keyType: 'charts' });

  chartUrlCache.set(key, publicUrl);
  return publicUrl;
}
