/**
 * Compute the viz-constraint warning for a question, resolving the X-axis column
 * types from the executed query result. This catches type-dependent errors (e.g.
 * "trend charts require a date X axis") that the chart renderer shows but that the
 * structural-only check misses — so the agent gets the signal and can fix the
 * chart instead of finishing with a broken widget.
 *
 * Shared by the EditFile and CreateFile handlers.
 */
import type { VizSettings } from '@/lib/types';
import { selectMergedContent } from '@/store/filesSlice';
import { selectQueryResult } from '@/store/queryResultsSlice';
import { getStore } from '@/store/store';
import { getVizSettingsWarning } from '@/lib/chart/viz-constraints';

export function vizWarningForQuestion(fileId: number): string | null {
  const mc = selectMergedContent(getStore().getState(), fileId) as
    | { vizSettings?: VizSettings; query?: string; connection_name?: string; parameterValues?: Record<string, unknown> }
    | undefined;
  if (!mc) return null;
  const qr =
    mc.query && mc.connection_name
      ? selectQueryResult(getStore().getState(), mc.query, mc.parameterValues ?? {}, mc.connection_name)
      : undefined;
  // The stored result keeps columns/types under `.data` ({ columns, types, rows }).
  const data = qr?.data as { columns?: string[]; types?: string[] } | undefined;
  return getVizSettingsWarning(mc.vizSettings, data?.columns, data?.types);
}
