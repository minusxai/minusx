/**
 * Chart → S3 attachment pipeline with a two-level cache.
 *
 * Level 1 — render cache (dataUrl): populated by prewarmChartDataUrls() on data load.
 *   Renders charts to data URLs in a hidden canvas — no S3 upload.
 *   Nothing is wasted when the user never sends a message.
 *
 * Level 2 — upload cache (S3 publicUrl): populated on first buildChartAttachments() call.
 *   Subsequent sends with the same data skip both render and upload (instant).
 *
 * Cache key: queryResultId | updatedAt | vizSettings | titleOverride | colorMode
 * updatedAt invalidates entries when the user re-runs a query.
 *
 * Browser-only — safe to import only from 'use client' components.
 */
import { clientChartImageRenderer } from '@/lib/chart/ChartImageRenderer.client';
import { RENDERABLE_CHART_TYPES } from '@/lib/chart/render-chart-svg';
import { uploadFile } from '@/lib/object-store/client';
import type { AppState } from '@/lib/appState';
import type { Attachment } from '@/lib/types';
import type { QueryResult as ReduxQueryResult } from '@/store/queryResultsSlice';
import type { VizSettings } from '@/lib/types.gen';

// Module-level caches — per browser tab (single user). Safe: this module is only ever
// imported from 'use client' components, so it never runs in the server-side Node.js process.
// eslint-disable-next-line no-restricted-syntax
const chartDataUrlCache = new Map<string, string>(); // cacheKey → rendered data URL
// eslint-disable-next-line no-restricted-syntax
const chartUrlCache = new Map<string, string>();     // cacheKey → S3 public URL

/** Resets both cache levels. Exposed for test isolation only. */
export function clearChartCaches(): void {
  chartDataUrlCache.clear();
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
 * Pre-warm level 1: render charts to data URLs in the background.
 * No S3 upload — safe to call on every page load / data refresh.
 * Never throws.
 */
export async function prewarmChartDataUrls(
  appState: AppState | null | undefined,
  queryResultsMap: Record<string, ReduxQueryResult>,
  colorMode: 'light' | 'dark',
): Promise<void> {
  const entries = extractChartEntries(appState, queryResultsMap);
  if (entries.length === 0) return;

  await Promise.all(
    entries.map(async ({ queryResult, vizSettings, titleOverride, queryResultId, updatedAt }) => {
      const cacheKey = buildChartCacheKey(queryResultId, updatedAt, vizSettings, titleOverride, colorMode);
      if (chartDataUrlCache.has(cacheKey) || chartUrlCache.has(cacheKey)) return;

      const [rendered] = await clientChartImageRenderer.renderCharts(
        [{ queryResult, vizSettings, titleOverride }],
        { width: 512, colorMode, addWatermark: false },
      );
      if (rendered) chartDataUrlCache.set(cacheKey, rendered.dataUrl);
    })
  );
}

/**
 * Build S3-uploaded image attachments for the current page's charts.
 *
 * Cache lookup order:
 *   1. S3 URL cache (instant — no network)
 *   2. Data URL cache (upload only — no render step)
 *   3. Cold start (render + upload)
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

        // Level 2: already uploaded — instant.
        const cachedUrl = chartUrlCache.get(cacheKey);
        if (cachedUrl) {
          return { type: 'image' as const, name: titleOverride || 'chart.jpg', content: cachedUrl, metadata: { auto: true } };
        }

        // Level 1: rendered data URL — upload only.
        let dataUrl = chartDataUrlCache.get(cacheKey);

        if (!dataUrl) {
          // Cold start: render then upload.
          const [rendered] = await clientChartImageRenderer.renderCharts(
            [{ queryResult, vizSettings, titleOverride }],
            { width: 512, colorMode, addWatermark: false },
          );
          if (!rendered) return null;
          dataUrl = rendered.dataUrl;
        }

        const blob = await fetch(dataUrl).then(res => res.blob());
        const file = new File([blob], 'chart.jpg', { type: 'image/jpeg' });
        const { publicUrl } = await uploadFile(file, undefined, { keyType: 'charts' });
        chartUrlCache.set(cacheKey, publicUrl);
        chartDataUrlCache.delete(cacheKey); // promoted to level 2
        return { type: 'image' as const, name: titleOverride || 'chart.jpg', content: publicUrl, metadata: { auto: true } };
      })
    );
    return attachments.filter(a => a !== null) as Attachment[];
  } catch {
    return [];
  }
}
