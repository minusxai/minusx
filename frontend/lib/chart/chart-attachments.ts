/**
 * Image upload helper for tool-rendered chart images.
 *
 * The old per-chart app-state attachment pipeline (buildChartAttachments + its render/cache
 * machinery) was removed: app state now carries a SINGLE screenshot of the rendered file in its
 * image facet, captured at send time in ChatInterface and diffed across turns by the projection
 * pass (see `lib/projection`). The one piece still needed is the upload helper below, used by the
 * Screenshot / ReadFiles-style chart-image rendering in the tool handlers.
 *
 * Browser-only — safe to import only from 'use client' components / frontend-bridged tools.
 */
import { uploadBlobOrEmbed } from '@/lib/object-store/client';
import { RENDERABLE_CHART_TYPES } from '@/lib/chart/renderable-types';
import type { AppState } from '@/lib/appState';
import type { QueryResult as ReduxQueryResult } from '@/store/queryResultsSlice';
import type { VizSettings } from '@/lib/validation/atlas-schemas';

/**
 * Upload a rendered chart JPEG (given as a data URL) to the object store and return the public
 * URL, OR — when the local filesystem adapter is active — return the data URL as-is so the Claude
 * API can receive the image directly. Local FS URLs (/api/object-store/serve/…) are auth-gated
 * localhost routes the Claude API cannot reach; the data URL avoids the round-trip entirely.
 */
export async function uploadChartOrEmbed(dataUrl: string): Promise<string> {
  const blob = await fetch(dataUrl).then(r => r.blob());
  return uploadBlobOrEmbed(blob, 'chart.jpg', 'image/jpeg');
}

type ChartEntry = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  queryResult: any;
  vizSettings: VizSettings;
  titleOverride?: string;
  queryResultId?: string;
  updatedAt?: number;
};

/**
 * Extract renderable chart entries (question → one, dashboard → one per chart) from app state.
 * Production app-state images are now a single file screenshot (see ChatInterface); this helper
 * is retained only for the DevTools "Agent Image" per-chart preview.
 */
export function extractChartEntries(
  appState: AppState | null | undefined,
  queryResultsMap: Record<string, ReduxQueryResult>,
): ChartEntry[] {
  if (appState?.type !== 'file') return [];
  const { fileState, references } = appState.state;

  if (fileState.type === 'question') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vizSettings = (fileState.content as any)?.vizSettings as VizSettings | undefined;
    const queryResultId = fileState.queryResultId;
    const qr = queryResultId ? queryResultsMap[queryResultId] : undefined;
    const queryResult = qr?.data;
    if (!vizSettings || !queryResult || !RENDERABLE_CHART_TYPES.has(vizSettings.type)) return [];
    return [{ queryResult, vizSettings, titleOverride: fileState.name || undefined, queryResultId, updatedAt: qr?.updatedAt }];
  }

  if (fileState.type === 'dashboard') {
    return (references ?? []).flatMap(ref => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const vizSettings = (ref.content as any)?.vizSettings as VizSettings | undefined;
      const queryResultId = ref.queryResultId;
      const qr = queryResultId ? queryResultsMap[queryResultId] : undefined;
      const queryResult = qr?.data;
      if (!vizSettings || !queryResult || !RENDERABLE_CHART_TYPES.has(vizSettings.type)) return [];
      return [{ queryResult, vizSettings, titleOverride: ref.name || undefined, queryResultId, updatedAt: qr?.updatedAt }] as ChartEntry[];
    });
  }

  return [];
}
