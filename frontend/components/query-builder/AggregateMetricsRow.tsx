/**
 * AggregateMetricsRow
 * Renders aggregate metric chips (COUNT/SUM/AVG/...), their edit popover,
 * and the "add metric" popover. Extracted from SummarizeSection.
 */

'use client';

import { useState, useCallback } from 'react';
import { Box, HStack, Text, SimpleGrid, Input } from '@chakra-ui/react';
import { SelectColumn } from '@/lib/types';
import { QueryChip, AddChipButton, getColumnIcon } from './QueryChip';
import { PickerPopover, PickerList, PickerItem } from './PickerPopover';
import { AliasInput } from './AliasInput';
import { LuSigma } from 'react-icons/lu';
import { Checkbox } from '@/components/ui/checkbox';

const AGGREGATES = [
  { label: 'Count', shortLabel: 'Count', value: 'COUNT' },
  { label: 'Sum', shortLabel: 'Sum', value: 'SUM' },
  { label: 'Average', shortLabel: 'Avg', value: 'AVG' },
  { label: 'Min', shortLabel: 'Min', value: 'MIN' },
  { label: 'Max', shortLabel: 'Max', value: 'MAX' },
  { label: 'Count distinct', shortLabel: 'Cnt Dist', value: 'COUNT_DISTINCT' },
];

interface AggregateMetricsRowProps {
  columns: SelectColumn[];
  onColumnsChange: (columns: SelectColumn[]) => void;
  availableColumns: Array<{ name: string; type?: string; displayName: string }>;
  tableAlias?: string;
}

export function AggregateMetricsRow({
  columns,
  onColumnsChange,
  availableColumns,
  tableAlias,
}: AggregateMetricsRowProps) {
  const [addMetricOpen, setAddMetricOpen] = useState(false);
  const [editingMetricIndex, setEditingMetricIndex] = useState<number | null>(null);
  const [selectedAgg, setSelectedAgg] = useState<string>('COUNT');
  const [editAlias, setEditAlias] = useState('');
  const [wrapWithRound, setWrapWithRound] = useState(false);
  const [roundDecimals, setRoundDecimals] = useState(2);

  // Separate metrics (aggregates) from regular columns
  const metrics = columns.filter((c) => c.type === 'aggregate');

  const handleAddMetric = useCallback(
    (columnName: string) => {
      const newColumn: SelectColumn = {
        type: 'aggregate',
        aggregate: selectedAgg as 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'COUNT_DISTINCT',
        column: columnName === '*' ? '*' : columnName,
        table: columnName === '*' ? undefined : tableAlias,
        alias: `${selectedAgg.toLowerCase()}_${columnName === '*' ? 'all' : columnName}`,
      };

      onColumnsChange([...columns, newColumn]);
      setAddMetricOpen(false);
    },
    [selectedAgg, columns, onColumnsChange, tableAlias]
  );

  const handleUpdateMetric = useCallback(
    (columnName: string) => {
      if (editingMetricIndex === null) return;

      const metricIndices = columns
        .map((c, i) => (c.type === 'aggregate' ? i : -1))
        .filter((i) => i !== -1);
      const actualIndex = metricIndices[editingMetricIndex];

      const autoAlias = `${selectedAgg.toLowerCase()}_${columnName === '*' ? 'all' : columnName}`;
      const finalAlias = editAlias.trim() || autoAlias;

      const newColumns = [...columns];
      newColumns[actualIndex] = {
        type: 'aggregate',
        aggregate: selectedAgg as 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'COUNT_DISTINCT',
        column: columnName === '*' ? '*' : columnName,
        table: columnName === '*' ? undefined : tableAlias,
        alias: finalAlias,
        wrapper_function: wrapWithRound ? 'ROUND' : undefined,
        wrapper_args: wrapWithRound ? [roundDecimals] : undefined,
      };

      onColumnsChange(newColumns);
      setEditingMetricIndex(null);
      setEditAlias('');
    },
    [editingMetricIndex, selectedAgg, editAlias, wrapWithRound, roundDecimals, columns, onColumnsChange, tableAlias]
  );

  // Update metric aggregate immediately (when changing function dropdown)
  const handleAggregateChange = useCallback(
    (newAgg: string) => {
      setSelectedAgg(newAgg);

      if (editingMetricIndex === null) return;

      const metric = metrics[editingMetricIndex];
      if (!metric) return;

      const metricIndices = columns
        .map((c, i) => (c.type === 'aggregate' ? i : -1))
        .filter((i) => i !== -1);
      const actualIndex = metricIndices[editingMetricIndex];

      const columnName = metric.column || '*';
      const autoAlias = `${newAgg.toLowerCase()}_${columnName === '*' ? 'all' : columnName}`;
      // Keep custom alias if user set one, otherwise regenerate
      const currentAutoAlias = `${metric.aggregate?.toLowerCase()}_${columnName === '*' ? 'all' : columnName}`;
      const hasCustomAlias = metric.alias && metric.alias !== currentAutoAlias;
      const finalAlias = hasCustomAlias ? metric.alias : autoAlias;

      const newColumns = [...columns];
      newColumns[actualIndex] = {
        type: 'aggregate',
        aggregate: newAgg as 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'COUNT_DISTINCT',
        column: columnName,
        table: metric.table,
        alias: finalAlias,
      };

      onColumnsChange(newColumns);
      setEditAlias(finalAlias || '');
    },
    [editingMetricIndex, metrics, columns, onColumnsChange]
  );

  const handleRemoveMetric = useCallback(
    (index: number) => {
      const metricIndices = columns
        .map((c, i) => (c.type === 'aggregate' ? i : -1))
        .filter((i) => i !== -1);
      const actualIndex = metricIndices[index];
      onColumnsChange(columns.filter((_, i) => i !== actualIndex));
    },
    [columns, onColumnsChange]
  );

  const handleEditMetric = useCallback((index: number) => {
    const metric = metrics[index];
    if (!metric) return;

    setSelectedAgg(metric.aggregate || 'COUNT');
    setEditAlias(metric.alias || '');
    setWrapWithRound(metric.wrapper_function === 'ROUND');
    setRoundDecimals((metric.wrapper_args?.[0] as number) ?? 2);
    setEditingMetricIndex(index);
  }, [metrics]);

  const formatMetricLabel = (col: SelectColumn) => {
    const aggLabel = AGGREGATES.find((a) => a.value === col.aggregate)?.shortLabel || col.aggregate;
    const isStarOrNull = col.column === '*' || col.column == null;
    const alias = col.alias || `${col.aggregate?.toLowerCase()}_${isStarOrNull ? 'all' : col.column}`;
    const inner = isStarOrNull ? aggLabel : `${aggLabel}(${col.column})`;
    const withWrapper = col.wrapper_function === 'ROUND'
      ? `ROUND(${inner}${col.wrapper_args?.length ? `, ${col.wrapper_args[0]}` : ''})`
      : inner;
    return `${withWrapper} as ${alias}`;
  };

  return (
    <>
      {/* Metrics */}
      {metrics.map((metric, idx) => (
        <PickerPopover
          key={`metric-${idx}`}
          open={editingMetricIndex === idx}
          onOpenChange={(details) => {
            if (!details.open) {
              setEditingMetricIndex(null);
            }
          }}
          trigger={
            <Box>
              <QueryChip
                variant="metric"
                icon={<LuSigma size={11} />}
                onRemove={() => handleRemoveMetric(idx)}
                onClick={() => handleEditMetric(idx)}
                isActive={editingMetricIndex === idx}
              >
                {formatMetricLabel(metric)}
              </QueryChip>
            </Box>
          }
          padding={3}
        >
          <HStack justify="space-between" align="center" mb={2.5}>
            <Text fontSize="xs" fontWeight="600" color="fg.muted" textTransform="uppercase" letterSpacing="0.05em" fontFamily="mono">
              Edit metric
            </Text>
            <HStack gap={1.5} align="center">
              <Text fontSize="xs" color="fg.muted" fontFamily="mono">as</Text>
              <AliasInput
                value={editAlias}
                onChange={(alias) => setEditAlias(alias || '')}
                placeholder="alias"
              />
            </HStack>
          </HStack>
          <SimpleGrid columns={3} gap={1.5} mb={1}>
            {AGGREGATES.map((agg) => (
              <Box
                key={agg.value}
                as="button"
                py={1.5}
                borderRadius="md"
                fontSize="xs"
                fontWeight="600"
                textAlign="center"
                whiteSpace="nowrap"
                cursor="pointer"
                bg={selectedAgg === agg.value ? 'accent.teal' : 'bg.subtle'}
                color={selectedAgg === agg.value ? 'white' : 'fg.muted'}
                _hover={{ bg: selectedAgg === agg.value ? 'accent.teal/80' : 'bg.muted' }}
                transition="all 0.15s ease"
                onClick={() => handleAggregateChange(agg.value)}
              >
                {agg.shortLabel}
              </Box>
            ))}
          </SimpleGrid>
          {/* ROUND wrapper toggle */}
          <HStack mt={1.5} gap={2} align="center">
            <Checkbox
              checked={wrapWithRound}
              onCheckedChange={(e) => setWrapWithRound(e.checked === true)}
              size="sm"
            >
              <Text fontSize="xs" color="fg" fontFamily="mono">ROUND</Text>
            </Checkbox>
            {wrapWithRound && (
              <HStack gap={1} align="center">
                <Text fontSize="xs" color="fg.muted" fontFamily="mono">decimals:</Text>
                <Input
                  size="xs"
                  type="number"
                  value={roundDecimals}
                  min={0}
                  max={10}
                  w="48px"
                  onChange={(e) => setRoundDecimals(parseInt(e.target.value) || 0)}
                />
              </HStack>
            )}
          </HStack>

          <Box borderTop="1px solid" borderColor="border.muted" mt={1} mx={-3} px={3} pt={2}>
            <PickerList maxH="200px" searchable searchPlaceholder="Search columns...">
              {(query) => [
                !query && (
                  <PickerItem
                    key="*"
                    selected={metric.column === '*'}
                    selectedBg="rgba(134, 239, 172, 0.15)"
                    onClick={() => handleUpdateMetric('*')}
                  >
                    * (all rows)
                  </PickerItem>
                ),
                ...availableColumns
                  .filter((col) => !query || col.name.toLowerCase().includes(query.toLowerCase()))
                  .map((col) => (
                    <PickerItem
                      key={col.name}
                      icon={getColumnIcon(col.type)}
                      selected={metric.column === col.name}
                      selectedBg="rgba(134, 239, 172, 0.15)"
                      onClick={() => handleUpdateMetric(col.name)}
                    >
                      {col.name}
                    </PickerItem>
                  )),
              ]}
            </PickerList>
          </Box>
        </PickerPopover>
      ))}

      {/* Add metric popover */}
      <PickerPopover
        open={addMetricOpen && editingMetricIndex === null}
        onOpenChange={(details) => setAddMetricOpen(details.open)}
        trigger={
          <Box>
            <AddChipButton onClick={() => setAddMetricOpen(true)} variant="metric" />
          </Box>
        }
        padding={3}
      >
        <Text fontSize="xs" fontWeight="600" color="fg.muted" textTransform="uppercase" letterSpacing="0.05em" mb={2.5} fontFamily="mono">
          Add metric
        </Text>
        <SimpleGrid columns={3} gap={1.5} mb={1}>
          {AGGREGATES.map((agg) => (
            <Box
              key={agg.value}
              as="button"
              py={1.5}
              borderRadius="md"
              fontSize="xs"
              fontWeight="600"
              textAlign="center"
              whiteSpace="nowrap"
              cursor="pointer"
              bg={selectedAgg === agg.value ? 'accent.teal' : 'bg.subtle'}
              color={selectedAgg === agg.value ? 'white' : 'fg.muted'}
              _hover={{ bg: selectedAgg === agg.value ? 'accent.teal/80' : 'bg.muted' }}
              transition="all 0.15s ease"
              onClick={() => setSelectedAgg(agg.value)}
            >
              {agg.shortLabel}
            </Box>
          ))}
        </SimpleGrid>
        <Box borderTop="1px solid" borderColor="border.muted" mt={1} mx={-3} px={3} pt={2}>
          <PickerList maxH="200px" searchable searchPlaceholder="Search columns...">
            {(query) => [
              !query && (
                <PickerItem key="*" onClick={() => handleAddMetric('*')}>
                  * (all rows)
                </PickerItem>
              ),
              ...availableColumns
                .filter((col) => !query || col.name.toLowerCase().includes(query.toLowerCase()))
                .map((col) => (
                  <PickerItem
                    key={col.name}
                    icon={getColumnIcon(col.type)}
                    onClick={() => handleAddMetric(col.name)}
                  >
                    {col.name}
                  </PickerItem>
                )),
            ]}
          </PickerList>
        </Box>
      </PickerPopover>
    </>
  );
}
