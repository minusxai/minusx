/**
 * CompoundQueryBuilder
 * Renders multiple QueryBuilder blocks connected by UNION / UNION ALL operators.
 * Handles compound-level ORDER BY and LIMIT.
 */

'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Box, VStack, HStack, Text, Button, Spinner } from '@chakra-ui/react';
import { LuPlus, LuX, LuPlay } from 'react-icons/lu';
import type { CompoundQueryIR, CompoundOperator, QueryIR, OrderByClause } from '@/lib/types';
import { CompletionsAPI } from '@/lib/data/completions/completions';
import { QueryBuilder } from './QueryBuilder';
import { OrderByBuilder } from './OrderByBuilder';
import type { QuestionOption } from '@/lib/hooks/useAvailableQuestions';

interface CompoundQueryBuilderProps {
  databaseName: string;
  ir: CompoundQueryIR;
  onIRChange: (ir: CompoundQueryIR) => void;
  onExecute?: () => void;
  isExecuting?: boolean;
  availableQuestions?: QuestionOption[];
}

function OperatorSelector({
  value,
  onChange,
}: {
  value: CompoundOperator;
  onChange: (op: CompoundOperator) => void;
}) {
  return (
    <HStack justify="center" py={1}>
      <HStack
        bg="bg.subtle"
        borderRadius="full"
        border="1px solid"
        borderColor="border.muted"
        p={0.5}
        gap={0}
      >
        {(['UNION', 'UNION ALL'] as CompoundOperator[]).map((op) => (
          <Box
            key={op}
            as="button"
            px={3}
            py={1}
            borderRadius="full"
            fontSize="xs"
            fontWeight="600"
            letterSpacing="0.05em"
            bg={value === op ? 'accent.teal' : 'transparent'}
            color={value === op ? 'white' : 'fg.muted'}
            cursor="pointer"
            transition="all 0.15s ease"
            _hover={value === op ? {} : { bg: 'bg.muted' }}
            onClick={() => onChange(op)}
          >
            {op}
          </Box>
        ))}
      </HStack>
    </HStack>
  );
}

export function CompoundQueryBuilder({
  databaseName,
  ir,
  onIRChange,
  onExecute,
  isExecuting = false,
  availableQuestions = [],
}: CompoundQueryBuilderProps) {
  // Track per-query SQL for converting individual QueryIR changes back to SQL
  const [querySqls, setQuerySqls] = useState<string[]>(() => ir.queries.map(() => ''));
  const lastIrRef = useRef(ir);

  // When ir prop changes (from parent), regenerate SQL for each query
  useEffect(() => {
    if (ir === lastIrRef.current) return;
    lastIrRef.current = ir;

    async function regenerateSqls() {
      const sqls = await Promise.all(
        ir.queries.map(async (q) => {
          try {
            const result = await CompletionsAPI.irToSql({ ir: q });
            return result.success && result.sql ? result.sql : '';
          } catch {
            return '';
          }
        })
      );
      setQuerySqls(sqls);
    }

    regenerateSqls();
  }, [ir]);

  const handleQuerySqlChange = useCallback(
    (index: number, sql: string) => {
      setQuerySqls((prev) => {
        const next = [...prev];
        next[index] = sql;
        return next;
      });

      // Parse the SQL back to IR and update the compound query
      CompletionsAPI.sqlToIR({ sql }).then((result) => {
        if (result.success && result.ir && result.ir.type !== 'compound') {
          const queryIR = result.ir as QueryIR;
          onIRChange({
            ...ir,
            queries: ir.queries.map((q, i) => (i === index ? queryIR : q)),
          });
        }
      });
    },
    [ir, onIRChange]
  );

  const handleOperatorChange = useCallback(
    (index: number, op: CompoundOperator) => {
      onIRChange({
        ...ir,
        operators: ir.operators.map((o, i) => (i === index ? op : o)),
      });
    },
    [ir, onIRChange]
  );

  const handleAddQuery = useCallback(() => {
    const emptyQuery: QueryIR = {
      type: 'simple',
      version: 1,
      select: [],
      from: { table: '' },
    };
    onIRChange({
      ...ir,
      queries: [...ir.queries, emptyQuery],
      operators: [...ir.operators, 'UNION ALL'],
    });
    setQuerySqls((prev) => [...prev, '']);
  }, [ir, onIRChange]);

  const handleRemoveQuery = useCallback(
    (index: number) => {
      if (ir.queries.length <= 2) return; // Minimum 2 queries
      const newQueries = ir.queries.filter((_, i) => i !== index);
      // Remove the operator: if removing first query, remove operator[0];
      // otherwise remove operator[index - 1]
      const opIndex = index === 0 ? 0 : index - 1;
      const newOperators = ir.operators.filter((_, i) => i !== opIndex);
      onIRChange({
        ...ir,
        queries: newQueries,
        operators: newOperators,
      });
      setQuerySqls((prev) => prev.filter((_, i) => i !== index));
    },
    [ir, onIRChange]
  );

  const handleOrderByChange = useCallback(
    (order_by: OrderByClause[] | undefined) => {
      onIRChange({ ...ir, order_by });
    },
    [ir, onIRChange]
  );

  const handleLimitChange = useCallback(
    (limit: number | undefined) => {
      onIRChange({ ...ir, limit });
    },
    [ir, onIRChange]
  );

  // Use the first query's table for ORDER BY column suggestions
  const firstQuery = ir.queries[0];

  return (
    <Box>
      <VStack align="stretch" gap={0} p={4}>
        {ir.queries.map((query, index) => (
          <Box key={index}>
            {/* Query block */}
            <Box
              position="relative"
              border="1px solid"
              borderColor="border.muted"
              borderRadius="lg"
              overflow="hidden"
            >
              {/* Remove button (only when 3+ queries) */}
              {ir.queries.length > 2 && (
                <Box
                  as="button"
                  position="absolute"
                  top={2}
                  right={2}
                  zIndex={1}
                  p={1}
                  borderRadius="full"
                  bg="bg.subtle"
                  color="fg.muted"
                  cursor="pointer"
                  _hover={{ bg: 'bg.muted', color: 'fg.default' }}
                  onClick={() => handleRemoveQuery(index)}
                >
                  <LuX size={14} />
                </Box>
              )}

              <QueryBuilder
                databaseName={databaseName}
                sql={querySqls[index] || ''}
                onSqlChange={(sql) => handleQuerySqlChange(index, sql)}
                availableQuestions={availableQuestions}
                isCompoundMember
              />
            </Box>

            {/* Operator selector between queries */}
            {index < ir.queries.length - 1 && (
              <OperatorSelector
                value={ir.operators[index]}
                onChange={(op) => handleOperatorChange(index, op)}
              />
            )}
          </Box>
        ))}

        {/* Add query button */}
        <HStack justify="center" pt={2}>
          <Button
            size="sm"
            variant="outline"
            onClick={handleAddQuery}
            borderStyle="dashed"
            color="fg.muted"
            _hover={{ color: 'fg.default', borderColor: 'border.default' }}
          >
            <LuPlus size={14} />
            <Text ml={1}>Add query</Text>
          </Button>
        </HStack>

        {/* Compound-level ORDER BY */}
        {(ir.order_by && ir.order_by.length > 0) && (
          <OrderByBuilder
            databaseName={databaseName}
            tableName={firstQuery?.from?.table || ''}
            tableSchema={firstQuery?.from?.schema}
            orderBy={ir.order_by}
            onChange={handleOrderByChange}
            onClose={() => handleOrderByChange(undefined)}
          />
        )}

        {/* Execute Button */}
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
            mt={2}
          >
            <LuPlay size={18} fill="white" />
            <Text ml={2}>Execute</Text>
          </Button>
        )}
      </VStack>
    </Box>
  );
}
