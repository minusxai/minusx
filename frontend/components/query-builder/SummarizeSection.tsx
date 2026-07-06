/**
 * SummarizeSection
 * Shows metrics (aggregations) + "by" + dimensions (group by columns)
 */

'use client';

import { useState, useEffect } from 'react';
import { Box, HStack, Text } from '@chakra-ui/react';
import { SelectColumn, GroupByClause } from '@/lib/types';
import { CompletionsAPI } from '@/lib/data/completions/completions';
import { LuX } from 'react-icons/lu';
import { RawMetricChips } from './RawMetricChips';
import { AggregateMetricsRow } from './AggregateMetricsRow';
import { AddExpressionMetric } from './AddExpressionMetric';
import { DimensionsRow } from './DimensionsRow';

interface SummarizeSectionProps {
  databaseName: string;
  tableName: string;
  tableSchema?: string;
  tableAlias?: string;
  columns: SelectColumn[];
  groupBy?: GroupByClause;
  onColumnsChange: (columns: SelectColumn[]) => void;
  onGroupByChange: (groupBy: GroupByClause | undefined) => void;
  onClose?: () => void;
}

export function SummarizeSection({
  databaseName,
  tableName,
  tableSchema,
  tableAlias,
  columns,
  groupBy,
  onColumnsChange,
  onGroupByChange,
  onClose,
}: SummarizeSectionProps) {
  const [availableColumns, setAvailableColumns] = useState<
    Array<{ name: string; type?: string; displayName: string }>
  >([]);

  useEffect(() => {
    async function loadColumns() {
      if (!tableName || !databaseName) return;

      try {
        const result = await CompletionsAPI.getColumnSuggestions({
          databaseName,
          table: tableName,
          schema: tableSchema,
        });

        if (result.success && result.columns) {
          setAvailableColumns(result.columns);
        }
      } catch (err) {
        console.error('Failed to load columns:', err);
      }
    }

    loadColumns();
  }, [databaseName, tableName, tableSchema]);

  return (
    <Box
      bg="bg.subtle"
      borderRadius="lg"
      border="1px solid"
      borderColor="border.muted"
      p={3}
    >
      <HStack justify="space-between" mb={2.5}>
        <Text fontSize="xs" fontWeight="600" color="fg.muted" textTransform="uppercase" letterSpacing="0.05em" fontFamily="mono">
          Summarize
        </Text>
        {onClose && (
          <Box
            as="button"
            fontSize="xs"
            color="fg.muted"
            opacity={0.6}
            _hover={{ opacity: 1 }}
            onClick={onClose}
          >
            <LuX size={14} />
          </Box>
        )}
      </HStack>

      <HStack gap={2} flexWrap="wrap" align="center">
        <RawMetricChips columns={columns} onColumnsChange={onColumnsChange} />

        <AggregateMetricsRow
          columns={columns}
          onColumnsChange={onColumnsChange}
          availableColumns={availableColumns}
          tableAlias={tableAlias}
        />

        <AddExpressionMetric columns={columns} onColumnsChange={onColumnsChange} />

        <DimensionsRow
          columns={columns}
          onColumnsChange={onColumnsChange}
          groupBy={groupBy}
          onGroupByChange={onGroupByChange}
          availableColumns={availableColumns}
          tableAlias={tableAlias}
        />
      </HStack>
    </Box>
  );
}
