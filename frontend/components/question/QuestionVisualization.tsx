'use client';

/**
 * Question Visualization Component
 * Displays query results with multiple visualization types
 */

import { LuRocket, LuWrench, LuCode, LuRefreshCw, LuCloudOff } from 'react-icons/lu';
import dynamic from 'next/dynamic';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/kit/tooltip';
import { TableV2 } from '@/components/plotx/TableV2';
import { VizTableView } from '@/components/viz/VizTableView';
import { VizPivotView } from '@/components/viz/VizPivotView';
import { parseErrorMessage } from '@/components/question/error-parser';
import type { QuestionContent, QueryResult, VizSettings, PivotConfig, ColumnFormatConfig, VisualizationStyleConfig, ChartAnnotation } from '@/lib/types';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';
import { memo, useMemo, useState, useEffect, useRef } from 'react';
import isEqual from 'lodash/isEqual';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { setRightSidebarCollapsed, setSidebarPendingMessage, setActiveSidebarSection, selectVizV2Active } from '@/store/uiSlice';
import { useConfigs } from '@/lib/hooks/useConfigs';
import { shallowEqualExcept } from '@/lib/hooks/use-stable-callback';
import { setRecipeParam } from '@/lib/viz/encoding-edit';
import { resolveLegacyRenderEnvelope, vizSettingsToEnvelopeStatic } from '@/lib/viz/from-vizsettings';
import { toVizColumns } from '@/lib/viz/query-data';
import { ChartDownloadMenu } from '@/components/viz/ChartDownloadMenu';
import { getBrandLogoUrl } from '@/lib/branding/whitelabel';

// Viz V2 (docs/Visualization Arch V2.md): lazy chunk — vega/vega-lite only load on
// pages that actually render a V2 envelope (same pattern as GeoPlot/Leaflet).
// eslint-disable-next-line no-restricted-syntax
const VegaChart = dynamic(() => import('@/components/viz/VegaChart'), { ssr: false });

export interface ContainerConfig {
  showHeader: boolean;
  showJsonToggle: boolean;
  editable: boolean;
  viz: {
    showTypeButtons: boolean;
    showChartBuilder: boolean;
    typesButtonsOrientation: 'horizontal' | 'vertical';
    showTitle: boolean;
  };
    fixError: boolean;
    /** Click-to-drill-down on charts/tables. Defaults on; off for read-only embeds (shared story). */
    enableDrilldown?: boolean;
}

interface QuestionVisualizationProps {
  currentState: QuestionContent | null;
  config: ContainerConfig;
  loading: boolean;
  error: string | null;
  data: QueryResult | null;
  /** Re-run the query, bypassing cache. When provided, a Retry button shows in the error state. */
  onRetry?: () => void | Promise<void>;
  queryEstimatedDurationMs?: number | null;
  onVizTypeChange: (type: VizSettings['type']) => void;
  onAxisChange: (xCols: string[], yCols: string[]) => void;
  onYRightColsChange?: (yRightCols: string[]) => void;
  onTooltipColsChange?: (cols: string[]) => void;
  onPivotConfigChange?: (config: PivotConfig) => void;
  onGeoConfigChange?: (config: import('@/lib/types').GeoConfig) => void;
  onColumnFormatsChange?: (formats: Record<string, ColumnFormatConfig>) => void;
  onStyleConfigChange?: (config: VisualizationStyleConfig) => void;
  onAxisConfigChange?: (config: import('@/lib/types').AxisConfig) => void;
  onAnnotationsChange?: (annotations: ChartAnnotation[]) => void;
  onTrendConfigChange?: (config: import('@/lib/types').TrendConfig) => void;
  /** Receives a getter for the live geo map's center/zoom, so a sibling config panel's "Pin current view" button can read this map. */
  onMapReady?: (getView: () => { center: [number, number]; zoom: number } | null) => void;
  /** Reports the rendered series count, so a sibling config panel can size its color swatches without re-aggregating the rows. */
  onSeriesCountChange?: (count: number) => void;
  /** Called when user clicks "Show Viz Config" to open/switch left panel to Viz tab */
  onOpenVizTab?: () => void;
  /** Called when user clicks "Hide Viz Config" to collapse the left panel */
  onHideVizTab?: () => void;
  /** Whether the Viz tab is currently open in the left panel */
  vizTabOpen?: boolean;
  /** Viz V2 envelope write-back (e.g. table header format edits). Omit for read-only surfaces. */
  onVizChange?: (viz: import('@/lib/validation/atlas-schemas').VizEnvelope) => void;
}

function QueryLoadingIndicator({ estimatedDurationMs }: { estimatedDurationMs?: number | null }) {
  const [dotCount, setDotCount] = useState(1);
  const [elapsed, setElapsed] = useState(0);
  const [barWidth, setBarWidth] = useState(0);
  const barStarted = useRef(false);

  useEffect(() => {
    const dotInterval = setInterval(() => {
      setDotCount((prev) => (prev >= 3 ? 1 : prev + 1));
    }, 400);
    const timerInterval = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);
    return () => {
      clearInterval(dotInterval);
      clearInterval(timerInterval);
    };
  }, []);

  // Start bar animation once when estimate first arrives (may be after mount)
  useEffect(() => {
    if (estimatedDurationMs == null || barStarted.current) return;
    barStarted.current = true;
    const id = requestAnimationFrame(() => setBarWidth(90));
    return () => cancelAnimationFrame(id);
  }, [estimatedDurationMs]);

  const estimateLabel = estimatedDurationMs != null
    ? estimatedDurationMs >= 1000
      ? `Est. ~${(estimatedDurationMs / 1000).toFixed(1)}s`
      : `Est. ~${estimatedDurationMs}ms`
    : null;

  const barDurationS = estimatedDurationMs != null ? (estimatedDurationMs + 3000) / 1000 : 0;

  return (
    <div className="flex flex-col items-center gap-2">
      <p className="font-mono">
        Executing query
        <span className="inline-block w-[3ch] whitespace-nowrap text-left">{'.'.repeat(dotCount)}</span>
      </p>
      {estimatedDurationMs != null && (
        <div className="h-0.5 w-[200px] overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary"
            style={{
              width: `${barWidth}%`,
              transition: `width ${barDurationS}s linear`,
            }}
          />
        </div>
      )}
      {estimateLabel && elapsed < 10 && (
        <p className="font-mono text-xs text-muted-foreground">{estimateLabel}</p>
      )}
      {elapsed >= 10 && (
        <p className="font-mono text-xs text-muted-foreground">Query is still running...</p>
      )}
    </div>
  );
}

function QuestionVisualizationInner({
  currentState,
  config,
  loading,
  error,
  data,
  onRetry,
  queryEstimatedDurationMs,
  onVizTypeChange,
  onAxisChange,
  onYRightColsChange,
  onTooltipColsChange,
  onPivotConfigChange,
  onGeoConfigChange,
  onColumnFormatsChange,
  onStyleConfigChange,
  onAxisConfigChange,
  onAnnotationsChange,
  onTrendConfigChange,
  onMapReady,
  onSeriesCountChange,
  onOpenVizTab,
  onHideVizTab,
  vizTabOpen,
  onVizChange,
}: QuestionVisualizationProps) {
  const dispatch = useAppDispatch();
  const showJson = useAppSelector(state => state.ui.devMode);
  const colorMode = useAppSelector(state => state.ui.colorMode);
  const vizV2Enabled = useAppSelector(selectVizV2Active);
  const { config: appConfig } = useConfigs();
  const agentName = appConfig.branding.agentName;

  const handleFixError = () => {
    dispatch(setSidebarPendingMessage('Fix the error'));
    dispatch(setActiveSidebarSection('chat'));
    dispatch(setRightSidebarCollapsed(false));
  };

  const [isRetrying, setIsRetrying] = useState(false);
  const handleRetry = async () => {
    if (!onRetry) return;
    setIsRetrying(true);
    try {
      await onRetry();
    } finally {
      setIsRetrying(false);
    }
  };

  // V1→V2 render bridge (Viz Arch V2 §21 item 1): a chart whose truth is `vizSettings` renders
  // through <VegaChart> via just-in-time conversion — render-only, nothing is ever written back;
  // table/pivot keep their DOM renderers. Vega is the ONLY engine (Renderer_v2 Phase 2 — the
  // ECharts rollback path is deleted).
  // Memoized (Renderer_v2 Phase 7, §1.3 lever 2), and ABOVE the early return (rules-of-hooks):
  // VegaChart's build effect keys on envelope IDENTITY — a fresh object here on every legitimate
  // re-render (loading flips, new callbacks) would finalize + re-parse + re-render the whole
  // Vega view mid-interaction.
  const memoVizV2 = vizV2Enabled && currentState?.viz != null;
  const vizSettings = currentState?.vizSettings;
  const legacyRenderViz = useMemo(() => (
    data
      ? resolveLegacyRenderEnvelope({
          hasVizEnvelope: memoVizV2,
          vizSettings,
          columns: toVizColumns(data.columns, data.types),
        })
      : null
  ), [data, memoVizV2, vizSettings]);

  if (!currentState) {
    return null;
  }

  // Two toggles (docs/Visualization Arch V2.md §21): `vizRenderer` picks the
  // engine — 'echarts' is the classic pre-V2 pipeline where only V1 exists;
  // 'vega' (default) draws every chart. Under vega, the `vizV2` format flag
  // picks the AUTHORITATIVE format: off (V1) → `vizSettings` is the truth and
  // saved `viz` envelopes are ignored (the JIT bridge below renders them);
  // on (V2) → a saved envelope is the truth and renders directly.
  const hasVizV2 = vizV2Enabled && currentState?.viz != null;
  // table/pivot kinds render on the DOM tier, never through vega (RFC §10).
  const vizV2Kind = hasVizV2 ? (currentState.viz!.source as unknown as { kind: string }).kind : null;
  const isVizV2Table = vizV2Kind === 'table';
  const isVizV2Pivot = vizV2Kind === 'pivot';
  // vizSettings is OPTIONAL (viz-first files omit it): when the classic format is
  // authoritative and there is no vizSettings, fall back to the table just-in-time
  // — a viz-only file must never render blank on rollback.
  const legacyVizType = currentState?.vizSettings?.type ?? 'table';
  const isChartType = hasVizV2 || legacyVizType !== 'table';

  const showChartTitle = config.viz.showTitle;

  // Image + CSV download, revealed on hover of the chart (V1 parity). Rendered over both
  // the V2 chart and the legacy render bridge; a subtle top-right control on every chart.
  const chartDownloadOverlay = (envelope: VizEnvelope) => (
    <div className="mx-chart-dl absolute bottom-2 right-2 z-[6] opacity-0 transition-opacity duration-100">
      <ChartDownloadMenu
        envelope={envelope}
        rows={data?.rows ?? []}
        columns={data?.columns ?? []}
        colorMode={colorMode}
        logoSrc={getBrandLogoUrl(appConfig.branding, colorMode)}
      />
    </div>
  );

  return (
    <div className="flex w-full flex-1 flex-col items-stretch overflow-hidden">

      {/* Results and Side Selector Container */}
      <div className="flex min-h-0 w-full flex-1 items-stretch overflow-hidden">
        {/* Results container */}
        <div className="relative flex flex-1 flex-col overflow-hidden bg-muted/40">
        {/* Error state */}
        {error && (() => {
          const parsed = parseErrorMessage(error);

          // Network / transport failures get a calmer, centered treatment with a
          // prominent Retry — they're transient, not a bug in the user's query.
          if (parsed.isNetworkError) {
            return (
              <div className="flex size-full items-center justify-center p-6">
                <div className="flex max-w-[320px] flex-col items-center gap-3 text-center">
                  <LuCloudOff size={28} className="text-muted-foreground" />
                  <p className="text-sm font-semibold text-foreground">{parsed.title}</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">{parsed.hint}</p>
                  {onRetry && (
                    <button
                      type="button"
                      onClick={handleRetry}
                      disabled={isRetrying}
                      className="mt-1 inline-flex items-center gap-1 rounded-md border border-primary px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-60"
                    >
                      <LuRefreshCw className={isRetrying ? 'animate-spin' : undefined} />
                      {isRetrying ? 'Retrying' : 'Retry'}
                    </button>
                  )}
                </div>
              </div>
            );
          }

          // Query / SQL errors keep the detailed, red-accented treatment.
          return (
          <div className="w-full p-6">
            <div className="flex flex-col gap-4">
              <div className="border border-destructive/30 bg-destructive/10 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-semibold text-destructive">{parsed.title}</p>
                  <div className="flex gap-2">
                    {onRetry && (
                      <button
                        type="button"
                        onClick={handleRetry}
                        disabled={isRetrying}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-60"
                      >
                        <LuRefreshCw className={isRetrying ? 'animate-spin' : undefined} />
                        {isRetrying ? 'Retrying' : 'Retry'}
                      </button>
                    )}
                    {config.fixError && (
                      <button
                        type="button"
                        onClick={handleFixError}
                        className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                      >
                        <LuWrench />
                        Fix with {agentName}
                      </button>
                    )}
                  </div>
                </div>
                <p className="font-mono text-xs text-muted-foreground">{parsed.hint}</p>
              </div>

              {parsed.details && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Error Details
                  </p>
                  <div className="max-h-[200px] overflow-y-auto rounded-md border border-border bg-background p-3">
                    <p className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-muted-foreground">
                      {parsed.details}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
          );
        })()}

        {/* Empty state overlay */}
        {!loading && !data && !error && config.showHeader && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-popover/80 backdrop-blur-md">
            <div className="flex flex-col items-center gap-3">
              <LuRocket size={40} className="text-primary opacity-60" />
              <p className="text-base font-semibold tracking-tight text-muted-foreground">
                Run question to see results
              </p>
              <div className="mt-1 rounded-full border border-border bg-muted px-3 py-1">
                <p className="font-mono text-xs text-muted-foreground">Cmd/Ctrl + Enter</p>
              </div>
            </div>
          </div>
        )}

        {/* Data content */}
        {!error && (
          <div
            className={`flex min-h-0 flex-1 flex-col overflow-hidden ${(hasVizV2 ? isVizV2Table : legacyVizType === 'table') && config.showHeader ? 'p-6' : ''}`}
          >
            {loading ? (
              <div
                className="flex flex-1 flex-col items-center justify-center gap-2"
                // Screenshot readiness marker (lib/screenshot/readiness.ts): the capture waits
                // until no data-mx-busy elements remain, so it never rasterizes this spinner.
                data-mx-busy="true"
              >
                <div aria-label="Loading" className="size-10 animate-spin rounded-full border-[3px] border-primary/25 border-t-primary" />
                <QueryLoadingIndicator estimatedDurationMs={queryEstimatedDurationMs} />
              </div>
            ) : !data && !config.showHeader && (currentState.query && currentState.connection_name || currentState.spreadsheet) ? (
              // Headerless embed with an executable source but NO result yet: the pre-query
              // window (mount → effect → semaphore slot) renders a blank card whose `loading`
              // flag is still false. Stamp it BUSY so a capture never settles on blank embeds —
              // an unstamped blank here is what fed the LLM judge "missing evidence" findings
              // and made the agent delete healthy embeds. Errors and source-less embeds stay
              // unstamped (genuine states the capture must show); the workbench idle state
              // (showHeader) is user-paced, not pending.
              <div className="flex-1" data-mx-busy="true" />
            ) : data ? (
              <>
                {data.finalQuery && showJson && (
                  <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger className="absolute top-1 right-1 z-[5] cursor-help text-muted-foreground outline-none transition-colors duration-100 hover:text-primary">
                      <LuCode size={14} />
                    </TooltipTrigger>
                    <TooltipContent side="bottom" align="start" className="max-w-md whitespace-pre-wrap font-mono text-[11px]">{data.finalQuery}</TooltipContent>
                  </Tooltip>
                  </TooltipProvider>
                )}
                {hasVizV2 && isVizV2Table && (
                  <VizTableView
                    envelope={currentState.viz!}
                    columns={data.columns}
                    types={data.types}
                    rows={data.rows}
                    sql={currentState?.query}
                    databaseName={currentState?.connection_name}
                    enableDrilldown={config.enableDrilldown !== false}
                    onVizChange={config.editable ? onVizChange : undefined}
                  />
                )}
                {hasVizV2 && isVizV2Pivot && (
                  <VizPivotView
                    envelope={currentState.viz!}
                    rows={data.rows}
                    sql={currentState?.query}
                    databaseName={currentState?.connection_name}
                    enableDrilldown={config.enableDrilldown !== false}
                  />
                )}
                {hasVizV2 && !isVizV2Table && !isVizV2Pivot && (
                  <div className="group/chart relative flex min-h-0 flex-1 overflow-hidden p-3 [&:hover_.mx-chart-dl]:opacity-100 [&:focus-within_.mx-chart-dl]:opacity-100">
                    <VegaChart
                      envelope={currentState.viz!}
                      rows={data.rows}
                      colorMode={colorMode}
                      onViewChange={config.editable && onVizChange
                        ? (params) => {
                            let next = currentState.viz!;
                            for (const [k, val] of Object.entries(params)) {
                              // Drop defaults so the envelope stays clean (zoom 1, no pan).
                              const isDefault = (k === 'zoom' && val === 1) || ((k === 'panX' || k === 'panY') && val === 0);
                              next = setRecipeParam(next, k, isDefault ? undefined : val);
                            }
                            onVizChange(next);
                          }
                        : undefined}
                    />
                    {chartDownloadOverlay(currentState.viz!)}
                  </div>
                )}
                {!hasVizV2 && legacyVizType === 'table' && (
                  <div className="flex w-full min-h-0 flex-1 flex-col items-stretch overflow-hidden">
                    <TableV2 columns={data.columns} types={data.types} rows={data.rows} sql={currentState?.query} databaseName={currentState?.connection_name} enableDrilldown={config.enableDrilldown !== false} columnFormats={currentState.vizSettings?.columnFormats ?? undefined} onColumnFormatsChange={config.editable ? onColumnFormatsChange : undefined} conditionalFormats={currentState.vizSettings?.conditionalFormats ?? undefined} />
                  </div>
                )}
                {legacyRenderViz && (
                  <div className="group/chart relative flex min-h-0 flex-1 overflow-hidden p-3 [&:hover_.mx-chart-dl]:opacity-100 [&:focus-within_.mx-chart-dl]:opacity-100">
                    <VegaChart envelope={legacyRenderViz} rows={data.rows} colorMode={colorMode} />
                    {chartDownloadOverlay(legacyRenderViz)}
                  </div>
                )}
                {/* V1 pivot: the bridge deliberately returns null for pivot — it renders on the
                    DOM tier through the SAME view V2 pivots use, via a JIT-bridged envelope
                    (Renderer_v2 Phase 2: ChartBuilder + the ECharts stack are deleted). */}
                {!hasVizV2 && !legacyRenderViz && currentState?.vizSettings?.type === 'pivot' && (
                  <VizPivotView
                    envelope={vizSettingsToEnvelopeStatic(currentState.vizSettings, currentState?.query)}
                    rows={data.rows}
                    sql={currentState?.query}
                    databaseName={currentState?.connection_name}
                    enableDrilldown={config.enableDrilldown !== false}
                  />
                )}
              </>
            ) : null}
          </div>
        )}
      </div>

      </div>
    </div>
  );
}

/**
 * memo comparator: deep-equal the small structured `config` (callers rebuild
 * it inline each render — trace flagged `config.viz` as the only unstable
 * prop) and shallow compare everything else (`currentState`/`data` come from
 * Redux and stay referentially stable when unchanged; callbacks were already
 * useCallback'd at the parent).
 *
 * If a caller later starts passing inline callbacks, those would correctly
 * trigger re-renders here — we intentionally don't ignore them, so the child
 * subtree (ChartBuilder/BaseChart/EChart) never sees a stale closure.
 *
 * Pre-fix this was 33/33 wasted; the layer also gates the entire chart
 * pipeline below it.
 */
const questionVizPropsEqual = (prev: QuestionVisualizationProps, next: QuestionVisualizationProps): boolean => {
  if (!isEqual(prev.config, next.config)) return false;
  return shallowEqualExcept(prev, next, ['config']);
};

export const QuestionVisualization = memo(QuestionVisualizationInner, questionVizPropsEqual);
