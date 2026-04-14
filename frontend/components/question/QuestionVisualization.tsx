'use client';

/**
 * Question Visualization Component
 * Displays query results with multiple visualization types
 */

import { Box, HStack, VStack, Text, Spinner, Button, IconButton } from '@chakra-ui/react';
import { LuRocket, LuWrench, LuSettings, LuChevronDown, LuChevronUp, LuCode } from 'react-icons/lu';
import { Tooltip } from '@/components/ui/tooltip';
import { Table } from '@/components/plotx/Table';
import { TableV2 } from '@/components/plotx/TableV2';
import { ChartBuilder } from '@/components/plotx/ChartBuilder';
import { parseErrorMessage } from '@/lib/utils/error-parser';
import { VizTypeSelector } from './VizTypeSelector';
import type { QuestionContent, QueryResult, VizSettings, PivotConfig, ColumnFormatConfig, VisualizationStyleConfig, ChartAnnotation } from '@/lib/types';
import { useState, useEffect, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { setRightSidebarCollapsed, setSidebarPendingMessage, setActiveSidebarSection } from '@/store/uiSlice';
import { useConfigs } from '@/lib/hooks/useConfigs';

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
}

interface QuestionVisualizationProps {
  currentState: QuestionContent | null;
  config: ContainerConfig;
  loading: boolean;
  error: string | null;
  data: QueryResult | null;
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
        Loading
        <Box as="span" display="inline-block">
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
          Query is still running... ({elapsed}s elapsed)
        </Text>
      )}
    </VStack>
  );
}

export function QuestionVisualization({
  currentState,
  config,
  loading,
  error,
  data,
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
}: QuestionVisualizationProps) {
  const dispatch = useAppDispatch();
  const showJson = useAppSelector(state => state.ui.showJson);
  const { config: appConfig } = useConfigs();
  const agentName = appConfig.branding.agentName;

  const handleFixError = () => {
    dispatch(setSidebarPendingMessage('Fix the error'));
    dispatch(setActiveSidebarSection('chat'));
    dispatch(setRightSidebarCollapsed(false));
  };

  const [vizSettingsExpanded, setVizSettingsExpanded] = useState(false);

  const handleVizTypeChangeWithAutoExpand = (type: VizSettings['type']) => {
    if (type !== 'table') {
      setVizSettingsExpanded(true);
    }
    onVizTypeChange(type);
  };

  if (!currentState) {
    return null;
  }

  const useCompactLayout = config.viz.typesButtonsOrientation === 'horizontal';
  const isChartType = currentState?.vizSettings?.type && currentState.vizSettings.type !== 'table';

  const showChartTitle = config.viz.showTitle;
  return (
    <VStack gap={0} width="full" align="stretch" flex="1" overflow="hidden"
    // borderRadius={'lg'} border={'1px solid'} borderColor={'border.muted'}
    >
      {useCompactLayout && config.viz.showTypeButtons && data && !error && (
        <Box display="flex" flexWrap="wrap" alignItems="center" justifyContent="space-between" bg="bg.muted" shadow="sm" p={2} gap={1}>
          <Box flexShrink={1} minWidth={0}>
            <VizTypeSelector
              value={currentState?.vizSettings?.type || 'table'}
              onChange={handleVizTypeChangeWithAutoExpand}
              orientation={config.viz.typesButtonsOrientation}
            />
          </Box>
          {isChartType && config.viz.showChartBuilder && (
            <Button
              aria-label="Toggle viz settings"
              size="xs"
              variant="ghost"
              onClick={() => setVizSettingsExpanded(!vizSettingsExpanded)}
              color="fg.muted"
              fontWeight="600"
              fontSize="xs"
              flexShrink={0}
            >
              <LuSettings size={14} />
              {vizSettingsExpanded ? 'Hide Viz Config' : 'Show Viz Config'}
              {vizSettingsExpanded ? <LuChevronUp size={14} /> : <LuChevronDown size={14} />}
            </Button>
          )}
        </Box>
      )}

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
        {error && (
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
                    {parseErrorMessage(error).title}
                  </Text>
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
                <Text fontSize="xs" color="fg.muted" fontFamily="mono">
                  {parseErrorMessage(error).hint}
                </Text>
              </Box>

              {parseErrorMessage(error).details && (
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
                      {parseErrorMessage(error).details}
                    </Text>
                  </Box>
                </Box>
              )}
            </VStack>
          </Box>
        )}

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
                {currentState?.vizSettings?.type === 'table' && (
                  <Box flex="1" minHeight="0" overflow="hidden" display="flex" width={"100%"} alignItems={"stretch"} flexDirection={"column"}>
                    <TableV2 columns={data.columns} types={data.types} rows={data.rows} sql={currentState?.query} databaseName={currentState?.connection_name} />
                  </Box>
                )}
                {(currentState?.vizSettings?.type === 'line' ||
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
                  currentState?.vizSettings?.type === 'geo') && (
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
                      showAxisBuilder={config.viz.showChartBuilder}
                      useCompactView={useCompactLayout}
                      fillHeight={true}
                      initialPivotConfig={currentState.vizSettings?.pivotConfig ?? undefined}
                      onPivotConfigChange={onPivotConfigChange}
                      initialGeoConfig={currentState.vizSettings?.geoConfig ?? undefined}
                      onGeoConfigChange={onGeoConfigChange}
                      sql={currentState?.query}
                      databaseName={currentState?.connection_name}
                      initialColumnFormats={currentState.vizSettings?.columnFormats ?? undefined}
                      onColumnFormatsChange={onColumnFormatsChange}
                      settingsExpanded={useCompactLayout ? vizSettingsExpanded : undefined}
                      showChartTitle={showChartTitle}
                      styleConfig={{
                        ...(currentState.vizSettings?.styleConfig ?? {}),
                        ...(currentState.vizSettings?.colors ? { colors: currentState.vizSettings.colors } : {}),
                      }}
                      onStyleConfigChange={onStyleConfigChange}
                      axisConfig={currentState.vizSettings?.axisConfig ?? undefined}
                      onAxisConfigChange={onAxisConfigChange}
                      annotations={currentState.vizSettings?.annotations ?? undefined}
                      onAnnotationsChange={onAnnotationsChange}
                      exportBranding={appConfig.branding}
                    />
                  </Box>
                )}
              </>
            ) : null}
          </Box>
        )}
      </Box>

      {/* Viz Type Selector - Side in vertical layout */}
      {!useCompactLayout && config.viz.showTypeButtons && data && !error && (
        <VizTypeSelector
          value={currentState?.vizSettings?.type || 'table'}
          onChange={onVizTypeChange}
          orientation={config.viz.typesButtonsOrientation}
        />
      )}
      </HStack>
    </VStack>
  );
}
