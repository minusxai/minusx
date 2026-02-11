/**
 * ColumnsSection
 * Shows and manages SELECT columns for non-aggregate queries
 * (When using Summarize, columns are managed there instead)
 */

'use client';

import { useState, useEffect } from 'react';
import { Box, HStack, Text, VStack, Spinner, Popover, Portal, Button } from '@chakra-ui/react';
import { Checkbox } from '@/components/ui/checkbox';
import { SelectColumn } from '@/lib/sql/ir-types';
import { CompletionsAPI } from '@/lib/data/completions/completions';
import { QueryChip, AddChipButton, getColumnIcon } from './QueryChip';
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
      bg="rgba(255, 255, 255, 0.02)"
      borderRadius="lg"
      border="1px solid"
      borderColor="rgba(255, 255, 255, 0.06)"
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
              <Popover.Root
                key={index}
                open={editingIndex === index}
                onOpenChange={(details) => {
                  if (!details.open) {
                    setEditingIndex(null);
                    setEditAlias('');
                  }
                }}
              >
                <Popover.Trigger asChild>
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
                </Popover.Trigger>
                <Portal>
                  <Popover.Positioner>
                    <Popover.Content width="280px" bg="gray.900" borderColor="gray.700" border="1px solid" p={0} borderRadius="lg">
                      <Popover.Body p={3}>
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
                      </Popover.Body>
                    </Popover.Content>
                  </Popover.Positioner>
                </Portal>
              </Popover.Root>
            );
          })}

          {/* Add column button */}
          <Popover.Root open={popoverOpen} onOpenChange={(details) => setPopoverOpen(details.open)}>
            <Popover.Trigger asChild>
              <Box>
                <AddChipButton onClick={() => setPopoverOpen(true)} />
              </Box>
            </Popover.Trigger>
            <Portal>
              <Popover.Positioner>
                <Popover.Content width="220px" bg="gray.900" borderColor="gray.700" border="1px solid" p={0} overflow="hidden" borderRadius="lg">
                  <Popover.Body p={2} bg="gray.900">
                    <Text fontSize="xs" fontWeight="600" color="fg.muted" textTransform="uppercase" px={2} py={1.5}>
                      Available Columns
                    </Text>
                    <VStack gap={0.5} align="stretch" maxH="250px" overflowY="auto">
                      {loading ? (
                        <HStack px={2} py={3} justify="center">
                          <Spinner size="sm" />
                        </HStack>
                      ) : selectableColumns.length === 0 ? (
                        <Text fontSize="sm" color="fg.muted" px={2} py={2}>
                          All columns selected
                        </Text>
                      ) : (
                        selectableColumns.map((col) => (
                          <Box
                            key={col.name}
                            px={2}
                            py={1.5}
                            borderRadius="md"
                            cursor="pointer"
                            _hover={{ bg: 'rgba(255, 255, 255, 0.05)' }}
                            onClick={() => handleAddColumn(col.name)}
                          >
                            <Text fontSize="sm">{col.name}</Text>
                            {col.type && (
                              <Text fontSize="xs" color="fg.muted">
                                {col.type}
                              </Text>
                            )}
                          </Box>
                        ))
                      )}
                    </VStack>
                  </Popover.Body>
                </Popover.Content>
              </Popover.Positioner>
            </Portal>
          </Popover.Root>
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
