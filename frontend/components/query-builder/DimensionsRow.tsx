/**
 * DimensionsRow
 * Renders the "group by" separator, dimension chips (with date-trunc /
 * raw-SQL editing), and the "add dimension" popover. Extracted from
 * SummarizeSection.
 */

'use client';

import { useState, useCallback } from 'react';
import { Box, HStack, Text } from '@chakra-ui/react';
import { SelectColumn, GroupByClause, GroupByItem } from '@/lib/types';
import { QueryChip, AddChipButton, getColumnIcon } from './QueryChip';
import { PickerPopover, PickerHeader, PickerList, PickerItem } from './PickerPopover';
import { ExpressionEditor } from './ExpressionEditor';
import { LuCalendar, LuCode } from 'react-icons/lu';

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

interface DimensionsRowProps {
  columns: SelectColumn[];
  onColumnsChange: (columns: SelectColumn[]) => void;
  groupBy?: GroupByClause;
  onGroupByChange: (groupBy: GroupByClause | undefined) => void;
  availableColumns: Array<{ name: string; type?: string; displayName: string }>;
  tableAlias?: string;
}

export function DimensionsRow({
  columns,
  onColumnsChange,
  groupBy,
  onGroupByChange,
  availableColumns,
  tableAlias,
}: DimensionsRowProps) {
  const [addDimensionOpen, setAddDimensionOpen] = useState(false);
  // For date column truncation selection
  const [selectedDateColumn, setSelectedDateColumn] = useState<{ name: string; type?: string } | null>(null);
  // For editing dimensions
  const [editingDimensionIndex, setEditingDimensionIndex] = useState<number | null>(null);
  // For editing raw expression dimensions
  const [editingRawDimIndex, setEditingRawDimIndex] = useState<number | null>(null);
  const [editRawDimSql, setEditRawDimSql] = useState('');

  const dimensions = groupBy?.columns || [];

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
    <>
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
    </>
  );
}
