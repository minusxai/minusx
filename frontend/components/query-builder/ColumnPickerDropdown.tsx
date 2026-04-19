/**
 * ColumnPickerDropdown
 * Shared single-select column picker using PickerPopover + PickerList + PickerItem.
 * Matches the visual style of the ColumnsPicker multi-select dropdown.
 */

'use client';

import { useState, useEffect } from 'react';
import { Box, HStack, Text, Spinner } from '@chakra-ui/react';
import { CompletionsAPI } from '@/lib/data/completions/completions';
import { PickerPopover, PickerList, PickerItem } from './PickerPopover';
import { LuChevronDown, LuCheck } from 'react-icons/lu';
import { getColumnIcon } from './QueryChip';

interface ColumnPickerDropdownProps {
  databaseName: string;
  tableName: string;
  tableSchema?: string;
  value: string;
  onChange: (column: string) => void;
  placeholder?: string;
  /** Pre-loaded columns — if provided, skips the API call */
  availableColumns?: Array<{ name: string; type?: string }>;
  /** Extra items to show before the column list */
  extraItems?: Array<{ label: string; value: string }>;
}

export function ColumnPickerDropdown({
  databaseName,
  tableName,
  tableSchema,
  value,
  onChange,
  placeholder = 'Select column...',
  availableColumns: externalColumns,
  extraItems,
}: ColumnPickerDropdownProps) {
  const [internalColumns, setInternalColumns] = useState<Array<{ name: string; type?: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const columns = externalColumns ?? internalColumns;

  // Only fetch if external columns not provided
  useEffect(() => {
    if (externalColumns) return;
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
          setInternalColumns(result.columns);
        }
      } catch (err) {
        console.error('Failed to load columns:', err);
      } finally {
        setLoading(false);
      }
    }
    loadColumns();
  }, [databaseName, tableName, tableSchema, externalColumns]);

  const selectedCol = columns.find(c => c.name === value);
  const selectedExtra = extraItems?.find(e => e.value === value);

  return (
    <PickerPopover
      open={open}
      onOpenChange={(details) => setOpen(details.open)}
      trigger={
        <HStack
          as="button"
          width="100%"
          px={3}
          py={1.5}
          borderRadius="md"
          border="1px solid"
          borderColor={open ? 'accent.teal' : 'border.default'}
          bg="bg.subtle"
          cursor="pointer"
          justify="space-between"
          transition="all 0.15s ease"
          _hover={{ borderColor: 'border.emphasized' }}
          onClick={() => setOpen(true)}
        >
          <HStack gap={1.5}>
            {selectedCol && getColumnIcon(selectedCol.type)}
            <Text fontSize="xs" fontFamily="mono" color={value ? 'fg' : 'fg.muted'}>
              {selectedExtra?.label ?? selectedCol?.name ?? (value || placeholder)}
            </Text>
          </HStack>
          <Box color="fg.muted"><LuChevronDown size={12} /></Box>
        </HStack>
      }
      width="240px"
      padding={0}
    >
      <Box px={1} py={1}>
        <PickerList maxH="220px" searchable searchPlaceholder="Search columns...">
          {(query) =>
            loading ? (
              <HStack px={2} py={3} justify="center">
                <Spinner size="sm" />
              </HStack>
            ) : (
              <>
                {/* Extra items (e.g. "* (all rows)" for COUNT) */}
                {extraItems && !query && extraItems.map(item => (
                  <PickerItem
                    key={item.value}
                    onClick={() => { onChange(item.value); setOpen(false); }}
                    selected={value === item.value}
                    selectedBg="rgba(45, 212, 191, 0.08)"
                    rightElement={
                      value === item.value ? (
                        <Box color="accent.teal"><LuCheck size={12} /></Box>
                      ) : undefined
                    }
                  >
                    <Text fontSize="xs" fontFamily="mono" fontWeight={value === item.value ? '600' : '400'}>
                      {item.label}
                    </Text>
                  </PickerItem>
                ))}
                {/* Column list */}
                {columns
                  .filter(col => !query || col.name.toLowerCase().includes(query.toLowerCase()))
                  .map(col => {
                    const selected = value === col.name;
                    return (
                      <PickerItem
                        key={col.name}
                        onClick={() => { onChange(col.name); setOpen(false); }}
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
                  })}
              </>
            )
          }
        </PickerList>
      </Box>
    </PickerPopover>
  );
}
