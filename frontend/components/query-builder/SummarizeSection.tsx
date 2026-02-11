/**
 * SummarizeSection
 * Shows metrics (aggregations) + "by" + dimensions (group by columns)
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { Box, HStack, Text, VStack, createListCollection, Popover, Portal, Button } from '@chakra-ui/react';
import {
  SelectRoot,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValueText,
} from '@/components/ui/select';
import { SelectColumn, GroupByClause, GroupByItem } from '@/lib/types';
import { CompletionsAPI } from '@/lib/data/completions/completions';
import { QueryChip, AddChipButton, getColumnIcon } from './QueryChip';
import { AliasInput } from './AliasInput';
import { LuSigma, LuX, LuCalendar } from 'react-icons/lu';

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
  { label: 'Count', value: 'COUNT' },
  { label: 'Sum', value: 'SUM' },
  { label: 'Average', value: 'AVG' },
  { label: 'Min', value: 'MIN' },
  { label: 'Max', value: 'MAX' },
  { label: 'Count distinct', value: 'COUNT_DISTINCT' },
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
  // For date column truncation selection
  const [selectedDateColumn, setSelectedDateColumn] = useState<{ name: string; type?: string } | null>(null);
  // For editing dimensions
  const [editingDimensionIndex, setEditingDimensionIndex] = useState<number | null>(null);

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
      };

      onColumnsChange(newColumns);
      setEditingMetricIndex(null);
      setEditAlias('');
    },
    [editingMetricIndex, selectedAgg, editAlias, columns, onColumnsChange, tableAlias]
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

  const formatMetricLabel = (col: SelectColumn) => {
    const aggLabel = AGGREGATES.find((a) => a.value === col.aggregate)?.label || col.aggregate;
    const autoAlias = `${col.aggregate?.toLowerCase()}_${col.column === '*' ? 'all' : col.column}`;

    // Show alias if custom (different from auto-generated)
    if (col.alias && col.alias !== autoAlias) {
      const baseLabel = col.column === '*' ? aggLabel : `${aggLabel} of ${col.column}`;
      return `${baseLabel} as ${col.alias}`;
    }

    if (col.column === '*') return aggLabel;
    return `${aggLabel} of ${col.column}`;
  };

  const formatDimensionLabel = (dim: GroupByItem) => {
    if (dim.type === 'expression' && dim.function === 'DATE_TRUNC') {
      const unitLabel = DATE_TRUNC_UNITS.find(u => u.value === dim.unit)?.label || dim.unit;
      return `${dim.column} by ${unitLabel}`;
    }
    return dim.table ? `${dim.table}.${dim.column}` : dim.column;
  };

  return (
    <Box
      bg="rgba(255, 255, 255, 0.02)"
      borderRadius="lg"
      border="1px solid"
      borderColor="rgba(255, 255, 255, 0.06)"
      p={3}
    >
      <HStack justify="space-between" mb={2.5}>
        <Text fontSize="xs" fontWeight="600" color="fg.muted" textTransform="uppercase" letterSpacing="0.05em">
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
        {/* Metrics */}
        {metrics.map((metric, idx) => (
          <Popover.Root
            key={`metric-${idx}`}
            open={editingMetricIndex === idx}
            onOpenChange={(details) => {
              if (!details.open) {
                setEditingMetricIndex(null);
              }
            }}
          >
            <Popover.Trigger asChild>
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
            </Popover.Trigger>
            <Portal>
              <Popover.Positioner>
                <Popover.Content width="280px" bg="gray.900" borderColor="gray.700" border="1px solid" p={0} overflow="hidden" borderRadius="lg">
                  <Popover.Body p={3}>
                    <VStack gap={3} align="stretch">
                      <Text fontSize="xs" fontWeight="600" color="fg.muted" textTransform="uppercase">
                        Edit metric
                      </Text>
                      <SelectRoot
                        collection={createListCollection({
                          items: AGGREGATES,
                        })}
                        value={[selectedAgg]}
                        onValueChange={(e) => handleAggregateChange(e.value[0] || 'COUNT')}
                        size="sm"
                      >
                        <SelectTrigger>
                          <SelectValueText placeholder="Function" />
                        </SelectTrigger>
                        <SelectContent >
                          {AGGREGATES.map((agg) => (
                            <SelectItem key={agg.value} item={agg.value}>
                              {agg.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </SelectRoot>

                      <Box>
                        <Text fontSize="xs" fontWeight="600" color="fg.muted" mb={1}>
                          Alias (optional)
                        </Text>
                        <AliasInput
                          value={editAlias}
                          onChange={(alias) => setEditAlias(alias || '')}
                          placeholder={`${selectedAgg.toLowerCase()}_${metric.column === '*' ? 'all' : metric.column}`}
                          width="100%"
                        />
                        <Text fontSize="xs" color="fg.muted" mt={1}>
                          Leave blank for auto-generated
                        </Text>
                      </Box>

                      <VStack gap={0.5} align="stretch" maxH="200px" overflowY="auto">
                        <Box
                          px={2}
                          py={1.5}
                          borderRadius="md"
                          cursor="pointer"
                          bg={metric.column === '*' ? 'rgba(134, 239, 172, 0.15)' : 'transparent'}
                          _hover={{ bg: 'rgba(255, 255, 255, 0.05)' }}
                          onClick={() => handleUpdateMetric('*')}
                        >
                          <Text fontSize="sm">* (all rows)</Text>
                        </Box>
                        {availableColumns.map((col) => (
                          <Box
                            key={col.name}
                            px={2}
                            py={1.5}
                            borderRadius="md"
                            cursor="pointer"
                            bg={metric.column === col.name ? 'rgba(134, 239, 172, 0.15)' : 'transparent'}
                            _hover={{ bg: 'rgba(255, 255, 255, 0.05)' }}
                            onClick={() => handleUpdateMetric(col.name)}
                          >
                            <HStack gap={2}>
                              <Box color="fg.muted">{getColumnIcon(col.type)}</Box>
                              <Text fontSize="sm">{col.name}</Text>
                            </HStack>
                          </Box>
                        ))}
                      </VStack>
                    </VStack>
                  </Popover.Body>
                </Popover.Content>
              </Popover.Positioner>
            </Portal>
          </Popover.Root>
        ))}

        {/* Add metric popover */}
        <Popover.Root open={addMetricOpen && editingMetricIndex === null} onOpenChange={(details) => setAddMetricOpen(details.open)}>
          <Popover.Trigger asChild>
            <Box>
              <AddChipButton onClick={() => setAddMetricOpen(true)} variant="metric" />
            </Box>
          </Popover.Trigger>
          <Portal>
            <Popover.Positioner>
              <Popover.Content width="280px" bg="gray.900" borderColor="gray.700" border="1px solid" p={0} overflow="hidden" borderRadius="lg">
                <Popover.Body p={3}>
                  <VStack gap={3} align="stretch">
                    <Text fontSize="xs" fontWeight="600" color="fg.muted" textTransform="uppercase">
                      Add metric
                    </Text>
                    <SelectRoot
                      collection={createListCollection({
                        items: AGGREGATES,
                      })}
                      value={[selectedAgg]}
                      onValueChange={(e) => setSelectedAgg(e.value[0] || 'COUNT')}
                      size="sm"
                    >
                      <SelectTrigger>
                        <SelectValueText placeholder="Function" />
                      </SelectTrigger>
                      <SelectContent >
                        {AGGREGATES.map((agg) => (
                          <SelectItem key={agg.value} item={agg.value}>
                            {agg.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </SelectRoot>

                    <VStack gap={0.5} align="stretch" maxH="200px" overflowY="auto">
                      <Box
                        px={2}
                        py={1.5}
                        borderRadius="md"
                        cursor="pointer"
                        _hover={{ bg: 'rgba(255, 255, 255, 0.05)' }}
                        onClick={() => handleAddMetric('*')}
                      >
                        <Text fontSize="sm">* (all rows)</Text>
                      </Box>
                      {availableColumns.map((col) => (
                        <Box
                          key={col.name}
                          px={2}
                          py={1.5}
                          borderRadius="md"
                          cursor="pointer"
                          _hover={{ bg: 'rgba(255, 255, 255, 0.05)' }}
                          onClick={() => handleAddMetric(col.name)}
                        >
                          <HStack gap={2}>
                            <Box color="fg.muted">{getColumnIcon(col.type)}</Box>
                            <Text fontSize="sm">{col.name}</Text>
                          </HStack>
                        </Box>
                      ))}
                    </VStack>
                  </VStack>
                </Popover.Body>
              </Popover.Content>
            </Popover.Positioner>
          </Portal>
        </Popover.Root>

        {/* "by" separator - only show if we have metrics */}
        {metrics.length > 0 && (dimensions.length > 0 || true) && (
          <Text fontSize="xs" color="fg.muted" fontWeight="500" px={1}>
            by
          </Text>
        )}

        {/* Dimensions */}
        {dimensions.map((dim, idx) => {
          const colInfo = availableColumns.find(c => c.name === dim.column);
          const isDate = isDateColumn(colInfo?.type);

          return (
            <Popover.Root
              key={`dim-${idx}`}
              open={editingDimensionIndex === idx}
              onOpenChange={(details) => {
                if (!details.open) {
                  setEditingDimensionIndex(null);
                }
              }}
            >
              <Popover.Trigger asChild>
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
              </Popover.Trigger>
              <Portal>
                <Popover.Positioner>
                  <Popover.Content width="240px" bg="gray.900" borderColor="gray.700" border="1px solid" p={0} overflow="hidden" borderRadius="lg">
                    <Popover.Body p={2} bg="gray.900">
                      <Text fontSize="xs" fontWeight="600" color="fg.muted" textTransform="uppercase" px={2} py={1.5}>
                        {dim.column}
                      </Text>
                      <VStack gap={0.5} align="stretch" bg="gray.900">
                        <Box
                          px={2}
                          py={1.5}
                          borderRadius="md"
                          cursor="pointer"
                          bg={dim.type !== 'expression' ? 'rgba(147, 197, 253, 0.15)' : 'transparent'}
                          _hover={{ bg: 'rgba(255, 255, 255, 0.05)' }}
                          onClick={() => handleUpdateDimension(idx)}
                        >
                          <HStack gap={2}>
                            <Box color="fg.muted">{getColumnIcon(colInfo?.type)}</Box>
                            <Text fontSize="sm">Raw value</Text>
                          </HStack>
                        </Box>
                        {isDate && DATE_TRUNC_UNITS.map((unit) => (
                          <Box
                            key={unit.value}
                            px={2}
                            py={1.5}
                            borderRadius="md"
                            cursor="pointer"
                            bg={dim.type === 'expression' && dim.unit === unit.value ? 'rgba(147, 197, 253, 0.15)' : 'transparent'}
                            _hover={{ bg: 'rgba(255, 255, 255, 0.05)' }}
                            onClick={() => handleUpdateDimension(idx, unit.value)}
                          >
                            <HStack gap={2}>
                              <Box color="fg.muted"><LuCalendar size={14} /></Box>
                              <Text fontSize="sm">By {unit.label}</Text>
                            </HStack>
                          </Box>
                        ))}
                      </VStack>
                    </Popover.Body>
                  </Popover.Content>
                </Popover.Positioner>
              </Portal>
            </Popover.Root>
          );
        })}

        {/* Add dimension */}
        <Popover.Root
          open={addDimensionOpen}
          onOpenChange={(details) => {
            setAddDimensionOpen(details.open);
            if (!details.open) setSelectedDateColumn(null);
          }}
        >
          <Popover.Trigger asChild>
            <Box>
              <AddChipButton onClick={() => setAddDimensionOpen(true)} variant="dimension" />
            </Box>
          </Popover.Trigger>
          <Portal>
            <Popover.Positioner>
              <Popover.Content width="280px" bg="gray.900" borderColor="gray.700" border="1px solid" p={0} overflow="hidden" borderRadius="lg">
                <Popover.Body p={2} bg="gray.900">
                  {!selectedDateColumn ? (
                    <>
                      <Text fontSize="xs" fontWeight="600" color="fg.muted" textTransform="uppercase" px={2} py={1.5}>
                        Group by
                      </Text>
                      <VStack gap={0.5} align="stretch" maxH="250px" overflowY="auto" bg="gray.900">
                        {availableColumns.map((col) => (
                          <Box
                            key={col.name}
                            px={2}
                            py={1.5}
                            borderRadius="md"
                            cursor="pointer"
                            _hover={{ bg: 'rgba(255, 255, 255, 0.05)' }}
                            onClick={() => {
                              if (isDateColumn(col.type)) {
                                setSelectedDateColumn(col);
                              } else {
                                handleAddDimension(col.name);
                              }
                            }}
                          >
                            <HStack gap={2} justify="space-between">
                              <HStack gap={2}>
                                <Box color="fg.muted">{getColumnIcon(col.type)}</Box>
                                <Text fontSize="sm">{col.name}</Text>
                              </HStack>
                              {isDateColumn(col.type) && (
                                <Text fontSize="xs" color="fg.muted">›</Text>
                              )}
                            </HStack>
                          </Box>
                        ))}
                      </VStack>
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
                        <Text fontSize="xs" fontWeight="600" color="fg.muted" textTransform="uppercase">
                          {selectedDateColumn.name}
                        </Text>
                      </HStack>
                      <VStack gap={0.5} align="stretch" bg="gray.900">
                        <Box
                          px={2}
                          py={1.5}
                          borderRadius="md"
                          cursor="pointer"
                          _hover={{ bg: 'rgba(255, 255, 255, 0.05)' }}
                          onClick={() => handleAddDimension(selectedDateColumn.name)}
                        >
                          <HStack gap={2}>
                            <Box color="fg.muted">{getColumnIcon(selectedDateColumn.type)}</Box>
                            <Text fontSize="sm">Raw value</Text>
                          </HStack>
                        </Box>
                        {DATE_TRUNC_UNITS.map((unit) => (
                          <Box
                            key={unit.value}
                            px={2}
                            py={1.5}
                            borderRadius="md"
                            cursor="pointer"
                            _hover={{ bg: 'rgba(255, 255, 255, 0.05)' }}
                            onClick={() => handleAddDimension(selectedDateColumn.name, unit.value)}
                          >
                            <HStack gap={2}>
                              <Box color="fg.muted"><LuCalendar size={14} /></Box>
                              <Text fontSize="sm">By {unit.label}</Text>
                            </HStack>
                          </Box>
                        ))}
                      </VStack>
                    </>
                  )}
                </Popover.Body>
              </Popover.Content>
            </Popover.Positioner>
          </Portal>
        </Popover.Root>

      </HStack>
    </Box>
  );
}
