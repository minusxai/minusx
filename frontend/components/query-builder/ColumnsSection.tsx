/**
 * ColumnsSection
 * Shows and manages SELECT columns for non-aggregate queries
 * (When using Summarize, columns are managed there instead)
 */

'use client';

import { useState, useEffect } from 'react';
import { Box, HStack, Text, VStack, Spinner, Button } from '@chakra-ui/react';
import { Checkbox } from '@/components/ui/checkbox';
import { SelectColumn } from '@/lib/sql/ir-types';
import { CompletionsAPI } from '@/lib/data/completions/completions';
import { QueryChip, AddChipButton, getColumnIcon } from './QueryChip';
import { PickerPopover, PickerHeader, PickerList, PickerItem } from './PickerPopover';
import { AliasInput } from './AliasInput';
import { LuX } from 'react-icons/lu';

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
            if (col.type !== 'column' || col.column === '*') return null;

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
