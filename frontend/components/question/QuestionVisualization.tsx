'use client';

/**
 * Question Visualization Component
 * Displays query results with multiple visualization types
 */

import { Box, HStack, VStack, Text, Spinner, Button } from '@chakra-ui/react';
import { LuRocket, LuWrench, LuSettings, LuCode, LuRefreshCw, LuCloudOff } from 'react-icons/lu';
import dynamic from 'next/dynamic';
import { Tooltip } from '@/components/ui/tooltip';
import { TableV2 } from '@/components/plotx/TableV2';
import { VizTableView } from '@/components/viz/VizTableView';
import { VizPivotView } from '@/components/viz/VizPivotView';
import { ChartBuilder } from '@/components/plotx/ChartBuilder';
import { parseErrorMessage } from '@/components/question/error-parser';
import type { QuestionContent, QueryResult, VizSettings, PivotConfig, ColumnFormatConfig, VisualizationStyleConfig, ChartAnnotation } from '@/lib/types';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';
import { memo, useState, useEffect, useRef } from 'react';
import isEqual from 'lodash/isEqual';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { setRightSidebarCollapsed, setSidebarPendingMessage, setActiveSidebarSection } from '@/store/uiSlice';
import { useConfigs } from '@/lib/hooks/useConfigs';
import { shallowEqualExcept } from '@/lib/hooks/use-stable-callback';
import { setRecipeParam } from '@/lib/viz/encoding-edit';
import { resolveLegacyRenderEnvelope } from '@/lib/viz/from-vizsettings';
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
    <VStack gap={2}>
      <Text fontFamily="mono">
        Executing query
        <Box as="span" display="inline-block" w="3ch" textAlign="left" whiteSpace="nowrap">
          {'.'.repeat(dotCount)}
        </Box>
      </Text>
      {estimatedDurationMs != null && (
        <Box w="200px" h="2px" bg="bg.muted" borderRadius="full" overflow="hidden">
          <Box
            h="full"
            bg="accent.teal"
            style={{
              width: `${barWidth}%`,
              transition: `width ${barDurationS}s linear`,
            }}
          />
        </Box>
      )}
      {estimateLabel && elapsed < 10 && (
        <Text fontSize="xs" color="fg.muted" fontFamily="mono">
          {estimateLabel}
        </Text>
      )}
      {elapsed >= 10 && (
        <Text fontSize="xs" color="fg.muted" fontFamily="mono">
          Query is still running...
        </Text>
      )}
    </VStack>
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

  if (!currentState) {
    return null;
  }

  // A V2 envelope is authoritative when present (RFC): the vizSettings pipeline is bypassed.
  // The settings button stays visible for V2 questions — the panel shows the spec inspector.
  const hasVizV2 = currentState?.viz != null;
  // table/pivot kinds render on the DOM tier, never through vega (RFC §10).
  const vizV2Kind = hasVizV2 ? (currentState.viz!.source as unknown as { kind: string }).kind : null;
  const isVizV2Table = vizV2Kind === 'table';
  const isVizV2Pivot = vizV2Kind === 'pivot';
  const isChartType = hasVizV2 || (currentState?.vizSettings?.type && currentState.vizSettings.type !== 'table');

  // Render-only V1→V2 bridge (Viz Arch V2 §21 item 1): on READ-ONLY surfaces, a legacy
  // chart with no `viz` envelope renders through <VegaChart> via the converter. Editable
  // surfaces keep the V1 ChartBuilder (until the item-4 backfill writes a real `viz`);
  // table/pivot keep their DOM renderers. Pure — recomputed from vizSettings each render,
  // so V1 edits still flow to the picture.
  const legacyRenderViz = data
    ? resolveLegacyRenderEnvelope({
        hasVizEnvelope: hasVizV2,
        editable: config.editable,
        vizSettings: currentState?.vizSettings,
        columns: toVizColumns(data.columns, data.types),
      })
    : null;

  const showChartTitle = config.viz.showTitle;

  // Image + CSV download, revealed on hover of the chart (V1 parity). Rendered over both
  // the V2 chart and the legacy render bridge; a subtle top-right control on every chart.
  const chartDownloadOverlay = (envelope: VizEnvelope) => (
    <Box className="mx-chart-dl" position="absolute" top={2} right={2} zIndex={6} opacity={0} transition="opacity 0.12s">
      <ChartDownloadMenu
        envelope={envelope}
        rows={data?.rows ?? []}
        columns={data?.columns ?? []}
        colorMode={colorMode}
        logoSrc={getBrandLogoUrl(appConfig.branding, colorMode)}
      />
    </Box>
  );

  return (
    <VStack gap={0} width="full" align="stretch" flex="1" overflow="hidden"
    // borderRadius={'lg'} border={'1px solid'} borderColor={'border.muted'}
    >
      {/* Viz Config toggle button — show/hide viz tab in the left panel */}
      {/* {(onOpenVizTab || onHideVizTab) && isChartType && config.viz.showChartBuilder && data && !error && (
        <Box display="flex" alignItems="center" justifyContent="flex-end" bg="bg.muted" shadow="sm" px={2} py={1}>
          <Button
            aria-label={vizTabOpen ? "Hide viz settings" : "Show viz settings"}
            size="xs"
            variant="ghost"
            onClick={vizTabOpen ? onHideVizTab : onOpenVizTab}
            color="fg.muted"
            fontWeight="600"
            fontSize="2xs"
            flexShrink={0}
          >
            <LuSettings />
            {vizTabOpen ? 'Hide Viz Settings' : 'Show Viz Settings'}
          </Button>
        </Box>
      )} */}

      {/* Results and Side Selector Container */}
      <HStack gap={0} width="full" align="stretch" flex="1" overflow="hidden" minH="0px">
        {/* Results container */}
        <Box
          flex="1"
          bg="bg.subtle"
        //   borderRadius="lg"
          // border="1px solid"
          // borderColor="border.default"
          position="relative"
          overflow="hidden"
          display="flex"
          flexDirection="column"
        >
        {/* Error state */}
        {error && (() => {
          const parsed = parseErrorMessage(error);

          // Network / transport failures get a calmer, centered treatment with a
          // prominent Retry — they're transient, not a bug in the user's query.
          if (parsed.isNetworkError) {
            return (
              <Box p={6} width="full" height="full" display="flex" alignItems="center" justifyContent="center">
                <VStack gap={3} maxW="320px" textAlign="center">
                  <LuCloudOff size={28} color="var(--chakra-colors-fg-muted)" />
                  <Text fontSize="sm" fontWeight="600" color="fg.default">
                    {parsed.title}
                  </Text>
                  <Text fontSize="xs" color="fg.muted" lineHeight="1.6">
                    {parsed.hint}
                  </Text>
                  {onRetry && (
                    <Button
                      size="xs"
                      variant="outline"
                      colorPalette="teal"
                      onClick={handleRetry}
                      loading={isRetrying}
                      loadingText="Retrying"
                      mt={1}
                    >
                      <LuRefreshCw />
                      Retry
                    </Button>
                  )}
                </VStack>
              </Box>
            );
          }

          // Query / SQL errors keep the detailed, red-accented treatment.
          return (
          <Box p={6} width="full">
            <VStack gap={4} align="stretch">
              <Box
                bg="accent.danger/10"
                border="1px solid"
                borderColor="accent.danger/30"
                p={4}
              >
                <HStack justify="space-between" align="center" mb={2}>
                  <Text
                    fontSize="sm"
                    fontWeight="600"
                    color="accent.danger"
                  >
                    {parsed.title}
                  </Text>
                  <HStack gap={2}>
                    {onRetry && (
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={handleRetry}
                        loading={isRetrying}
                        loadingText="Retrying"
                      >
                        <LuRefreshCw />
                        Retry
                      </Button>
                    )}
                    {config.fixError && <Button
                      size="xs"
                      variant="solid"
                      colorPalette="teal"
                      onClick={handleFixError}
                    >
                      <LuWrench />
                      Fix with {agentName}
                    </Button>
                    }
                  </HStack>
                </HStack>
                <Text fontSize="xs" color="fg.muted" fontFamily="mono">
                  {parsed.hint}
                </Text>
              </Box>

              {parsed.details && (
                <Box>
                  <Text
                    fontSize="xs"
                    fontWeight="600"
                    color="fg.muted"
                    mb={2}
                    textTransform="uppercase"
                    letterSpacing="0.05em"
                  >
                    Error Details
                  </Text>
                  <Box
                    p={3}
                    bg="bg.canvas"
                    borderRadius="md"
                    border="1px solid"
                    borderColor="border.muted"
                    maxH="200px"
                    overflowY="auto"
                  >
                    <Text
                      fontSize="xs"
                      color="fg.muted"
                      fontFamily="mono"
                      whiteSpace="pre-wrap"
                      wordBreak="break-word"
                      lineHeight="1.6"
                    >
                      {parsed.details}
                    </Text>
                  </Box>
                </Box>
              )}
            </VStack>
          </Box>
          );
        })()}

        {/* Empty state overlay */}
        {!loading && !data && !error && config.showHeader && (
          <Box
            position="absolute"
            top="0"
            left="0"
            right="0"
            bottom="0"
            bg="bg.surface/80"
            backdropFilter="blur(8px)"
            display="flex"
            alignItems="center"
            justifyContent="center"
            zIndex="10"
          >
            <VStack gap={3}>
              <LuRocket size={40} color="var(--chakra-colors-accent-teal)" opacity="0.6" />
              <Text
                color="fg.muted"
                fontSize="md"
                fontWeight="600"
                letterSpacing="-0.01em"
              >
                Run question to see results
              </Text>
              <Box
                mt={1}
                px={3}
                py={1}
                bg="bg.muted"
                borderRadius="full"
                border="1px solid"
                borderColor="border.muted"
              >
                <Text fontSize="xs" color="fg.subtle" fontFamily="mono">
                  Cmd/Ctrl + Enter
                </Text>
              </Box>
            </VStack>
          </Box>
        )}

        {/* Data content */}
        {!error && (
          <Box
            p={currentState?.vizSettings?.type === 'table' && config.showHeader ? 6 : 0}
            flex="1"
            display="flex"
            flexDirection="column"
            overflow="hidden"
            minHeight="0"
          >
            {loading ? (
              <VStack
                flex="1"
                display="flex"
                alignItems="center"
                justifyContent="center"
                // Screenshot readiness marker (lib/screenshot/readiness.ts): the capture waits
                // until no data-mx-busy elements remain, so it never rasterizes this spinner.
                data-mx-busy="true"
              >
                <Spinner size="xl" color="accent.teal" />
                <QueryLoadingIndicator estimatedDurationMs={queryEstimatedDurationMs} />
              </VStack>
            ) : data ? (
              <>
                {data.finalQuery && showJson && (
                  <Tooltip content={data.finalQuery} positioning={{ placement: 'bottom-start' }}>
                    <Box
                      position="absolute"
                      top={1}
                      right={1}
                      zIndex={5}
                      color="fg.subtle"
                      cursor="help"
                      _hover={{ color: 'accent.teal' }}
                      transition="color 0.1s"
                    >
                      <LuCode size={14} />
                    </Box>
                  </Tooltip>
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
                  <Box position="relative" flex="1" minHeight="0" overflow="hidden" display="flex" p={3} css={{ '&:hover .mx-chart-dl, &:focus-within .mx-chart-dl': { opacity: 1 } }}>
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
                  </Box>
                )}
                {!hasVizV2 && currentState?.vizSettings?.type === 'table' && (
                  <Box flex="1" minHeight="0" overflow="hidden" display="flex" width={"100%"} alignItems={"stretch"} flexDirection={"column"}>
                    <TableV2 columns={data.columns} types={data.types} rows={data.rows} sql={currentState?.query} databaseName={currentState?.connection_name} enableDrilldown={config.enableDrilldown !== false} columnFormats={currentState.vizSettings?.columnFormats ?? undefined} onColumnFormatsChange={config.editable ? onColumnFormatsChange : undefined} conditionalFormats={currentState.vizSettings?.conditionalFormats ?? undefined} />
                  </Box>
                )}
                {legacyRenderViz && (
                  <Box position="relative" flex="1" minHeight="0" overflow="hidden" display="flex" p={3} css={{ '&:hover .mx-chart-dl, &:focus-within .mx-chart-dl': { opacity: 1 } }}>
                    <VegaChart envelope={legacyRenderViz} rows={data.rows} colorMode={colorMode} />
                    {chartDownloadOverlay(legacyRenderViz)}
                  </Box>
                )}
                {!hasVizV2 && !legacyRenderViz && (currentState?.vizSettings?.type === 'line' ||
                  currentState?.vizSettings?.type === 'bar' ||
                  currentState?.vizSettings?.type === 'area' ||
                  currentState?.vizSettings?.type === 'scatter' ||
                  currentState?.vizSettings?.type === 'funnel' ||
                  currentState?.vizSettings?.type === 'pie' ||
                  currentState?.vizSettings?.type === 'pivot' ||
                  currentState?.vizSettings?.type === 'trend' ||
                  currentState?.vizSettings?.type === 'waterfall' ||
                  currentState?.vizSettings?.type === 'combo' ||
                  currentState?.vizSettings?.type === 'radar' ||
                  currentState?.vizSettings?.type === 'geo' ||
                  currentState?.vizSettings?.type === 'single_value' ||
                  currentState?.vizSettings?.type === 'row') && (
                  <Box flex="1" width="100%" overflow="hidden" minHeight="0" display="flex">
                    <ChartBuilder
                      columns={data.columns}
                      types={data.types}
                      rows={data.rows}
                      chartType={currentState.vizSettings.type}
                      initialXCols={currentState.vizSettings?.xCols ?? undefined}
                      initialYCols={currentState.vizSettings?.yCols ?? undefined}
                      initialYRightCols={currentState.vizSettings?.yRightCols ?? undefined}
                      onAxisChange={onAxisChange}
                      onYRightColsChange={onYRightColsChange}
                      initialTooltipCols={currentState.vizSettings?.tooltipCols ?? undefined}
                      onTooltipColsChange={onTooltipColsChange}
                      fillHeight={true}
                      initialPivotConfig={currentState.vizSettings?.pivotConfig ?? undefined}
                      onPivotConfigChange={onPivotConfigChange}
                      initialGeoConfig={currentState.vizSettings?.geoConfig ?? undefined}
                      onGeoConfigChange={onGeoConfigChange}
                      sql={currentState?.query}
                      databaseName={currentState?.connection_name}
                      initialColumnFormats={currentState.vizSettings?.columnFormats ?? undefined}
                      onColumnFormatsChange={onColumnFormatsChange}
                      showChartTitle={showChartTitle}
                      styleConfig={currentState.vizSettings?.styleConfig ?? undefined}
                      onStyleConfigChange={onStyleConfigChange}
                      axisConfig={currentState.vizSettings?.axisConfig ?? undefined}
                      onAxisConfigChange={onAxisConfigChange}
                      annotations={currentState.vizSettings?.annotations ?? undefined}
                      onAnnotationsChange={onAnnotationsChange}
                      trendConfig={currentState.vizSettings?.trendConfig ?? undefined}
                      onTrendConfigChange={onTrendConfigChange}
                      singleValueConfig={currentState.vizSettings?.singleValueConfig ?? undefined}
                      exportBranding={appConfig.branding}
                      enableDrilldown={config.enableDrilldown !== false}
                      onMapReady={onMapReady}
                      onSeriesCountChange={onSeriesCountChange}
                    />
                  </Box>
                )}
              </>
            ) : null}
          </Box>
        )}
      </Box>

      </HStack>
    </VStack>
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
