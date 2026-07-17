'use client';

import { useState, useMemo, useRef, useCallback } from 'react';
import { Box, HStack, VStack, Text, Icon } from '@chakra-ui/react';
import { LuChevronLeft, LuChevronRight, LuChevronDown, LuChevronUp, LuDatabase, LuX, LuCheck, LuSettings } from 'react-icons/lu';
import type { MessageWithFlags } from '../message/messageHelpers';
import type { QuestionContent, QueryResult, ExecuteQueryDetails } from '@/lib/types';
import { contentToDetails, connectionTypeToDialect } from '@/lib/types';
import { QuestionVisualization } from '@/components/question/QuestionVisualization';
import SqlEditor from '@/components/query-builder/SqlEditor';
import { QueryModeSelector, type QueryTab } from '@/components/query-builder';
import { VizTypeSelector, isClassicVizType } from '@/components/question/VizTypeSelector';
import { VizConfigPanel } from '@/components/plotx/VizConfigPanel';

/** A generic chart item that can come from ExecuteQuery or CreateFile */
export interface ChartItem {
  name: string;
  question: QuestionContent;
  queryResult: QueryResult;
  error?: null;
}

export interface ChartErrorItem {
  name: string;
  question?: null;
  queryResult?: null;
  error: string;
}

interface ChartCarouselProps {
  /** Pre-parsed chart items (from CreateFile, etc.) */
  items?: (ChartItem | ChartErrorItem)[];
  /** Raw ExecuteQuery messages (parsed internally) */
  executeMessages?: MessageWithFlags[];
  databaseName: string;
  isCompact?: boolean;
  showThinking?: boolean;
  toggleShowThinking?: () => void;
  markdownContext?: 'sidebar' | 'mainpage';
  readOnly?: boolean;
  /** Label for the header (singular, default: "query") */
  label?: string;
  /** Plural label for the header (default: "queries") */
  labelPlural?: string;
  /** Icon for the header (default: LuDatabase) */
  headerIcon?: React.ComponentType;
}

// ─── ExecuteQuery message parser ─────────────────────────────────

function parseQueryMessage(msg: MessageWithFlags, databaseName: string): ChartItem | ChartErrorItem {
  const toolMsg = msg as any;
  const args = toolMsg.function?.arguments;
  let parsed: any = {};
  try {
    parsed = typeof args === 'string' ? JSON.parse(args) : args || {};
  } catch { /* ignore */ }

  const name = parsed.name || 'Query';

  try {
    let vizSettings = { type: 'table' as const };
    if (parsed.vizSettings) {
      const vs = typeof parsed.vizSettings === 'string' ? JSON.parse(parsed.vizSettings) : parsed.vizSettings;
      if (vs?.type) vizSettings = vs;
    }

    let parameters: any[] = [];
    if (parsed.parameters) {
      const ps = typeof parsed.parameters === 'string' ? JSON.parse(parsed.parameters) : parsed.parameters;
      if (Array.isArray(ps)) parameters = ps;
    }

    const question: QuestionContent = {
      query: parsed.query || '',
      vizSettings,
      parameters,
      connection_name: databaseName || '',
    };

    const toolMessage = {
      role: 'tool' as const,
      tool_call_id: toolMsg.tool_call_id,
      content: toolMsg.content,
      ...(toolMsg.details && { details: toolMsg.details }),
    };

    const details = contentToDetails<ExecuteQueryDetails>(toolMessage);
    const error = details.error ?? null;

    if (error) {
      return { name, error };
    }

    const queryResult = details.queryResult
      ?? (details.columns ? { columns: details.columns, types: details.types ?? [], rows: details.rows ?? [] } : null);

    if (!queryResult) return { name, error: 'No data returned' };

    return { name, question, queryResult };
  } catch {
    return { name, error: 'Failed to parse query' };
  }
}

function isChartItem(item: ChartItem | ChartErrorItem): item is ChartItem {
  return !item.error && !!item.question && !!item.queryResult;
}

// ─── Component ───────────────────────────────────────────────────

export default function ChartCarousel({
  items: providedItems,
  executeMessages,
  databaseName,
  label,
  labelPlural,
  headerIcon,
  isCompact,
}: ChartCarouselProps) {
  // Build items from either source
  const allItems = useMemo(() => {
    if (providedItems) return providedItems;
    if (executeMessages) return executeMessages.map(m => parseQueryMessage(m, databaseName));
    return [];
  }, [providedItems, executeMessages, databaseName]);

  const successful = useMemo(() => allItems.filter(isChartItem), [allItems]);
  const failedCount = allItems.length - successful.length;

  const [activeIndex, setActiveIndex] = useState(0);
  const [queryMode, setQueryMode] = useState<QueryTab>('sql');
  const [settingsOpen, setSettingsOpen] = useState(false);

  const count = successful.length;
  const safeIndex = Math.min(activeIndex, Math.max(0, count - 1));
  const current = successful[safeIndex] ?? null;

  // Proactive GUI-compatibility check: dim the GUI tab when the current query can't
  // be parsed into the builder IR (this is a read-only preview, but entering GUI on
  // an unparseable query would just show a "cannot be edited" message).
  const dialect = connectionTypeToDialect('');

  const [localContent, setLocalContent] = useState<QuestionContent | null>(current?.question ?? null);
  const prevQuestionRef = useRef(current?.question);

  // Live geo map view getter — populated by the active chart's map when it mounts,
  // read by the VizConfigPanel "Pin current view" button (a sibling of the map).
  const getMapViewRef = useRef<(() => { center: [number, number]; zoom: number } | null) | null>(null);
  const handleMapReady = useCallback((getView: () => { center: [number, number]; zoom: number } | null) => {
    getMapViewRef.current = getView;
  }, []);
  const getMapView = useCallback(() => getMapViewRef.current?.() ?? null, []);
  // Rendered series count, reported by the chart so the sibling VizConfigPanel's
  // color swatches match split-by charts without re-aggregating the rows.
  const [chartSeriesCount, setChartSeriesCount] = useState<number | undefined>(undefined);
  if (current?.question !== prevQuestionRef.current) {
    prevQuestionRef.current = current?.question;
    setLocalContent(current?.question ?? null);
  }

  const handleContentChange = (updates: Partial<QuestionContent>) => {
    setLocalContent(prev => {
      if (!prev) return null;
      const merged = { ...prev };
      for (const [key, value] of Object.entries(updates)) {
        if (value && typeof value === 'object' && !Array.isArray(value) && merged[key as keyof QuestionContent] && typeof merged[key as keyof QuestionContent] === 'object') {
          merged[key as keyof QuestionContent] = { ...merged[key as keyof QuestionContent] as any, ...value };
        } else {
          merged[key as keyof QuestionContent] = value as any;
        }
      }
      return merged;
    });
  };

  const totalCount = allItems.length;
  const displayLabel = totalCount === 1
    ? (label || 'query')
    : (labelPlural || label ? `${label}s` : 'queries');

  // All failed
  if (count === 0) {
    return (
      <VStack gap={1} align="stretch" p={2}>
        <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" fontWeight="600" textTransform="uppercase">
          {totalCount} {displayLabel} (all failed)
        </Text>
        {allItems.filter(i => i.error).map((q, idx) => (
          <HStack key={idx} gap={1.5} px={2} py={1} bg="accent.danger/8" borderRadius="sm">
            <Icon as={LuX} boxSize={2.5} color="accent.danger" />
            <Text fontSize="xs" fontFamily="mono" color="accent.danger" truncate>
              {q.error}
            </Text>
          </HStack>
        ))}
      </VStack>
    );
  }

  const canPrev = safeIndex > 0;
  const canNext = safeIndex < count - 1;

  return (
    <VStack gap={0} align="stretch">
      {/* Top bar — label + settings (left) | nav (right) */}
      <HStack justify="space-between" px={3} pt={2} pb={1}>
        <HStack gap={3}>
          <HStack gap={1.5}>
            <Icon as={headerIcon || LuDatabase} boxSize={3} color="fg.muted" />
            <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" fontWeight="600" textTransform="uppercase">
              {totalCount} {displayLabel}
              {failedCount > 0 && ` (${failedCount} failed)`}
            </Text>
          </HStack>

          <Box w="1px" h="14px" bg="border.muted" />

          <HStack
            as="button"
            aria-label="Toggle settings"
            onClick={() => setSettingsOpen(!settingsOpen)}
            gap={1}
            cursor="pointer"
            color={settingsOpen ? 'accent.teal' : 'fg.subtle'}
            _hover={{ color: settingsOpen ? 'accent.teal' : 'fg.default' }}
            transition="color 0.15s"
          >
            <Icon as={LuSettings} boxSize={3} />
            <Text fontSize="2xs" fontFamily="mono" fontWeight="500">
              Settings
            </Text>
            <Icon as={settingsOpen ? LuChevronUp : LuChevronDown} boxSize={3} />
          </HStack>
        </HStack>

        {count > 1 && (
          <HStack gap={1.5}>
            <Box
              as="button" aria-label="Previous chart"
              onClick={() => canPrev && setActiveIndex(safeIndex - 1)}
              w="24px" h="24px" borderRadius="full"
              bg={canPrev ? 'accent.teal' : 'accent.teal/15'} color={canPrev ? 'white' : 'accent.teal'}
              display="flex" alignItems="center" justifyContent="center"
              cursor={canPrev ? 'pointer' : 'default'}
              opacity={canPrev ? 1 : 0.4}
              _hover={canPrev ? { bg: 'accent.teal', boxShadow: 'sm' } : {}}
              transition="all 0.15s"
            ><LuChevronLeft size={14} /></Box>
            {successful.map((_, idx) => (
              <Box
                key={idx}
                as="button"
                aria-label={`Go to chart ${idx + 1}`}
                w={idx === safeIndex ? '16px' : '6px'} h="6px" borderRadius="full"
                bg={idx === safeIndex ? 'accent.teal' : 'border.default'}
                cursor="pointer" transition="all 0.2s"
                onClick={() => setActiveIndex(idx)}
              />
            ))}
            <Box
              as="button" aria-label="Next chart"
              onClick={() => canNext && setActiveIndex(safeIndex + 1)}
              w="24px" h="24px" borderRadius="full"
              bg={canNext ? 'accent.teal' : 'accent.teal/15'} color={canNext ? 'white' : 'accent.teal'}
              display="flex" alignItems="center" justifyContent="center"
              cursor={canNext ? 'pointer' : 'default'}
              opacity={canNext ? 1 : 0.4}
              _hover={canNext ? { bg: 'accent.teal', boxShadow: 'sm' } : {}}
              transition="all 0.15s"
            ><LuChevronRight size={14} /></Box>
          </HStack>
        )}
      </HStack>

      {/* Content area */}
      <Box>
        {/* Current item name — skip if it's just the default "Query" */}
        {current && current.name !== 'Query' && (
          <HStack px={3} pb={1} gap={1.5}>
            <Icon as={LuCheck} boxSize={2.5} color="accent.success" />
            <Text fontSize="xs" fontFamily="mono" color="fg.default" fontWeight="600" truncate>
              {current.name}
            </Text>
          </HStack>
        )}

        {/* Settings panel (SQL / GUI / Viz tabs) */}
        {settingsOpen && (
          <Box mx={2} mb={2}>
            <HStack mb={1}>
              <QueryModeSelector
                mode={queryMode}
                onModeChange={setQueryMode}
                canUseViz={!!current?.queryResult}
              />
            </HStack>
            <Box borderRadius="md" overflow="hidden">
              {queryMode === 'sql' && current?.question?.query && (
                <SqlEditor
                  value={current.question.query}
                  readOnly
                  showRunButton={false}
                  showFormatButton={false}
                />
              )}
              {queryMode === 'viz' && localContent && current?.queryResult && (
                <Box px={3} py={2} display="flex" flexDirection="column" gap={0}>
                  <VizTypeSelector
                    value={localContent.vizSettings?.type || 'table'}
                    onChange={(type) => { if (isClassicVizType(type)) handleContentChange({ vizSettings: { ...(localContent!.vizSettings ?? { type: 'table' as const }), type } }) }}
                    orientation="grouped"
                  />
                  {localContent.vizSettings?.type && localContent.vizSettings.type !== 'table' && (
                    <VizConfigPanel
                      columns={current.queryResult.columns}
                      types={current.queryResult.types}
                      chartType={localContent.vizSettings?.type ?? 'table'}
                      initialXCols={localContent.vizSettings?.xCols ?? undefined}
                      initialYCols={localContent.vizSettings?.yCols ?? undefined}
                      initialYRightCols={localContent.vizSettings?.yRightCols ?? undefined}
                      onAxisChange={(xCols, yCols) => handleContentChange({ vizSettings: { ...(localContent!.vizSettings ?? { type: 'table' as const }), xCols, yCols } })}
                      onYRightColsChange={(yRightCols) => handleContentChange({ vizSettings: { ...(localContent!.vizSettings ?? { type: 'table' as const }), yRightCols } })}
                      initialTooltipCols={localContent.vizSettings?.tooltipCols ?? undefined}
                      onTooltipColsChange={(tooltipCols) => handleContentChange({ vizSettings: { ...(localContent!.vizSettings ?? { type: 'table' as const }), tooltipCols } })}
                      initialPivotConfig={localContent.vizSettings?.pivotConfig ?? undefined}
                      onPivotConfigChange={(pivotConfig) => handleContentChange({ vizSettings: { ...(localContent!.vizSettings ?? { type: 'table' as const }), pivotConfig } })}
                      initialGeoConfig={localContent.vizSettings?.geoConfig ?? undefined}
                      onGeoConfigChange={(geoConfig) => handleContentChange({ vizSettings: { ...(localContent!.vizSettings ?? { type: 'table' as const }), geoConfig } })}
                      initialColumnFormats={localContent.vizSettings?.columnFormats ?? undefined}
                      onColumnFormatsChange={(columnFormats) => handleContentChange({ vizSettings: { ...(localContent!.vizSettings ?? { type: 'table' as const }), columnFormats } })}
                      styleConfig={localContent.vizSettings?.styleConfig ?? undefined}
                      onStyleConfigChange={(styleConfig) => handleContentChange({ vizSettings: { ...(localContent!.vizSettings ?? { type: 'table' as const }), styleConfig } })}
                      axisConfig={localContent.vizSettings?.axisConfig ?? undefined}
                      onAxisConfigChange={(axisConfig) => handleContentChange({ vizSettings: { ...(localContent!.vizSettings ?? { type: 'table' as const }), axisConfig } })}
                      annotations={localContent.vizSettings?.annotations ?? undefined}
                      onAnnotationsChange={(annotations) => handleContentChange({ vizSettings: { ...(localContent!.vizSettings ?? { type: 'table' as const }), annotations } })}
                      trendConfig={localContent.vizSettings?.trendConfig ?? undefined}
                      onTrendConfigChange={(trendConfig) => handleContentChange({ vizSettings: { ...(localContent!.vizSettings ?? { type: 'table' as const }), trendConfig } })}
                      seriesCount={chartSeriesCount}
                      getMapView={getMapView}
                    />
                  )}
                </Box>
              )}
            </Box>
          </Box>
        )}

        {/* Chart */}
        <Box px={1} pb={count > 1 ? 1 : 2} minH="300px">
          <Box borderRadius="md" overflow="hidden" border="1px solid" borderColor="border.default">
          {localContent && current?.queryResult ? (
            <QuestionVisualization
              currentState={localContent}
              config={{
                showHeader: false,
                showJsonToggle: false,
                editable: false,
                viz: {
                  showTypeButtons: false,
                  showChartBuilder: false,
                  typesButtonsOrientation: 'horizontal',
                  showTitle: true,
                },
                fixError: false,
              }}
              loading={false}
              error={null}
              data={current.queryResult}
              onVizTypeChange={(type) => handleContentChange({ vizSettings: { ...(localContent!.vizSettings ?? { type: 'table' as const }), type } })}
              onAxisChange={(xCols, yCols) => handleContentChange({ vizSettings: { ...(localContent!.vizSettings ?? { type: 'table' as const }), xCols, yCols } })}
              onMapReady={handleMapReady}
              onSeriesCountChange={setChartSeriesCount}
            />
          ) : (
            <Text fontSize="xs" color="fg.muted" fontFamily="mono" p={3}>No data</Text>
          )}
          </Box>
        </Box>

        {/* Thumbnail strip — only when 2+ charts */}
        {count > 1 && (
          <HStack
            px={1} pb={2} gap={1.5}
            overflowX="auto"
            css={{ scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' } }}
          >
            {successful.map((item, idx) => (
              <Box
                key={idx}
                // role=button (not <button>): the thumbnail embeds QuestionVisualization, which renders
                // its own <button>s — a real <button> here nests buttons (invalid DOM → hydration error).
                role="button"
                tabIndex={0}
                aria-label={`Switch to chart ${idx + 1}: ${item.name}`}
                onClick={() => setActiveIndex(idx)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveIndex(idx); } }}
                flexShrink={0}
                w="120px" h="80px"
                borderRadius="md"
                overflow="hidden"
                border="2px solid"
                borderColor={idx === safeIndex ? 'accent.teal' : 'border.default'}
                bg={idx === safeIndex ? 'accent.teal/5' : 'bg.canvas'}
                opacity={idx === safeIndex ? 1 : 0.7}
                _hover={{ opacity: 1, borderColor: idx === safeIndex ? 'accent.teal' : 'accent.teal/40' }}
                transition="all 0.15s"
                cursor="pointer"
                position="relative"
              >
                {/* Thumbnail label */}
                <Box
                  position="absolute" top={0} left={0} right={0} zIndex={1}
                  bg="bg.canvas/80" px={1} py={0.5}
                >
                  <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" fontWeight="600" truncate>
                    {item.name === 'Query' ? `Q${idx + 1}` : item.name}
                  </Text>
                </Box>
                {/* Miniaturized chart — non-interactive */}
                <Box
                  pointerEvents="none"
                  transform="scale(0.25)"
                  transformOrigin="top left"
                  w="480px" h="320px"
                >
                  <QuestionVisualization
                    currentState={item.question}
                    config={{
                      showHeader: false,
                      showJsonToggle: false,
                      editable: false,
                      viz: {
                        showTypeButtons: false,
                        showChartBuilder: false,
                        typesButtonsOrientation: 'horizontal',
                        showTitle: false,
                      },
                      fixError: false,
                    }}
                    loading={false}
                    error={null}
                    data={item.queryResult}
                    onVizTypeChange={() => {}}
                    onAxisChange={() => {}}
                  />
                </Box>
              </Box>
            ))}
          </HStack>
        )}

      </Box>

    </VStack>
  );
}
