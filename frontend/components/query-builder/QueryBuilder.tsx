/**
 * QueryBuilder
 * Compact, chip-based UI with horizontal sections
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Box, VStack, Spinner, Text, HStack, Button } from '@chakra-ui/react';
import { LuPlay, LuSparkles, LuCode, LuChevronDown, LuChevronRight } from 'react-icons/lu';
import { QueryIR, SelectColumn, TableReference } from '@/lib/types';
import { CompletionsAPI } from '@/lib/data/completions/completions';
import { useAppSelector } from '@/store/hooks';
import { selectShowDebug } from '@/store/uiSlice';
import type { QuestionOption } from '@/lib/hooks/useAvailableQuestions';
import { DataSection } from './DataSection';
import { FilterSection } from './FilterSection';
import { SummarizeSection } from './SummarizeSection';
import { ColumnsSection } from './ColumnsSection';
import { ActionToolbar } from './ActionToolbar';
import { JoinBuilder } from './JoinBuilder';
import { OrderByBuilder } from './OrderByBuilder';

function IRDebugView({ ir }: { ir: QueryIR | null }) {
  const showDebug = useAppSelector(selectShowDebug);
  const [showIRJson, setShowIRJson] = useState(false);

  if (!showDebug) return null;

  return (
    <Box
      bg="bg.subtle"
      borderRadius="lg"
      border="1px solid"
      borderColor="border.muted"
      overflow="hidden"
    >
      <HStack
        as="button"
        width="100%"
        justify="space-between"
        px={3}
        py={2.5}
        cursor="pointer"
        _hover={{ bg: 'bg.muted' }}
        transition="all 0.15s ease"
        onClick={() => setShowIRJson((prev) => !prev)}
      >
        <HStack gap={2}>
          <Box color="fg.muted">
            <LuCode size={14} />
          </Box>
          <Text fontSize="xs" fontWeight="600" color="fg.muted" textTransform="uppercase" letterSpacing="0.05em">
            IR JSON
          </Text>
        </HStack>
        <Box color="fg.muted">
          {showIRJson ? <LuChevronDown size={14} /> : <LuChevronRight size={14} />}
        </Box>
      </HStack>
      {showIRJson && ir && (
        <Box
          px={3}
          pb={3}
          maxH="300px"
          overflowY="auto"
        >
          <Box
            p={3}
            bg="bg.muted"
            borderRadius="md"
            border="1px solid"
            borderColor="border.muted"
          >
            <Text
              as="pre"
              fontSize="xs"
              fontFamily="mono"
              whiteSpace="pre-wrap"
              wordBreak="break-all"
              color="fg.muted"
              lineHeight="1.6"
            >
              {JSON.stringify(ir, null, 2)}
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}

interface QueryBuilderProps {
  databaseName: string;
  sql: string;
  onSqlChange: (sql: string) => void;
  onExecute?: () => void;
  isExecuting?: boolean;
  availableQuestions?: QuestionOption[];
}

export function QueryBuilder({
  databaseName,
  sql,
  onSqlChange,
  onExecute,
  isExecuting = false,
  availableQuestions = [],
}: QueryBuilderProps) {
  const [ir, setIr] = useState<QueryIR | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastSqlSent = useRef<string>('');

  // Dirty tracking for preserving original SQL when unchanged
  const [originalSql, setOriginalSql] = useState<string | null>(null);
  const [originalIR, setOriginalIR] = useState<QueryIR | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  // Panel visibility states
  const [showFilterSection, setShowFilterSection] = useState(false);
  const [showSummarizeSection, setShowSummarizeSection] = useState(false);
  const [showHavingSection, setShowHavingSection] = useState(false);
  const [showJoinPanel, setShowJoinPanel] = useState(false);
  const [showSortPanel, setShowSortPanel] = useState(false);

  // Load IR from SQL when it changes externally
  useEffect(() => {
    async function loadIR() {
      // Skip if SQL hasn't changed (but allow first initialization)
      if (sql === lastSqlSent.current && ir !== null) {
        // SQL hasn't changed - ensure loading is false and exit
        setLoading(false);
        return;
      }

      if (!sql.trim()) {
        setIr({
          version: 1,
          select: [],
          from: { table: '' },
        });
        setLoading(false);
        lastSqlSent.current = sql; // Mark as processed to prevent regeneration
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const result = await CompletionsAPI.sqlToIR({ sql });
        console.log("[result]", result);
        if (result.ir) {
            setIr(result.ir);
        }
        if (result.success && result.ir) {
          lastSqlSent.current = sql;

          // Store original SQL and IR for dirty tracking
          setOriginalSql(sql);
          setOriginalIR(JSON.parse(JSON.stringify(result.ir))); // Deep clone
          setIsDirty(false);

          // Show sections if they have content
          if (result.ir.where && result.ir.where.conditions.length > 0) {
            setShowFilterSection(true);
          }
          if (result.ir.select.some((c) => c.type === 'aggregate')) {
            setShowSummarizeSection(true);
          }
          if (result.ir.having && result.ir.having.conditions.length > 0) {
            setShowHavingSection(true);
          }
          if (result.ir.joins && result.ir.joins.length > 0) {
            setShowJoinPanel(true);
          }
          if (result.ir.order_by && result.ir.order_by.length > 0) {
            setShowSortPanel(true);
          }
        } else {
          setError(result.error || 'Failed to parse SQL');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }

    loadIR();
  }, [sql]);

  // Generate SQL whenever IR changes (debounced)
  useEffect(() => {
    if (!ir) return;

    // Don't generate SQL for empty IR (no table selected)
    // This prevents unwanted SQL changes when switching to GUI mode with empty/whitespace SQL
    if (!ir.from.table) return;

    const timeoutId = setTimeout(async () => {
      try {
        // Deep serialize for stable comparison (sorts keys at all levels)
        const deepSerialize = (obj: unknown): string => {
          if (obj === null || obj === undefined) return String(obj);
          if (typeof obj !== 'object') return JSON.stringify(obj);
          if (Array.isArray(obj)) {
            return '[' + obj.map(deepSerialize).join(',') + ']';
          }
          const keys = Object.keys(obj as Record<string, unknown>).sort();
          return '{' + keys.map(k => `${JSON.stringify(k)}:${deepSerialize((obj as Record<string, unknown>)[k])}`).join(',') + '}';
        };

        const dirty = originalIR ? deepSerialize(ir) !== deepSerialize(originalIR) : true;
        setIsDirty(dirty);

        // If not dirty and we have original SQL, use it
        if (!dirty && originalSql) {
          if (originalSql !== lastSqlSent.current) {
            lastSqlSent.current = originalSql;
            onSqlChange(originalSql);
          }
          return;
        }

        // Otherwise, generate new SQL from IR
        const result = await CompletionsAPI.irToSql({ ir: ir! });

        if (result.success && result.sql) {
          if (result.sql !== lastSqlSent.current) {
            lastSqlSent.current = result.sql;
            onSqlChange(result.sql);
          }
        }
      } catch (err) {
        console.error('[QueryBuilder] Failed to generate SQL:', err);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [ir, onSqlChange, originalIR, originalSql]);

  const handleFromTableChange = useCallback((table: TableReference) => {
    setIr((prev) => (prev ? { ...prev, from: table } : null));
  }, []);

  const handleColumnsChange = useCallback((columns: SelectColumn[]) => {
    setIr((prev) => (prev ? { ...prev, select: columns } : null));
  }, []);

  const handleLimitChange = useCallback((limit: number | undefined) => {
    setIr((prev) => (prev ? { ...prev, limit } : null));
  }, []);

  const handleJoinsChange = useCallback((joins: QueryIR['joins']) => {
    setIr((prev) => (prev ? { ...prev, joins } : null));
  }, []);

  const handleWhereChange = useCallback((where: QueryIR['where']) => {
    setIr((prev) => (prev ? { ...prev, where } : null));
  }, []);

  const handleGroupByChange = useCallback((group_by: QueryIR['group_by']) => {
    setIr((prev) => (prev ? { ...prev, group_by } : null));
  }, []);

  const handleOrderByChange = useCallback((order_by: QueryIR['order_by']) => {
    setIr((prev) => (prev ? { ...prev, order_by } : null));
  }, []);

  const handleHavingChange = useCallback((having: QueryIR['having']) => {
    setIr((prev) => (prev ? { ...prev, having } : null));
  }, []);

  // Action handlers for toolbar
  const handleFilterClick = useCallback(() => {
    setShowFilterSection((prev) => !prev);
  }, []);

  const handleSummarizeClick = useCallback(() => {
    setShowSummarizeSection((prev) => !prev);
  }, []);

  const handleJoinClick = useCallback(() => {
    setShowJoinPanel((prev) => !prev);
  }, []);

  const handleSortClick = useCallback(() => {
    setShowSortPanel((prev) => !prev);
  }, []);

  const handleHavingClick = useCallback(() => {
    setShowHavingSection((prev) => !prev);
  }, []);

  // Close handlers for sections
  const handleFilterClose = useCallback(() => {
    setShowFilterSection(false);
    setIr((prev) => (prev ? { ...prev, where: undefined } : null));
  }, []);

  const handleSummarizeClose = useCallback(() => {
    setShowSummarizeSection(false);
    // Remove all aggregate columns and group by
    setIr((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        select: prev.select.filter((c) => c.type !== 'aggregate'),
        group_by: undefined,
      };
    });
  }, []);

  const handleHavingClose = useCallback(() => {
    setShowHavingSection(false);
    setIr((prev) => (prev ? { ...prev, having: undefined } : null));
  }, []);

  const handleSortClose = useCallback(() => {
    setShowSortPanel(false);
    setIr((prev) => (prev ? { ...prev, order_by: undefined } : null));
  }, []);

  const handleJoinClose = useCallback(() => {
    setShowJoinPanel(false);
    setIr((prev) => (prev ? { ...prev, joins: undefined } : null));
  }, []);

  // Loading state
  if (loading) {
    return (
      <Box p={4}>
        <HStack gap={3}>
          <Spinner size="sm" color="blue.400" />
          <Text fontSize="sm" color="fg.muted">
            Loading query builder...
          </Text>
        </HStack>
        <IRDebugView ir={ir} />
      </Box>
    );
  }

  // Error state
  if (error) {
    return (
      <Box p={4}>
        <VStack align="start" gap={2}>
          <Text fontSize="sm" color="red.400">
            {error}
          </Text>
          <Text fontSize="xs" color="fg.muted">
            This query cannot be edited in GUI mode. Switch to SQL mode to edit.
          </Text>
        </VStack>
        <IRDebugView ir={ir} />
      </Box>
    );
  }

  // Empty state - no table selected
  if (!ir || !ir.from.table) {
    return (
      <Box p={4}>
        <VStack align="stretch" gap={4}>
          <HStack gap={2}>
            <LuSparkles size={16} />
            <Text fontSize="sm" color="fg.muted">
              Start by selecting a table to query
            </Text>
          </HStack>
          {ir && (
            <DataSection
              databaseName={databaseName}
              value={ir.from}
              onChange={handleFromTableChange}
              availableQuestions={availableQuestions}
            />
          )}
          <IRDebugView ir={ir} />
        </VStack>
      </Box>
    );
  }

  // Calculate state for toolbar
  const existingTables = [
    ir.from.alias || ir.from.table,
    ...(ir.joins || []).map((j) => j.table.alias || j.table.table),
  ];

  const hasFilter = !!ir.where && ir.where.conditions.length > 0;
  const hasSummarize = ir.select.some((c) => c.type === 'aggregate');
  const hasHaving = !!ir.having && ir.having.conditions.length > 0;
  const hasJoin = !!ir.joins && ir.joins.length > 0;
  const hasSort = !!ir.order_by && ir.order_by.length > 0;

  return (
    <Box>
      <VStack align="stretch" gap={3} p={4}>
        {/* Data Section - Table selection */}
        <DataSection
          databaseName={databaseName}
          value={ir.from}
          onChange={handleFromTableChange}
          availableQuestions={availableQuestions}
        />

        {/* Join Section - right after table selection */}
        {showJoinPanel && (
          <JoinBuilder
            databaseName={databaseName}
            joins={ir.joins || []}
            onChange={handleJoinsChange}
            fromTable={ir.from}
            existingTables={existingTables}
            onClose={handleJoinClose}
          />
        )}

        {/* Columns Section - SELECT columns for non-aggregate queries */}
        {!showSummarizeSection && (
          <ColumnsSection
            databaseName={databaseName}
            tableName={ir.from.table}
            tableSchema={ir.from.schema}
            columns={ir.select}
            onChange={handleColumnsChange}
          />
        )}

        {/* Filter Section - WHERE clause as chips */}
        {showFilterSection && (
          <FilterSection
            databaseName={databaseName}
            tableName={ir.from.table}
            tableSchema={ir.from.schema}
            filter={ir.where}
            onChange={handleWhereChange}
            onClose={handleFilterClose}
          />
        )}

        {/* Summarize Section - SELECT aggregates + GROUP BY */}
        {showSummarizeSection && (
          <SummarizeSection
            databaseName={databaseName}
            tableName={ir.from.table}
            tableSchema={ir.from.schema}
            tableAlias={ir.from.alias}
            columns={ir.select}
            groupBy={ir.group_by}
            onColumnsChange={handleColumnsChange}
            onGroupByChange={handleGroupByChange}
            onClose={handleSummarizeClose}
          />
        )}

        {/* Having Section - HAVING clause for aggregates */}
        {showHavingSection && (
          <FilterSection
            databaseName={databaseName}
            tableName={ir.from.table}
            tableSchema={ir.from.schema}
            filter={ir.having}
            onChange={handleHavingChange}
            onClose={handleHavingClose}
            label="HAVING"
            filterType="having"
          />
        )}

        {/* Sort Section */}
        {showSortPanel && (
          <OrderByBuilder
            databaseName={databaseName}
            tableName={ir.from.table}
            tableSchema={ir.from.schema}
            orderBy={ir.order_by}
            onChange={handleOrderByChange}
            onClose={handleSortClose}
          />
        )}

        {/* Action Toolbar */}
        <ActionToolbar
          onFilterClick={handleFilterClick}
          onSummarizeClick={handleSummarizeClick}
          onHavingClick={handleHavingClick}
          onJoinClick={handleJoinClick}
          onSortClick={handleSortClick}
          onLimitChange={handleLimitChange}
          currentLimit={ir.limit}
          hasFilter={hasFilter || showFilterSection}
          hasSummarize={hasSummarize || showSummarizeSection}
          hasHaving={hasHaving || showHavingSection}
          hasJoin={hasJoin || showJoinPanel}
          hasSort={hasSort || showSortPanel}
        />

        {/* Visualize Button */}
        {onExecute && (
          <Button
            onClick={onExecute}
            size="lg"
            loading={isExecuting}
            loadingText="Running..."
            width="full"
            bg="accent.teal"
            color="white"
            _hover={{
              opacity: 0.9,
              transform: 'translateY(-1px)',
            }}
            transition="all 0.2s ease"
            fontWeight="600"
            letterSpacing="0.02em"
          >
            <LuPlay size={18} fill="white"/>
            <Text ml={2}>Execute</Text>
          </Button>
        )}

        {/* IR JSON Debug View - only visible when showDebug is enabled in settings */}
        <IRDebugView ir={ir} />
      </VStack>
    </Box>
  );
}
