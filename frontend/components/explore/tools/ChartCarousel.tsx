'use client';

import { useState, useMemo, useRef } from 'react';
import { Box, HStack, VStack, Text, Icon } from '@chakra-ui/react';
import { LuChevronLeft, LuChevronRight, LuChevronDown, LuChevronUp, LuDatabase, LuX, LuCode, LuCheck } from 'react-icons/lu';
import type { MessageWithFlags } from '../message/messageHelpers';
import type { QuestionContent, QueryResult, ExecuteQueryDetails } from '@/lib/types';
import { contentToDetails } from '@/lib/types';
import { QuestionVisualization } from '@/components/question/QuestionVisualization';
import SqlEditor from '@/components/SqlEditor';
import { QueryBuilderRoot, QueryModeSelector } from '@/components/query-builder';
import { connectionTypeToDialect } from '@/lib/utils/connection-dialect';

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
  /** Label for the header (default: "queries") */
  label?: string;
}

// ─── ExecuteQuery message parser ─────────────────────────────────

function parseQueryMessage(msg: MessageWithFlags, databaseName: string): ChartItem | ChartErrorItem {
  const toolMsg = msg as any;
  const args = toolMsg.function?.arguments;
  let parsed: any = {};
  try {
    parsed = typeof args === 'string' ? JSON.parse(args) : args || {};
  } catch { /* ignore */ }

  const name = parsed.name || parsed.query?.slice(0, 40) || 'Query';

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
  const [showQuery, setShowQuery] = useState(false);
  const [queryMode, setQueryMode] = useState<'sql' | 'gui'>('sql');

  const count = successful.length;
  const safeIndex = Math.min(activeIndex, Math.max(0, count - 1));
  const current = successful[safeIndex] ?? null;

  const [localContent, setLocalContent] = useState<QuestionContent | null>(current?.question ?? null);
  const prevQuestionRef = useRef(current?.question);
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
  const displayLabel = label || (totalCount === 1 ? 'query' : 'queries');

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

  return (
    <VStack gap={0} align="stretch">
      {/* Top bar */}
      <HStack justify="space-between" px={3} pt={2} pb={1}>
        <HStack gap={1.5}>
          <Icon as={LuDatabase} boxSize={3} color="fg.muted" />
          <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" fontWeight="600" textTransform="uppercase">
            {totalCount} {displayLabel}
            {failedCount > 0 && ` (${failedCount} failed)`}
          </Text>
        </HStack>

        {/* Dot navigation */}
        {count > 1 && (
          <HStack gap={1.5}>
            <Box
              as="button"
              aria-label="Previous chart"
              onClick={() => safeIndex > 0 && setActiveIndex(safeIndex - 1)}
              w="20px" h="20px" borderRadius="full" bg="accent.teal/15" color="accent.teal"
              display="flex" alignItems="center" justifyContent="center"
              cursor={safeIndex === 0 ? 'default' : 'pointer'}
              opacity={safeIndex === 0 ? 0.3 : 1}
              _hover={safeIndex === 0 ? {} : { bg: 'accent.teal/25' }}
              transition="all 0.15s"
            >
              <LuChevronLeft size={12} />
            </Box>
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
              as="button"
              aria-label="Next chart"
              onClick={() => safeIndex < count - 1 && setActiveIndex(safeIndex + 1)}
              w="20px" h="20px" borderRadius="full" bg="accent.teal/15" color="accent.teal"
              display="flex" alignItems="center" justifyContent="center"
              cursor={safeIndex === count - 1 ? 'default' : 'pointer'}
              opacity={safeIndex === count - 1 ? 0.3 : 1}
              _hover={safeIndex === count - 1 ? {} : { bg: 'accent.teal/25' }}
              transition="all 0.15s"
            >
              <LuChevronRight size={12} />
            </Box>
          </HStack>
        )}

        <HStack
          gap={1}
          cursor="pointer"
          onClick={() => setShowQuery(!showQuery)}
          color="fg.subtle"
          _hover={{ color: 'fg.default' }}
          transition="color 0.1s"
        >
          <Icon as={LuCode} boxSize={3} />
          <Text fontSize="2xs" fontFamily="mono" fontWeight="500">
            Query
          </Text>
          <Icon as={showQuery ? LuChevronUp : LuChevronDown} boxSize={3} />
        </HStack>
      </HStack>

      {/* Current item name */}
      {current && (
        <HStack px={3} pb={1} gap={1.5}>
          <Icon as={LuCheck} boxSize={2.5} color="accent.success" />
          <Text fontSize="xs" fontFamily="mono" color="fg.default" fontWeight="600" truncate>
            {current.name}
          </Text>
        </HStack>
      )}

      {/* Expandable query editor */}
      {showQuery && current?.question?.query && (
        <Box mx={2} mb={1}>
          <HStack mb={1}>
            <QueryModeSelector
              mode={queryMode}
              onModeChange={setQueryMode}
              canUseGUI
            />
          </HStack>
          <Box borderRadius="md" overflow="hidden">
            {queryMode === 'sql' ? (
              <SqlEditor
                value={current.question.query}
                readOnly
                showRunButton={false}
                showFormatButton={false}
              />
            ) : (
              <QueryBuilderRoot
                databaseName={databaseName}
                dialect={connectionTypeToDialect('')}
                sql={current.question.query}
                onSqlChange={() => {}}
              />
            )}
          </Box>
        </Box>
      )}

      {/* Chart */}
      <Box px={1} pb={2} minH="200px">
        <Box borderRadius="md" overflow="hidden" border="1px solid" borderColor="border.default">
        {localContent && current?.queryResult ? (
          <QuestionVisualization
            currentState={localContent}
            config={{
              showHeader: false,
              showJsonToggle: false,
              editable: false,
              viz: {
                showTypeButtons: true,
                showChartBuilder: true,
                typesButtonsOrientation: 'horizontal',
                showTitle: true,
              },
              fixError: false,
            }}
            loading={false}
            error={null}
            data={current.queryResult}
            onVizTypeChange={(type) => handleContentChange({ vizSettings: { ...localContent!.vizSettings, type } })}
            onAxisChange={(xCols, yCols) => handleContentChange({ vizSettings: { ...localContent!.vizSettings, xCols, yCols } })}
          />
        ) : (
          <Text fontSize="xs" color="fg.muted" fontFamily="mono" p={3}>No data</Text>
        )}
        </Box>
      </Box>
    </VStack>
  );
}
