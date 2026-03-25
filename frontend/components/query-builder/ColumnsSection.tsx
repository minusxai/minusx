/**
 * ColumnsSection
 * Shows and manages SELECT columns for non-aggregate queries
 * (When using Summarize, columns are managed there instead)
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { Box, HStack, Text, VStack, Spinner, Button, Textarea } from '@chakra-ui/react';
import { Checkbox } from '@/components/ui/checkbox';
import { SelectColumn } from '@/lib/sql/ir-types';
import { CompletionsAPI } from '@/lib/data/completions/completions';
import { QueryChip, AddChipButton, getColumnIcon } from './QueryChip';
import { PickerPopover, PickerHeader, PickerList, PickerItem } from './PickerPopover';
import { AliasInput } from './AliasInput';
import { LuX, LuCode } from 'react-icons/lu';

interface ColumnsSectionProps {
  databaseName: string;
  tableName: string;
  tableSchema?: string;
  columns: SelectColumn[];
  onChange: (columns: SelectColumn[]) => void;
  onClose?: () => void;
}

export function ColumnsSection({
  databaseName,
  tableName,
  tableSchema,
  columns,
  onChange,
  onClose,
}: ColumnsSectionProps) {
  const [availableColumns, setAvailableColumns] = useState<Array<{ name: string; type?: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editAlias, setEditAlias] = useState('');
  const [editingRawIndex, setEditingRawIndex] = useState<number | null>(null);
  const [editRawSql, setEditRawSql] = useState('');
  const [editRawAlias, setEditRawAlias] = useState('');
  const [addExprOpen, setAddExprOpen] = useState(false);
  const [newExprSql, setNewExprSql] = useState('');
  const [newExprAlias, setNewExprAlias] = useState('');

  // Check if using SELECT *
  const isSelectStar = columns.length === 1 && columns[0].column === '*';

  // Load available columns
  useEffect(() => {
    async function loadColumns() {
      if (!databaseName || !tableName) return;

      setLoading(true);
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
      } finally {
        setLoading(false);
      }
    }

    loadColumns();
  }, [databaseName, tableName, tableSchema]);

  const handleAddColumn = (columnName: string) => {
    // If currently SELECT *, replace with single column
    if (isSelectStar) {
      onChange([{ type: 'column', column: columnName }]);
    } else {
      // Add new column if not already present
      if (!columns.find((c) => c.column === columnName)) {
        onChange([...columns, { type: 'column', column: columnName }]);
      }
    }
    setPopoverOpen(false);
  };

  const handleRemoveColumn = (index: number) => {
    const newColumns = columns.filter((_, i) => i !== index);
    // If no columns left, default to SELECT *
    onChange(newColumns.length === 0 ? [{ type: 'column', column: '*' }] : newColumns);
  };

  const handleToggleSelectStar = (checked: boolean) => {
    if (checked) {
      // Switch to SELECT *
      onChange([{ type: 'column', column: '*' }]);
    } else {
      // Switch to specific columns (empty list will show as no columns selected)
      onChange([]);
    }
  };

  const handleAddExpression = useCallback(() => {
    if (!newExprSql.trim()) return;
    const newCol: SelectColumn = {
      type: 'raw',
      raw_sql: newExprSql.trim(),
      alias: newExprAlias.trim() || undefined,
    };
    onChange(isSelectStar ? [newCol] : [...columns, newCol]);
    setNewExprSql('');
    setNewExprAlias('');
    setAddExprOpen(false);
  }, [newExprSql, newExprAlias, columns, onChange, isSelectStar]);

  const handleSaveRawColumn = useCallback((index: number) => {
    const newColumns = [...columns];
    newColumns[index] = {
      ...newColumns[index],
      raw_sql: editRawSql.trim(),
      alias: editRawAlias.trim() || undefined,
    };
    onChange(newColumns);
    setEditingRawIndex(null);
  }, [columns, onChange, editRawSql, editRawAlias]);

  const formatExpressionLabel = (col: SelectColumn): string => {
    if (col.type === 'raw') {
      const preview = col.raw_sql?.slice(0, 35) || 'expression';
      return col.alias ? `${preview}… as ${col.alias}` : preview;
    }
    if (col.function === 'DATE') return col.alias || `DATE(${col.column})`;
    if (col.function === 'SPLIT_PART') return col.alias || `SPLIT_PART(${col.column})`;
    if (col.function === 'DATE_TRUNC') return col.alias || `${col.column} by ${col.unit}`;
    return col.alias || col.column || 'expression';
  };

  // Filter out columns already selected
  const selectableColumns = availableColumns.filter(
    (col) => !columns.find((c) => c.column === col.name && c.type === 'column')
  );

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
          Columns
        </Text>
        {onClose && (
          <Box
            as="button"
            color="fg.muted"
            _hover={{ color: 'fg' }}
            onClick={onClose}
            cursor="pointer"
            p={1}
          >
            <LuX size={14} />
          </Box>
        )}
      </HStack>

      {/* SELECT * toggle */}
      <HStack mb={3}>
        <Checkbox
          checked={isSelectStar}
          onCheckedChange={(e) => handleToggleSelectStar(e.checked === true)}
          size="sm"
        >
          <Text fontSize="sm" color="fg">
            Select all columns (*)
          </Text>
        </Checkbox>
      </HStack>

      {/* Show column chips if not SELECT * */}
      {!isSelectStar && (
        <HStack gap={2} flexWrap="wrap">
          {columns.map((col, index) => {
            // Aggregates are managed by SummarizeSection
            if (col.type === 'aggregate') return null;
            // SELECT * is handled by the checkbox above
            if (col.type === 'column' && col.column === '*') return null;

            // Raw SQL columns: editable via SQL expression editor
            if (col.type === 'raw') {
              return (
                <PickerPopover
                  key={index}
                  open={editingRawIndex === index}
                  onOpenChange={(details) => {
                    if (!details.open) setEditingRawIndex(null);
                  }}
                  trigger={
                    <Box>
                      <QueryChip
                        variant="neutral"
                        icon={<LuCode size={11} />}
                        onRemove={() => handleRemoveColumn(index)}
                        onClick={() => {
                          setEditRawSql(col.raw_sql || '');
                          setEditRawAlias(col.alias || '');
                          setEditingRawIndex(index);
                        }}
                        isActive={editingRawIndex === index}
                      >
                        {formatExpressionLabel(col)}
                      </QueryChip>
                    </Box>
                  }
                  padding={3}
                  width="340px"
                >
                  <VStack gap={2.5} align="stretch">
                    <HStack justify="space-between" align="center">
                      <Text fontSize="xs" fontWeight="600" color="fg.muted" textTransform="uppercase" letterSpacing="0.05em">
                        SQL Expression
                      </Text>
                      <AliasInput
                        value={editRawAlias}
                        onChange={(a) => setEditRawAlias(a || '')}
                        placeholder="alias"
                      />
                    </HStack>
                    <Textarea
                      value={editRawSql}
                      onChange={(e) => setEditRawSql(e.target.value)}
                      rows={4}
                      fontFamily="mono"
                      fontSize="xs"
                      placeholder="e.g. CASE WHEN status = 'active' THEN 1 ELSE 0 END"
                      resize="vertical"
                    />
                    <Button size="sm" colorPalette="blue" onClick={() => handleSaveRawColumn(index)}>
                      Apply
                    </Button>
                  </VStack>
                </PickerPopover>
              );
            }

            // Expression columns (DATE_TRUNC, DATE, SPLIT_PART): locked, no GUI editor
            if (col.type === 'expression') {
              return (
                <QueryChip
                  key={index}
                  variant="neutral"
                  icon={<LuCode size={11} />}
                  isLocked
                  onRemove={() => handleRemoveColumn(index)}
                >
                  {formatExpressionLabel(col)}
                </QueryChip>
              );
            }

            return (
              <PickerPopover
                key={index}
                open={editingIndex === index}
                onOpenChange={(details) => {
                  if (!details.open) {
                    setEditingIndex(null);
                    setEditAlias('');
                  }
                }}
                trigger={
                  <Box>
                    <QueryChip
                      variant="neutral"
                      icon={getColumnIcon('column')}
                      onRemove={() => handleRemoveColumn(index)}
                      onClick={() => {
                        setEditingIndex(index);
                        setEditAlias(col.alias || '');
                      }}
                      isActive={editingIndex === index}
                    >
                      {col.alias ? `${col.column} as ${col.alias}` : col.column}
                    </QueryChip>
                  </Box>
                }
                padding={3}
              >
                <VStack gap={3} align="stretch">
                  <Text fontSize="xs" fontWeight="600" color="fg.muted" textTransform="uppercase">
                    Column Alias
                  </Text>
                  <Text fontSize="sm" color="fg">
                    {col.column}
                  </Text>
                  <AliasInput
                    value={editAlias}
                    onChange={(alias) => setEditAlias(alias || '')}
                    placeholder="Alias (optional)"
                  />
                  <Button
                    size="sm"
                    colorPalette="blue"
                    onClick={() => {
                      const newColumns = [...columns];
                      newColumns[index] = {
                        ...newColumns[index],
                        alias: editAlias.trim() || undefined
                      };
                      onChange(newColumns);
                      setEditingIndex(null);
                    }}
                  >
                    Update
                  </Button>
                </VStack>
              </PickerPopover>
            );
          })}

          {/* Add column button */}
          <PickerPopover
            open={popoverOpen}
            onOpenChange={(details) => setPopoverOpen(details.open)}
            trigger={
              <Box>
                <AddChipButton onClick={() => setPopoverOpen(true)} />
              </Box>
            }
            width="220px"
          >
            <PickerHeader>Available Columns</PickerHeader>
            <PickerList maxH="250px" searchable searchPlaceholder="Search columns...">
              {(query) =>
                loading ? (
                  <HStack px={2} py={3} justify="center">
                    <Spinner size="sm" />
                  </HStack>
                ) : selectableColumns.length === 0 ? (
                  <Text fontSize="sm" color="fg.muted" px={2} py={2}>
                    All columns selected
                  </Text>
                ) : (
                  selectableColumns
                    .filter((col) => !query || col.name.toLowerCase().includes(query.toLowerCase()))
                    .map((col) => (
                      <PickerItem
                        key={col.name}
                        onClick={() => handleAddColumn(col.name)}
                      >
                        <Text fontSize="sm">{col.name}</Text>
                        {col.type && (
                          <Text fontSize="xs" color="fg.muted">
                            {col.type}
                          </Text>
                        )}
                      </PickerItem>
                    ))
                )
              }
            </PickerList>
          </PickerPopover>

          {/* Add custom expression button */}
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
                borderColor="border.default"
                borderRadius="md"
                px={2}
                py={1}
                cursor="pointer"
                transition="all 0.15s ease"
                _hover={{ bg: 'bg.muted', borderStyle: 'solid' }}
                onClick={() => setAddExprOpen(true)}
              >
                <LuCode size={11} color="var(--chakra-colors-fg-muted)" />
                <Text fontSize="xs" color="fg.muted" fontWeight="500">expr</Text>
              </Box>
            }
            padding={3}
            width="340px"
          >
            <VStack gap={2.5} align="stretch">
              <HStack justify="space-between" align="center">
                <Text fontSize="xs" fontWeight="600" color="fg.muted" textTransform="uppercase" letterSpacing="0.05em">
                  SQL Expression
                </Text>
                <AliasInput
                  value={newExprAlias}
                  onChange={(a) => setNewExprAlias(a || '')}
                  placeholder="alias"
                />
              </HStack>
              <Textarea
                value={newExprSql}
                onChange={(e) => setNewExprSql(e.target.value)}
                rows={4}
                fontFamily="mono"
                fontSize="xs"
                placeholder="e.g. CASE WHEN status = 'active' THEN 1 ELSE 0 END"
                resize="vertical"
              />
              <Button size="sm" colorPalette="blue" onClick={handleAddExpression} disabled={!newExprSql.trim()}>
                Add
              </Button>
            </VStack>
          </PickerPopover>
        </HStack>
      )}

      {!isSelectStar && columns.length === 0 && (
        <Text fontSize="sm" color="fg.muted">
          No columns selected. Add columns or select all (*).
        </Text>
      )}
    </Box>
  );
}
