/**
 * SummarizeSection
 * Shows metrics (aggregations) + "by" + dimensions (group by columns)
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { Box, HStack, Text, VStack, SimpleGrid } from '@chakra-ui/react';
import { SelectColumn, GroupByClause, GroupByItem } from '@/lib/types';
import { CompletionsAPI } from '@/lib/data/completions/completions';
import { QueryChip, AddChipButton, getColumnIcon } from './QueryChip';
import { PickerPopover, PickerHeader, PickerList, PickerItem } from './PickerPopover';
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
    const aggLabel = AGGREGATES.find((a) => a.value === col.aggregate)?.shortLabel || col.aggregate;
    const alias = col.alias || `${col.aggregate?.toLowerCase()}_${col.column === '*' ? 'all' : col.column}`;
    const baseLabel = col.column === '*' ? aggLabel : `${aggLabel}(${col.column})`;
    return `${baseLabel} as ${alias}`;
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
      bg="bg.subtle"
      borderRadius="lg"
      border="1px solid"
      borderColor="border.muted"
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
              <Text fontSize="xs" fontWeight="600" color="fg.muted" textTransform="uppercase" letterSpacing="0.05em">
                Edit metric
              </Text>
              <HStack gap={1.5} align="center">
                <Text fontSize="xs" color="fg.muted" flexShrink={0}>as</Text>
                <AliasInput
                  value={editAlias}
                  onChange={(alias) => setEditAlias(alias || '')}
                  placeholder="alias"
                  width="90px"
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
                  bg={selectedAgg === agg.value ? 'rgba(134, 239, 172, 0.2)' : 'bg.subtle'}
                  color={selectedAgg === agg.value ? 'accent.teal' : 'fg.muted'}
                  border="1px solid"
                  borderColor={selectedAgg === agg.value ? 'rgba(134, 239, 172, 0.4)' : 'border.muted'}
                  _hover={{ bg: selectedAgg === agg.value ? 'rgba(134, 239, 172, 0.25)' : 'bg.muted' }}
                  transition="all 0.15s ease"
                  onClick={() => handleAggregateChange(agg.value)}
                >
                  {agg.shortLabel}
                </Box>
              ))}
            </SimpleGrid>
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
          <Text fontSize="xs" fontWeight="600" color="fg.muted" textTransform="uppercase" letterSpacing="0.05em" mb={2.5}>
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
                bg={selectedAgg === agg.value ? 'rgba(134, 239, 172, 0.2)' : 'bg.subtle'}
                color={selectedAgg === agg.value ? 'accent.teal' : 'fg.muted'}
                border="1px solid"
                borderColor={selectedAgg === agg.value ? 'rgba(134, 239, 172, 0.4)' : 'border.muted'}
                _hover={{ bg: selectedAgg === agg.value ? 'rgba(134, 239, 172, 0.25)' : 'bg.muted' }}
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
                            <Text fontSize="xs" color="fg.muted">›</Text>
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
                <Text fontSize="xs" fontWeight="600" color="fg.muted" textTransform="uppercase">
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
