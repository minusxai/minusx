/**
 * SummarizeSection
 * Shows metrics (aggregations) + "by" + dimensions (group by columns)
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { Box, HStack, Text, VStack, SimpleGrid, Input, Button } from '@chakra-ui/react';
import { SelectColumn, GroupByClause, GroupByItem } from '@/lib/types';
import { CompletionsAPI } from '@/lib/data/completions/completions';
import { QueryChip, AddChipButton, getColumnIcon } from './QueryChip';
import { PickerPopover, PickerHeader, PickerList, PickerItem } from './PickerPopover';
import { AliasInput } from './AliasInput';
import { ExpressionEditor } from './ExpressionEditor';
import { LuSigma, LuX, LuCalendar, LuCode } from 'react-icons/lu';
import { Checkbox } from '@/components/ui/checkbox';

const DATE_TRUNC_UNITS = [
  { label: 'Day', value: 'DAY' },
  { label: 'Week', value: 'WEEK' },
  { label: 'Month', value: 'MONTH' },
  { label: 'Quarter', value: 'QUARTER' },
  { label: 'Year', value: 'YEAR' },
] as const;

type DateTruncUnit = 'DAY' | 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR' | 'HOUR' | 'MINUTE';

const isDateColumn = (type?: string) => {
  if (!type) return false;
  const t = type.toLowerCase();
  return t.includes('date') || t.includes('time') || t.includes('timestamp');
};

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

const AGGREGATES = [
  { label: 'Count', shortLabel: 'Count', value: 'COUNT' },
  { label: 'Sum', shortLabel: 'Sum', value: 'SUM' },
  { label: 'Average', shortLabel: 'Avg', value: 'AVG' },
  { label: 'Min', shortLabel: 'Min', value: 'MIN' },
  { label: 'Max', shortLabel: 'Max', value: 'MAX' },
  { label: 'Count distinct', shortLabel: 'Cnt Dist', value: 'COUNT_DISTINCT' },
];

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
  const [addMetricOpen, setAddMetricOpen] = useState(false);
  const [addDimensionOpen, setAddDimensionOpen] = useState(false);
  const [editingMetricIndex, setEditingMetricIndex] = useState<number | null>(null);
  const [selectedAgg, setSelectedAgg] = useState<string>('COUNT');
  const [editAlias, setEditAlias] = useState('');
  const [wrapWithRound, setWrapWithRound] = useState(false);
  const [roundDecimals, setRoundDecimals] = useState(2);
  // Raw expression editing
  const [editingRawMetricIndex, setEditingRawMetricIndex] = useState<number | null>(null);
  const [editRawSql, setEditRawSql] = useState('');
  const [editRawAlias, setEditRawAlias] = useState('');
  // Add new custom expression metric
  const [addExprOpen, setAddExprOpen] = useState(false);
  const [newExprSql, setNewExprSql] = useState('');
  const [newExprAlias, setNewExprAlias] = useState('');
  // For date column truncation selection
  const [selectedDateColumn, setSelectedDateColumn] = useState<{ name: string; type?: string } | null>(null);
  // For editing dimensions
  const [editingDimensionIndex, setEditingDimensionIndex] = useState<number | null>(null);
  // For editing raw expression dimensions
  const [editingRawDimIndex, setEditingRawDimIndex] = useState<number | null>(null);
  const [editRawDimSql, setEditRawDimSql] = useState('');

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

  // Separate metrics (aggregates) from regular columns
  const metrics = columns.filter((c) => c.type === 'aggregate');
  const rawMetrics = columns.filter((c) => c.type === 'raw');
  const dimensions = groupBy?.columns || [];

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

  const handleRemoveRawMetric = useCallback(
    (rawIndex: number) => {
      const rawIndices = columns
        .map((c, i) => (c.type === 'raw' ? i : -1))
        .filter((i) => i !== -1);
      const actualIndex = rawIndices[rawIndex];
      onColumnsChange(columns.filter((_, i) => i !== actualIndex));
    },
    [columns, onColumnsChange]
  );

  const handleAddExprMetric = useCallback(() => {
    if (!newExprSql.trim()) return;
    const newCol: SelectColumn = {
      type: 'raw',
      raw_sql: newExprSql.trim(),
      alias: newExprAlias.trim() || undefined,
    };
    onColumnsChange([...columns, newCol]);
    setNewExprSql('');
    setNewExprAlias('');
    setAddExprOpen(false);
  }, [newExprSql, newExprAlias, columns, onColumnsChange]);

  const handleOpenRawMetricEdit = useCallback((idx: number) => {
    const metric = rawMetrics[idx];
    if (!metric) return;
    setEditRawSql(metric.raw_sql || '');
    setEditRawAlias(metric.alias || '');
    setEditingRawMetricIndex(idx);
  }, [rawMetrics]);

  const handleSaveRawMetric = useCallback(() => {
    if (editingRawMetricIndex === null) return;
    const rawIndices = columns
      .map((c, i) => (c.type === 'raw' ? i : -1))
      .filter((i) => i !== -1);
    const actualIndex = rawIndices[editingRawMetricIndex];
    const newColumns = [...columns];
    newColumns[actualIndex] = {
      ...newColumns[actualIndex],
      raw_sql: editRawSql.trim(),
      alias: editRawAlias.trim() || undefined,
    };
    onColumnsChange(newColumns);
    setEditingRawMetricIndex(null);
  }, [editingRawMetricIndex, editRawSql, editRawAlias, columns, onColumnsChange]);

  const handleEditMetric = useCallback((index: number) => {
    const metric = metrics[index];
    if (!metric) return;

    setSelectedAgg(metric.aggregate || 'COUNT');
    setEditAlias(metric.alias || '');
    setWrapWithRound(metric.wrapper_function === 'ROUND');
    setRoundDecimals((metric.wrapper_args?.[0] as number) ?? 2);
    setEditingMetricIndex(index);
  }, [metrics]);

  const handleAddDimension = useCallback(
    (columnName: string, truncUnit?: DateTruncUnit) => {
      let newGroupByColumn: GroupByItem;
      let newSelectColumn: SelectColumn;

      if (truncUnit) {
        // DATE_TRUNC expression
        newGroupByColumn = {
          type: 'expression',
          column: columnName,
          table: tableAlias || undefined,
          function: 'DATE_TRUNC',
          unit: truncUnit,
        };
        newSelectColumn = {
          type: 'expression',
          column: columnName,
          table: tableAlias || undefined,
          function: 'DATE_TRUNC',
          unit: truncUnit,
          alias: `${columnName}_${truncUnit.toLowerCase()}`,
        };
      } else {
        // Regular column
        newGroupByColumn = { type: 'column', column: columnName, table: undefined };
        newSelectColumn = {
          type: 'column',
          column: columnName,
          table: tableAlias || undefined,
        };
      }

      // Add to group by
      if (!groupBy) {
        onGroupByChange({ columns: [newGroupByColumn] });
      } else {
        onGroupByChange({ columns: [...groupBy.columns, newGroupByColumn] });
      }

      // Also add to select (required for SQL)
      // Check if this exact dimension already exists
      const dimensionExists = columns.some(c => {
        if (truncUnit) {
          return c.type === 'expression' && c.column === columnName && c.unit === truncUnit;
        }
        return c.type === 'column' && c.column === columnName;
      });

      if (!dimensionExists) {
        onColumnsChange([...columns, newSelectColumn]);
      }

      setAddDimensionOpen(false);
      setSelectedDateColumn(null);
    },
    [groupBy, onGroupByChange, columns, onColumnsChange, tableAlias]
  );

  const handleRemoveDimension = useCallback(
    (index: number) => {
      if (!groupBy) return;

      const removedColumn = groupBy.columns[index];
      const newGroupByColumns = groupBy.columns.filter((_, i) => i !== index);
      onGroupByChange(newGroupByColumns.length > 0 ? { columns: newGroupByColumns } : undefined);

      // Also remove from select
      if (removedColumn) {
        const newSelectColumns = columns.filter(c => {
          if (removedColumn.type === 'expression') {
            // Match expression columns by column name + unit
            return !(c.type === 'expression' && c.column === removedColumn.column && c.unit === removedColumn.unit);
          }
          // Match regular columns
          return !(c.type === 'column' && c.column === removedColumn.column);
        });
        onColumnsChange(newSelectColumns);
      }
    },
    [groupBy, onGroupByChange, columns, onColumnsChange]
  );

  const handleUpdateDimension = useCallback(
    (index: number, truncUnit?: DateTruncUnit) => {
      if (!groupBy) return;

      const oldDim = groupBy.columns[index];
      const columnName = oldDim.column;

      let newGroupByColumn: GroupByItem;
      let newSelectColumn: SelectColumn;

      if (truncUnit) {
        // DATE_TRUNC expression
        newGroupByColumn = {
          type: 'expression',
          column: columnName,
          table: tableAlias || undefined,
          function: 'DATE_TRUNC',
          unit: truncUnit,
        };
        newSelectColumn = {
          type: 'expression',
          column: columnName,
          table: tableAlias || undefined,
          function: 'DATE_TRUNC',
          unit: truncUnit,
          alias: `${columnName}_${truncUnit.toLowerCase()}`,
        };
      } else {
        // Regular column
        newGroupByColumn = { type: 'column', column: columnName, table: undefined };
        newSelectColumn = {
          type: 'column',
          column: columnName,
          table: tableAlias || undefined,
        };
      }

      // Update group by
      const newGroupByColumns = [...groupBy.columns];
      newGroupByColumns[index] = newGroupByColumn;
      onGroupByChange({ columns: newGroupByColumns });

      // Update select: remove old, add new
      const newSelectColumns = columns.filter(c => {
        if (oldDim.type === 'expression') {
          return !(c.type === 'expression' && c.column === oldDim.column && c.unit === oldDim.unit);
        }
        return !(c.type === 'column' && c.column === oldDim.column);
      });
      newSelectColumns.push(newSelectColumn);
      onColumnsChange(newSelectColumns);

      setEditingDimensionIndex(null);
    },
    [groupBy, onGroupByChange, columns, onColumnsChange, tableAlias]
  );

  const handleOpenRawDimEdit = useCallback((idx: number) => {
    const dim = dimensions[idx];
    if (!dim) return;
    setEditRawDimSql(dim.column);
    setEditingRawDimIndex(idx);
  }, [dimensions]);

  const handleSaveRawDim = useCallback(() => {
    if (editingRawDimIndex === null || !groupBy) return;
    const newSql = editRawDimSql.trim();
    if (!newSql) return;

    const oldDim = groupBy.columns[editingRawDimIndex];

    // Update GROUP BY
    const newGroupByColumns = [...groupBy.columns];
    newGroupByColumns[editingRawDimIndex] = {
      type: 'column',
      column: newSql,
    };
    onGroupByChange({ columns: newGroupByColumns });

    // Update the matching SELECT column (raw type with the old SQL)
    const newSelectColumns = columns.map(c => {
      if (c.type === 'raw' && c.raw_sql === oldDim.column) {
        return { ...c, raw_sql: newSql };
      }
      return c;
    });
    onColumnsChange(newSelectColumns);

    setEditingRawDimIndex(null);
  }, [editingRawDimIndex, editRawDimSql, groupBy, onGroupByChange, columns, onColumnsChange]);

  // Helper to detect if a dimension is a raw SQL expression (not a simple column name)
  const isRawDimension = useCallback((dim: GroupByItem) => {
    // If it matches no available column and contains parens or spaces, it's raw SQL
    if (dim.function) return false; // DATE_TRUNC, DATE, SPLIT_PART are handled separately
    const isKnownColumn = availableColumns.some(c => c.name === dim.column);
    return !isKnownColumn && (dim.column.includes('(') || dim.column.includes(' '));
  }, [availableColumns]);

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

  const formatDimensionLabel = (dim: GroupByItem) => {
    if (dim.function === 'DATE_TRUNC') {
      const unitLabel = DATE_TRUNC_UNITS.find(u => u.value === dim.unit)?.label || dim.unit;
      return `${dim.column} by ${unitLabel}`;
    }
    if (dim.function === 'DATE') return `DATE(${dim.column})`;
    if (dim.function === 'SPLIT_PART') return `SPLIT_PART(${dim.column})`;
    return dim.table ? `${dim.table}.${dim.column}` : dim.column;
  };

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
        {/* Raw expression metric chips (complex SQL: CASE, arithmetic, etc.) — editable via SQL editor */}
        {rawMetrics.map((metric, idx) => (
          <PickerPopover
            key={`raw-metric-${idx}`}
            open={editingRawMetricIndex === idx}
            onOpenChange={(details) => {
              if (!details.open) setEditingRawMetricIndex(null);
            }}
            trigger={
              <Box>
                <QueryChip
                  variant="metric"
                  icon={<LuCode size={11} />}
                  onRemove={() => handleRemoveRawMetric(idx)}
                  onClick={() => handleOpenRawMetricEdit(idx)}
                  isActive={editingRawMetricIndex === idx}
                >
                  {metric.alias || metric.raw_sql?.slice(0, 40) || 'expression'}
                </QueryChip>
              </Box>
            }
            padding={3}
            width="340px"
          >
            <ExpressionEditor
              title="SQL Expression"
              sql={editRawSql}
              onSqlChange={setEditRawSql}
              alias={editRawAlias}
              onAliasChange={setEditRawAlias}
              placeholder="e.g. ROUND(COUNT(*) * 1.0 / COUNT(DISTINCT user_id), 2)"
              buttonLabel="Apply"
              onSubmit={handleSaveRawMetric}
              disabled={!editRawSql.trim()}
            />
          </PickerPopover>
        ))}

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

        {/* Add custom expression metric */}
        <PickerPopover
          open={addExprOpen}
          onOpenChange={(details) => {
            setAddExprOpen(details.open);
            if (!details.open) { setNewExprSql(''); setNewExprAlias(''); }
          }}
          trigger={
            <Box
              as="button"
              display="inline-flex"
              alignItems="center"
              gap={1}
              bg="transparent"
              border="1px dashed"
              borderColor="rgba(134, 239, 172, 0.3)"
              borderRadius="md"
              px={2}
              py={1}
              cursor="pointer"
              transition="all 0.15s ease"
              _hover={{ bg: 'rgba(134, 239, 172, 0.08)', borderStyle: 'solid' }}
              onClick={() => setAddExprOpen(true)}
            >
              <LuCode size={11} color="var(--chakra-colors-fg-muted)" />
              <Text fontSize="xs" color="fg.muted" fontWeight="500" fontFamily="mono">expr</Text>
            </Box>
          }
          padding={3}
          width="340px"
        >
          <ExpressionEditor
            title="SQL Expression"
            sql={newExprSql}
            onSqlChange={setNewExprSql}
            alias={newExprAlias}
            onAliasChange={setNewExprAlias}
            placeholder="e.g. ROUND(COUNT(*) * 1.0 / COUNT(DISTINCT user_id), 2)"
            buttonLabel="Add"
            onSubmit={handleAddExprMetric}
            disabled={!newExprSql.trim()}
          />
        </PickerPopover>

        {/* "by" separator - only show if we have metrics */}
        <Text fontSize="xs" color="fg.muted" fontWeight="500" px={1} fontFamily="mono">
            group by
        </Text>

        {/* Dimensions */}
        {dimensions.map((dim, idx) => {
          const colInfo = availableColumns.find(c => c.name === dim.column);
          const isDate = isDateColumn(colInfo?.type);

          // DATE() and SPLIT_PART() dimensions: show as locked chips (no GUI editor)
          if (dim.function === 'DATE' || dim.function === 'SPLIT_PART') {
            return (
              <QueryChip
                key={`dim-${idx}`}
                variant="dimension"
                icon={<LuCalendar size={11} />}
                isLocked
                onRemove={() => handleRemoveDimension(idx)}
              >
                {formatDimensionLabel(dim)}
              </QueryChip>
            );
          }

          // Raw SQL expression dimensions: editable via SQL text area
          if (isRawDimension(dim)) {
            return (
              <PickerPopover
                key={`dim-raw-${idx}`}
                open={editingRawDimIndex === idx}
                onOpenChange={(details) => {
                  if (!details.open) setEditingRawDimIndex(null);
                }}
                trigger={
                  <Box>
                    <QueryChip
                      variant="dimension"
                      icon={<LuCode size={11} />}
                      onRemove={() => handleRemoveDimension(idx)}
                      onClick={() => handleOpenRawDimEdit(idx)}
                      isActive={editingRawDimIndex === idx}
                    >
                      {dim.column.length > 40 ? dim.column.slice(0, 40) + '...' : dim.column}
                    </QueryChip>
                  </Box>
                }
                padding={3}
                width="340px"
              >
                <ExpressionEditor
                  title="Group By Expression"
                  sql={editRawDimSql}
                  onSqlChange={setEditRawDimSql}
                  placeholder="e.g. DATE_TRUNC('month', created_at)"
                  buttonLabel="Apply"
                  onSubmit={handleSaveRawDim}
                  disabled={!editRawDimSql.trim()}
                />
              </PickerPopover>
            );
          }

          return (
            <PickerPopover
              key={`dim-${idx}`}
              open={editingDimensionIndex === idx}
              onOpenChange={(details) => {
                if (!details.open) {
                  setEditingDimensionIndex(null);
                }
              }}
              trigger={
                <Box>
                  <QueryChip
                    variant="dimension"
                    icon={dim.type === 'expression' ? <LuCalendar size={11} /> : undefined}
                    onRemove={() => handleRemoveDimension(idx)}
                    onClick={() => setEditingDimensionIndex(idx)}
                    isActive={editingDimensionIndex === idx}
                  >
                    {formatDimensionLabel(dim)}
                  </QueryChip>
                </Box>
              }
              width="240px"
            >
              <PickerHeader>{dim.column}</PickerHeader>
              <PickerList>
                <PickerItem
                  icon={getColumnIcon(colInfo?.type)}
                  selected={dim.type !== 'expression'}
                  selectedBg="rgba(147, 197, 253, 0.15)"
                  onClick={() => handleUpdateDimension(idx)}
                >
                  Raw value
                </PickerItem>
                {isDate && DATE_TRUNC_UNITS.map((unit) => (
                  <PickerItem
                    key={unit.value}
                    icon={<LuCalendar size={14} />}
                    selected={dim.type === 'expression' && dim.unit === unit.value}
                    selectedBg="rgba(147, 197, 253, 0.15)"
                    onClick={() => handleUpdateDimension(idx, unit.value)}
                  >
                    {`By ${unit.label}`}
                  </PickerItem>
                ))}
              </PickerList>
            </PickerPopover>
          );
        })}

        {/* Add dimension */}
        <PickerPopover
          open={addDimensionOpen}
          onOpenChange={(details) => {
            setAddDimensionOpen(details.open);
            if (!details.open) setSelectedDateColumn(null);
          }}
          trigger={
            <Box>
              <AddChipButton onClick={() => setAddDimensionOpen(true)} variant="dimension" />
            </Box>
          }
        >
          {!selectedDateColumn ? (
            <>
              <PickerHeader>Group by</PickerHeader>
              <PickerList maxH="250px" searchable searchPlaceholder="Search columns...">
                {(query) =>
                  availableColumns
                    .filter((col) => !query || col.name.toLowerCase().includes(query.toLowerCase()))
                    .map((col) => (
                      <PickerItem
                        key={col.name}
                        icon={getColumnIcon(col.type)}
                        onClick={() => {
                          if (isDateColumn(col.type)) {
                            setSelectedDateColumn(col);
                          } else {
                            handleAddDimension(col.name);
                          }
                        }}
                        rightElement={
                          isDateColumn(col.type) ? (
                            <Text fontSize="xs" color="fg.muted" fontFamily="mono">›</Text>
                          ) : undefined
                        }
                      >
                        {col.name}
                      </PickerItem>
                    ))
                }
              </PickerList>
            </>
          ) : (
            <>
              <HStack px={2} py={1.5} gap={2}>
                <Box
                  as="button"
                  color="fg.muted"
                  _hover={{ color: 'fg' }}
                  onClick={() => setSelectedDateColumn(null)}
                >
                  ‹
                </Box>
                <Text fontSize="xs" fontWeight="600" color="fg.muted" textTransform="uppercase" fontFamily="mono">
                  {selectedDateColumn.name}
                </Text>
              </HStack>
              <PickerList>
                <PickerItem
                  icon={getColumnIcon(selectedDateColumn.type)}
                  onClick={() => handleAddDimension(selectedDateColumn.name)}
                >
                  Raw value
                </PickerItem>
                {DATE_TRUNC_UNITS.map((unit) => (
                  <PickerItem
                    key={unit.value}
                    icon={<LuCalendar size={14} />}
                    onClick={() => handleAddDimension(selectedDateColumn.name, unit.value)}
                  >
                    {`By ${unit.label}`}
                  </PickerItem>
                ))}
              </PickerList>
            </>
          )}
        </PickerPopover>

      </HStack>
    </Box>
  );
}
