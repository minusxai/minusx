/**
 * Chart → attachment pipeline with caching.
 *
 * S3 configured  → renders chart, uploads to S3, caches the public URL.
 * Local FS (dev) → renders chart, embeds as base64 data URL (localhost URLs are
 *                  inaccessible to the Claude API, so we skip the upload entirely).
 *
 * On subsequent sends with the same data: returns the cached value instantly.
 *
 * Cache key: queryResultId | updatedAt | vizSettings | titleOverride | colorMode
 * updatedAt invalidates the cache when the user re-runs a query.
 *
 * Browser-only — safe to import only from 'use client' components.
 */
import { clientChartImageRenderer } from '@/lib/chart/ChartImageRenderer.client';
import { IS_DEV } from '@/lib/constants';
import { RENDERABLE_CHART_TYPES } from '@/lib/chart/render-chart-svg';
import type { AppState } from '@/lib/appState';
import type { Attachment } from '@/lib/types';
import type { QueryResult as ReduxQueryResult } from '@/store/queryResultsSlice';
import type { VizSettings } from '@/lib/types.gen';

// S3 URL cache — per browser tab (single user). Safe: this module is only ever imported
// from 'use client' components, so it never runs in the server-side Node.js process.
// eslint-disable-next-line no-restricted-syntax
const chartUrlCache = new Map<string, string>(); // cacheKey → S3 public URL

/** Clears the cache. Exposed for test isolation only. */
export function clearChartCaches(): void {
  chartUrlCache.clear();
}

export function buildChartCacheKey(
  queryResultId: string | undefined,
  updatedAt: number | undefined,
  vizSettings: VizSettings,
  titleOverride: string | undefined,
  colorMode: 'light' | 'dark',
): string {
  return `${queryResultId ?? ''}|${updatedAt ?? 0}|${JSON.stringify(vizSettings)}|${titleOverride ?? ''}|${colorMode}`;
}

type ChartEntry = {
  queryResult: any;
  vizSettings: VizSettings;
  titleOverride?: string;
  queryResultId?: string;
  updatedAt?: number;
};

export function extractChartEntries(
  appState: AppState | null | undefined,
  queryResultsMap: Record<string, ReduxQueryResult>,
): ChartEntry[] {
  if (appState?.type !== 'file') return [];
  const { fileState, references } = appState.state;

  if (fileState.type === 'question') {
    const vizSettings = (fileState.content as any)?.vizSettings as VizSettings | undefined;
    const queryResultId = (fileState as any).queryResultId as string | undefined;
    const qr = queryResultId ? queryResultsMap[queryResultId] : undefined;
    const queryResult = qr?.data;
    if (!vizSettings || !queryResult || !RENDERABLE_CHART_TYPES.has(vizSettings.type)) return [];
    return [{ queryResult, vizSettings, titleOverride: fileState.name || undefined, queryResultId, updatedAt: qr?.updatedAt }];
  }

  if (fileState.type === 'dashboard') {
    return (references ?? []).flatMap(ref => {
      const vizSettings = (ref.content as any)?.vizSettings as VizSettings | undefined;
      const queryResultId = (ref as any).queryResultId as string | undefined;
      const qr = queryResultId ? queryResultsMap[queryResultId] : undefined;
      const queryResult = qr?.data;
      if (!vizSettings || !queryResult || !RENDERABLE_CHART_TYPES.has(vizSettings.type)) return [];
      return [{ queryResult, vizSettings, titleOverride: ref.name || undefined, queryResultId, updatedAt: qr?.updatedAt }] as ChartEntry[];
    });
  }

  return [];
}

/**
 * Upload a rendered chart JPEG (given as a data URL) to the object store and
 * return the public URL, OR — when the local filesystem adapter is active —
 * return the data URL as-is so the Claude API can receive the image directly.
 *
 * Local FS URLs (/api/object-store/serve/…) are auth-gated localhost routes
 * that the Claude API cannot reach. The data URL avoids the round-trip entirely.
 */
async function uploadChartOrEmbed(dataUrl: string): Promise<string> {
  const params = new URLSearchParams({ filename: 'chart.jpg', contentType: 'image/jpeg', keyType: 'charts' });
  const res = await fetch(`/api/object-store/upload-url?${params}`);
  if (!res.ok) throw new Error(`Failed to get upload URL (${res.status})`);
  const { uploadUrl, publicUrl } = (await res.json()) as { uploadUrl: string; publicUrl: string };

  // Local filesystem adapter in dev: LLM can't reach localhost, so embed as base64 data URL.
  // The renderer returns a blob: URL — fetch it and convert to a proper data: URL.
  // In production, build an absolute URL so the LLM can fetch it from the real domain.
  if (uploadUrl.startsWith('/api/object-store/local-upload')) {
    if (IS_DEV) {
      const blob = await fetch(dataUrl).then(r => r.blob());
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }
    // Upload, then return absolute URL using the current origin.
    const blob = await fetch(dataUrl).then(r => r.blob());
    const putRes = await fetch(uploadUrl, { method: 'PUT', body: blob, headers: { 'Content-Type': 'image/jpeg' } });
    if (!putRes.ok) throw new Error(`Chart upload failed (${putRes.status})`);
    return `${window.location.origin}${publicUrl}`;
  }

  // S3 (or any real object store): upload and return the public URL.
  const blob = await fetch(dataUrl).then(r => r.blob());
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    body: blob,
    headers: { 'Content-Type': 'image/jpeg' },
  });
  if (!putRes.ok) throw new Error(`Chart upload failed (${putRes.status})`);
  return publicUrl;
}

/**
 * Render chart images for the current page and upload to S3.
 *
 * Question → one attachment. Dashboard → one per renderable chart.
 * Cached by (queryResultId, updatedAt, vizSettings, titleOverride, colorMode) —
 * subsequent sends with unchanged data return the cached S3 URL instantly.
 *
 * Returns [] for non-chart pages (explore, folder, table, pivot).
 * Never throws — failure must never block the user from sending.
 */
export async function buildChartAttachments(
  appState: AppState | null | undefined,
  queryResultsMap: Record<string, ReduxQueryResult>,
  colorMode: 'light' | 'dark',
): Promise<Attachment[]> {
  const entries = extractChartEntries(appState, queryResultsMap);
  if (entries.length === 0) return [];

  try {
    const attachments = await Promise.all(
      entries.map(async ({ queryResult, vizSettings, titleOverride, queryResultId, updatedAt }) => {
        const cacheKey = buildChartCacheKey(queryResultId, updatedAt, vizSettings, titleOverride, colorMode);

        const cachedUrl = chartUrlCache.get(cacheKey);
        if (cachedUrl) {
          return { type: 'image' as const, name: titleOverride || 'chart.jpg', content: cachedUrl, metadata: { auto: true } };
        }

        const [rendered] = await clientChartImageRenderer.renderCharts(
          [{ queryResult, vizSettings, titleOverride }],
          { width: 512, colorMode, addWatermark: false, padding: false },
        );
        if (!rendered) return null;

        const imageContent = await uploadChartOrEmbed(rendered.dataUrl);
        chartUrlCache.set(cacheKey, imageContent);
        return { type: 'image' as const, name: titleOverride || 'chart.jpg', content: imageContent, metadata: { auto: true } };
      })
    );
    return attachments.filter(a => a !== null) as Attachment[];
  } catch {
    return [];
  }
}
