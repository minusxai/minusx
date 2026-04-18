/**
 * ColumnsPicker
 * Compact chip + popover for selecting columns, shown inline next to the table chip in DataSection.
 * Replaces the standalone ColumnsSection card.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { Box, HStack, Text, VStack, Spinner, Button, Textarea } from '@chakra-ui/react';
import { SelectColumn } from '@/lib/sql/ir-types';
import { CompletionsAPI } from '@/lib/data/completions/completions';
import { QueryChip, getColumnIcon } from './QueryChip';
import { PickerPopover, PickerList, PickerItem } from './PickerPopover';
import { AliasInput } from './AliasInput';
import { LuColumns3, LuCode, LuPlus, LuCheck, LuChevronRight } from 'react-icons/lu';

interface ColumnsPickerProps {
  databaseName: string;
  tableName: string;
  tableSchema?: string;
  columns: SelectColumn[];
  onChange: (columns: SelectColumn[]) => void;
}

export function ColumnsPicker({
  databaseName,
  tableName,
  tableSchema,
  columns,
  onChange,
}: ColumnsPickerProps) {
  const [availableColumns, setAvailableColumns] = useState<Array<{ name: string; type?: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [exprPopoverOpen, setExprPopoverOpen] = useState(false);
  const [newExprSql, setNewExprSql] = useState('');
  const [newExprAlias, setNewExprAlias] = useState('');
  const [editingRawIndex, setEditingRawIndex] = useState<number | null>(null);
  const [editRawSql, setEditRawSql] = useState('');
  const [editRawAlias, setEditRawAlias] = useState('');

  // * can coexist with expressions, so check for * among column-type entries
  const hasStarColumn = columns.some(c => c.type === 'column' && c.column === '*');

  const namedColumnCount = columns.filter(c => c.type === 'column' && c.column !== '*').length;
  const exprCount = columns.filter(c => c.type === 'raw' || c.type === 'expression').length;

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

  const isColumnSelected = useCallback((colName: string) => {
    return columns.some(c => c.type === 'column' && c.column === colName);
  }, [columns]);

  const getExpressions = useCallback(() => {
    return columns.filter(c => c.type === 'raw' || c.type === 'expression');
  }, [columns]);

  const handleToggleColumn = useCallback((colName: string) => {
    const expressions = getExpressions();

    if (hasStarColumn) {
      // Switching from * to specific: select all except this one
      const allExceptThis = availableColumns
        .filter(c => c.name !== colName)
        .map(c => ({ type: 'column' as const, column: c.name }));
      onChange([...allExceptThis, ...expressions]);
      return;
    }

    if (isColumnSelected(colName)) {
      const remaining = columns.filter(c => !(c.type === 'column' && c.column === colName));
      const hasNamedColumns = remaining.some(c => c.type === 'column');
      if (!hasNamedColumns) {
        // No named columns left — revert to *
        onChange([{ type: 'column', column: '*' }, ...expressions]);
      } else {
        onChange(remaining);
      }
    } else {
      onChange([...columns, { type: 'column', column: colName }]);
    }
  }, [columns, onChange, hasStarColumn, availableColumns, isColumnSelected, getExpressions]);

  const handleSelectAll = useCallback(() => {
    const expressions = getExpressions();
    onChange([{ type: 'column', column: '*' }, ...expressions]);
  }, [getExpressions, onChange]);

  const handleDeselectAll = useCallback(() => {
    const expressions = getExpressions();
    onChange(expressions.length > 0 ? expressions : []);
  }, [getExpressions, onChange]);

  const handleAddExpression = useCallback(() => {
    if (!newExprSql.trim()) return;
    const newCol: SelectColumn = {
      type: 'raw',
      raw_sql: newExprSql.trim(),
      alias: newExprAlias.trim() || undefined,
    };
    onChange([...columns, newCol]);
    setNewExprSql('');
    setNewExprAlias('');
    setExprPopoverOpen(false);
  }, [newExprSql, newExprAlias, columns, onChange]);

  const handleRemoveExpression = useCallback((index: number) => {
    const newColumns = columns.filter((_, i) => i !== index);
    onChange(newColumns.length === 0 ? [{ type: 'column', column: '*' }] : newColumns);
  }, [columns, onChange]);

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
      const preview = col.raw_sql?.slice(0, 25) || 'expr';
      return col.alias || preview;
    }
    if (col.function === 'DATE') return col.alias || `DATE(${col.column})`;
    if (col.function === 'SPLIT_PART') return col.alias || `SPLIT_PART(${col.column})`;
    if (col.function === 'DATE_TRUNC') return col.alias || `${col.column} by ${col.unit}`;
    return col.alias || col.column || 'expr';
  };

  // Chip label
  let chipLabel: string;
  if (hasStarColumn && exprCount === 0) {
    chipLabel = 'All columns';
  } else if (hasStarColumn && exprCount > 0) {
    chipLabel = `All + ${exprCount} expr`;
  } else if (namedColumnCount === 0 && exprCount > 0) {
    chipLabel = `${exprCount} expr`;
  } else {
    const total = namedColumnCount + exprCount;
    chipLabel = `${total} column${total !== 1 ? 's' : ''}`;
  }

  const expressionColumns = columns
    .map((col, index) => ({ col, index }))
    .filter(({ col }) => col.type === 'raw' || col.type === 'expression');

  return (
    <PickerPopover
      open={open}
      onOpenChange={(details) => {
        setOpen(details.open);
        if (!details.open) { setExprPopoverOpen(false); setEditingRawIndex(null); }
      }}
      trigger={
        <Box cursor="pointer">
          <QueryChip
            variant="neutral"
            icon={<LuColumns3 size={11} />}
            onClick={() => setOpen(true)}
            isActive={open}
          >
            {chipLabel}
          </QueryChip>
        </Box>
      }
      width="260px"
      padding={0}
    >
      <VStack gap={0} align="stretch">
        {/* Header with All / None */}
        <HStack
          px={3}
          py={2}
          borderBottom="1px solid"
          borderColor="border.muted"
          justify="space-between"
          align="center"
        >
          <Text fontSize="xs" fontWeight="600" color="fg.muted" textTransform="uppercase" letterSpacing="0.05em" fontFamily="mono">
            Columns
          </Text>
          <HStack gap={0}>
            <Box
              as="button"
              px={1.5}
              py={0.5}
              borderRadius="sm"
              cursor="pointer"
              color={hasStarColumn ? 'accent.teal' : 'fg.muted'}
              fontWeight={hasStarColumn ? '600' : '400'}
              _hover={{ color: 'accent.teal' }}
              transition="all 0.15s ease"
              onClick={handleSelectAll}
            >
              <Text fontSize="xs" fontFamily="mono">All</Text>
            </Box>
            <Text fontSize="xs" color="fg.subtle" mx={0.5}>/</Text>
            <Box
              as="button"
              px={1.5}
              py={0.5}
              borderRadius="sm"
              cursor="pointer"
              color={!hasStarColumn && namedColumnCount === 0 ? 'accent.teal' : 'fg.muted'}
              fontWeight={!hasStarColumn && namedColumnCount === 0 ? '600' : '400'}
              _hover={{ color: 'accent.teal' }}
              transition="all 0.15s ease"
              onClick={handleDeselectAll}
            >
              <Text fontSize="xs" fontFamily="mono">None</Text>
            </Box>
          </HStack>
        </HStack>

        {/* Column list */}
        <Box px={1} py={1}>
          <PickerList maxH="220px" searchable searchPlaceholder="Search columns...">
            {(query) =>
              loading ? (
                <HStack px={2} py={3} justify="center">
                  <Spinner size="sm" />
                </HStack>
              ) : (
                availableColumns
                  .filter((col) => !query || col.name.toLowerCase().includes(query.toLowerCase()))
                  .map((col) => {
                    const selected = hasStarColumn || isColumnSelected(col.name);
                    return (
                      <PickerItem
                        key={col.name}
                        onClick={() => handleToggleColumn(col.name)}
                        selected={selected}
                        selectedBg="rgba(45, 212, 191, 0.08)"
                        rightElement={
                          selected ? (
                            <Box color="accent.teal"><LuCheck size={12} /></Box>
                          ) : undefined
                        }
                      >
                        <HStack gap={1.5}>
                          <Box color="fg.subtle">{getColumnIcon(col.type)}</Box>
                          <Text fontSize="xs" fontFamily="mono" fontWeight={selected ? '600' : '400'}>
                            {col.name}
                          </Text>
                        </HStack>
                      </PickerItem>
                    );
                  })
              )
            }
          </PickerList>
        </Box>

        {/* Expressions */}
        {expressionColumns.length > 0 && (
          <Box borderTop="1px solid" borderColor="border.muted" px={2} py={1.5}>
            <VStack gap={1} align="stretch">
              {expressionColumns.map(({ col, index }) => (
                <Box key={index}>
                  {col.type === 'raw' ? (
                    <PickerPopover
                      open={editingRawIndex === index}
                      onOpenChange={(details) => {
                        if (!details.open) setEditingRawIndex(null);
                      }}
                      positioning={{ placement: 'right' }}
                      trigger={
                        <Box>
                          <QueryChip
                            variant="neutral"
                            icon={<LuCode size={10} />}
                            onRemove={() => handleRemoveExpression(index)}
                            onClick={() => {
                              setEditRawSql(col.raw_sql || '');
                              setEditRawAlias(col.alias || '');
                              setEditingRawIndex(index);
                            }}
                            isActive={editingRawIndex === index}
                          >
                            <Text fontSize="xs" fontFamily="mono">{formatExpressionLabel(col)}</Text>
                          </QueryChip>
                        </Box>
                      }
                      padding={3}
                      width="280px"
                    >
                      <VStack gap={2} align="stretch">
                        <Text fontSize="xs" fontWeight="600" color="fg.muted" textTransform="uppercase" fontFamily="mono">
                          Edit expression
                        </Text>
                        <Textarea
                          value={editRawSql}
                          onChange={(e) => setEditRawSql(e.target.value)}
                          rows={3}
                          fontFamily="mono"
                          fontSize="xs"
                          resize="vertical"
                          bg="bg.subtle"
                          border="1px solid"
                          borderColor="border.default"
                          borderRadius="md"
                          _focus={{ borderColor: 'accent.teal', boxShadow: '0 0 0 1px var(--chakra-colors-accent-teal)' }}
                        />
                        <HStack gap={2}>
                          <Text fontSize="xs" color="fg.muted" fontFamily="mono" flexShrink={0}>as</Text>
                          <AliasInput
                            value={editRawAlias}
                            onChange={(a) => setEditRawAlias(a || '')}
                            placeholder="alias"
                          />
                        </HStack>
                        <Button size="xs" colorPalette="teal" fontFamily="mono" fontSize="xs" onClick={() => handleSaveRawColumn(index)}>
                          Apply
                        </Button>
                      </VStack>
                    </PickerPopover>
                  ) : (
                    <QueryChip
                      variant="neutral"
                      icon={<LuCode size={10} />}
                      isLocked
                      onRemove={() => handleRemoveExpression(index)}
                    >
                      <Text fontSize="xs" fontFamily="mono">{formatExpressionLabel(col)}</Text>
                    </QueryChip>
                  )}
                </Box>
              ))}
            </VStack>
          </Box>
        )}

        {/* Add expression — opens submenu to the right */}
        <Box borderTop="1px solid" borderColor="border.muted">
          <PickerPopover
            open={exprPopoverOpen}
            onOpenChange={(details) => {
              setExprPopoverOpen(details.open);
              if (!details.open) { setNewExprSql(''); setNewExprAlias(''); }
            }}
            positioning={{ placement: 'right' }}
            trigger={
              <HStack
                as="button"
                width="100%"
                px={3}
                py={2}
                gap={1.5}
                cursor="pointer"
                justify="space-between"
                color="fg.muted"
                _hover={{ bg: 'bg.muted', color: 'accent.teal' }}
                transition="all 0.15s ease"
                onClick={() => setExprPopoverOpen(true)}
              >
                <HStack gap={1.5}>
                  <LuPlus size={11} />
                  <Text fontSize="xs" fontWeight="500" fontFamily="mono">Add expression</Text>
                </HStack>
                <LuChevronRight size={12} />
              </HStack>
            }
            padding={3}
            width="280px"
          >
            <VStack gap={2} align="stretch">
              <Text fontSize="xs" fontWeight="600" color="fg.muted" textTransform="uppercase" letterSpacing="0.05em" fontFamily="mono">
                SQL Expression
              </Text>
              <Textarea
                value={newExprSql}
                onChange={(e) => setNewExprSql(e.target.value)}
                rows={3}
                fontFamily="mono"
                fontSize="xs"
                placeholder="CASE WHEN status = 'active' THEN 1 ELSE 0 END"
                resize="vertical"
                bg="bg.subtle"
                border="1px solid"
                borderColor="border.default"
                borderRadius="md"
                _focus={{ borderColor: 'accent.teal', boxShadow: '0 0 0 1px var(--chakra-colors-accent-teal)' }}
              />
              <HStack gap={2}>
                <Text fontSize="xs" color="fg.muted" fontFamily="mono" flexShrink={0}>as</Text>
                <AliasInput
                  value={newExprAlias}
                  onChange={(a) => setNewExprAlias(a || '')}
                  placeholder="alias"
                />
              </HStack>
              <Button
                size="xs"
                colorPalette="teal"
                onClick={handleAddExpression}
                disabled={!newExprSql.trim()}
                fontFamily="mono"
                fontSize="xs"
              >
                Add
              </Button>
            </VStack>
          </PickerPopover>
        </Box>
      </VStack>
    </PickerPopover>
  );
}
