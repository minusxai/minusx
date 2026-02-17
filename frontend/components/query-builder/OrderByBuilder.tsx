/**
 * OrderByBuilder - Visual editor for ORDER BY clauses
 * Chip-based UI matching other query builder sections
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { Box, Text, HStack } from '@chakra-ui/react';
import { OrderByClause } from '@/lib/sql/ir-types';
import { CompletionsAPI } from '@/lib/data/completions/completions';
import { LuArrowUp, LuArrowDown, LuX } from 'react-icons/lu';
import { QueryChip, AddChipButton, getColumnIcon } from './QueryChip';
import { PickerPopover, PickerHeader, PickerList, PickerItem } from './PickerPopover';

interface OrderByBuilderProps {
  databaseName: string;
  tableName: string;
  tableSchema?: string;
  orderBy?: OrderByClause[];
  onChange: (orderBy: OrderByClause[] | undefined) => void;
  onClose?: () => void;
}

export function OrderByBuilder({
  databaseName,
  tableName,
  tableSchema,
  orderBy = [],
  onChange,
  onClose,
}: OrderByBuilderProps) {
  const clauses = orderBy || [];

  const [availableColumns, setAvailableColumns] = useState<
    Array<{ name: string; type?: string; displayName: string }>
  >([]);
  const [addSortOpen, setAddSortOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  useEffect(() => {
    async function loadColumns() {
      if (!tableName) return;

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

  const handleAddSort = useCallback(
    (columnName: string, direction: 'ASC' | 'DESC' = 'ASC') => {
      const newClause: OrderByClause = {
        type: 'column',
        column: columnName,
        direction,
      };

      onChange([...clauses, newClause]);
      setAddSortOpen(false);
    },
    [clauses, onChange]
  );

  const handleRemoveSort = useCallback(
    (index: number) => {
      const newOrderBy = clauses.filter((_, i) => i !== index);
      onChange(newOrderBy.length > 0 ? newOrderBy : undefined);
    },
    [clauses, onChange]
  );

  const handleToggleDirection = useCallback(
    (index: number) => {
      const newOrderBy = [...clauses];
      newOrderBy[index] = {
        ...newOrderBy[index],
        direction: newOrderBy[index].direction === 'ASC' ? 'DESC' : 'ASC',
      };
      onChange(newOrderBy);
      setEditingIndex(null);
    },
    [clauses, onChange]
  );

  const getDirectionIcon = (direction: 'ASC' | 'DESC') => {
    return direction === 'ASC' ? <LuArrowUp size={11} /> : <LuArrowDown size={11} />;
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
          Sort
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
        {/* Sort chips */}
        {clauses.map((clause, idx) => (
          <PickerPopover
            key={`sort-${idx}`}
            open={editingIndex === idx}
            onOpenChange={(details) => {
              if (!details.open) {
                setEditingIndex(null);
              }
            }}
            trigger={
              <Box>
                <QueryChip
                  variant="sort"
                  icon={getDirectionIcon(clause.direction)}
                  onRemove={() => handleRemoveSort(idx)}
                  onClick={() => setEditingIndex(idx)}
                  isActive={editingIndex === idx}
                >
                  {clause.column}
                </QueryChip>
              </Box>
            }
            width="200px"
          >
            <PickerHeader>{clause.column}</PickerHeader>
            <PickerList>
              <PickerItem
                icon={<LuArrowUp size={14} />}
                selected={clause.direction === 'ASC'}
                selectedBg="rgba(192, 132, 252, 0.15)"
                onClick={() => handleToggleDirection(idx)}
              >
                Ascending
              </PickerItem>
              <PickerItem
                icon={<LuArrowDown size={14} />}
                selected={clause.direction === 'DESC'}
                selectedBg="rgba(192, 132, 252, 0.15)"
                onClick={() => handleToggleDirection(idx)}
              >
                Descending
              </PickerItem>
            </PickerList>
          </PickerPopover>
        ))}

        {/* Add sort popover */}
        <PickerPopover
          open={addSortOpen && editingIndex === null}
          onOpenChange={(details) => setAddSortOpen(details.open)}
          trigger={
            <Box>
              <AddChipButton onClick={() => setAddSortOpen(true)} variant="sort" />
            </Box>
          }
          width="240px"
        >
          <PickerHeader>Sort by</PickerHeader>
          <PickerList maxH="250px" searchable searchPlaceholder="Search columns...">
            {(query) =>
              availableColumns
                .filter((col) => !query || col.name.toLowerCase().includes(query.toLowerCase()))
                .map((col) => (
                  <PickerItem
                    key={col.name}
                    icon={getColumnIcon(col.type)}
                    onClick={() => handleAddSort(col.name)}
                    rightElement={
                      <HStack gap={1}>
                        <Box
                          as="button"
                          p={1}
                          borderRadius="sm"
                          color="fg.muted"
                          _hover={{ bg: 'bg.muted', color: 'accent.secondary' }}
                          onClick={(e: React.MouseEvent) => {
                            e.stopPropagation();
                            handleAddSort(col.name, 'ASC');
                          }}
                        >
                          <LuArrowUp size={12} />
                        </Box>
                        <Box
                          as="button"
                          p={1}
                          borderRadius="sm"
                          color="fg.muted"
                          _hover={{ bg: 'bg.muted', color: 'accent.secondary' }}
                          onClick={(e: React.MouseEvent) => {
                            e.stopPropagation();
                            handleAddSort(col.name, 'DESC');
                          }}
                        >
                          <LuArrowDown size={12} />
                        </Box>
                      </HStack>
                    }
                  >
                    {col.name}
                  </PickerItem>
                ))
            }
          </PickerList>
        </PickerPopover>

        {clauses.length === 0 && (
          <Text fontSize="xs" color="fg.muted" fontStyle="italic">
            Click + to add sorting
          </Text>
        )}
      </HStack>
    </Box>
  );
}
