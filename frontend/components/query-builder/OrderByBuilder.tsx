/**
 * OrderByBuilder - Visual editor for ORDER BY clauses
 * Chip-based UI matching other query builder sections
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { Box, Text, HStack, VStack, Popover, Portal } from '@chakra-ui/react';
import { OrderByClause } from '@/lib/sql/ir-types';
import { CompletionsAPI } from '@/lib/data/completions/completions';
import { LuArrowUp, LuArrowDown, LuX } from 'react-icons/lu';
import { QueryChip, AddChipButton, getColumnIcon } from './QueryChip';

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
      bg="rgba(255, 255, 255, 0.02)"
      borderRadius="lg"
      border="1px solid"
      borderColor="rgba(255, 255, 255, 0.06)"
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
          <Popover.Root
            key={`sort-${idx}`}
            open={editingIndex === idx}
            onOpenChange={(details) => {
              if (!details.open) {
                setEditingIndex(null);
              }
            }}
          >
            <Popover.Trigger asChild>
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
            </Popover.Trigger>
            <Portal>
              <Popover.Positioner>
                <Popover.Content width="200px" bg="gray.900" borderColor="gray.700" border="1px solid" p={0} overflow="hidden" borderRadius="lg">
                  <Popover.Body p={2} bg="gray.900">
                    <Text fontSize="xs" fontWeight="600" color="fg.muted" textTransform="uppercase" px={2} py={1.5}>
                      {clause.column}
                    </Text>
                    <VStack gap={0.5} align="stretch" bg="gray.900">
                      <Box
                        px={2}
                        py={1.5}
                        borderRadius="md"
                        cursor="pointer"
                        bg={clause.direction === 'ASC' ? 'rgba(192, 132, 252, 0.15)' : 'transparent'}
                        _hover={{ bg: 'rgba(255, 255, 255, 0.05)' }}
                        onClick={() => handleToggleDirection(idx)}
                      >
                        <HStack gap={2}>
                          <Box color="fg.muted"><LuArrowUp size={14} /></Box>
                          <Text fontSize="sm">Ascending</Text>
                        </HStack>
                      </Box>
                      <Box
                        px={2}
                        py={1.5}
                        borderRadius="md"
                        cursor="pointer"
                        bg={clause.direction === 'DESC' ? 'rgba(192, 132, 252, 0.15)' : 'transparent'}
                        _hover={{ bg: 'rgba(255, 255, 255, 0.05)' }}
                        onClick={() => handleToggleDirection(idx)}
                      >
                        <HStack gap={2}>
                          <Box color="fg.muted"><LuArrowDown size={14} /></Box>
                          <Text fontSize="sm">Descending</Text>
                        </HStack>
                      </Box>
                    </VStack>
                  </Popover.Body>
                </Popover.Content>
              </Popover.Positioner>
            </Portal>
          </Popover.Root>
        ))}

        {/* Add sort popover */}
        <Popover.Root open={addSortOpen && editingIndex === null} onOpenChange={(details) => setAddSortOpen(details.open)}>
          <Popover.Trigger asChild>
            <Box>
              <AddChipButton onClick={() => setAddSortOpen(true)} variant="sort" />
            </Box>
          </Popover.Trigger>
          <Portal>
            <Popover.Positioner>
              <Popover.Content width="240px" bg="gray.900" borderColor="gray.700" border="1px solid" p={0} overflow="hidden" borderRadius="lg">
                <Popover.Body p={2} bg="gray.900">
                  <Text fontSize="xs" fontWeight="600" color="fg.muted" textTransform="uppercase" px={2} py={1.5}>
                    Sort by
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
                        onClick={() => handleAddSort(col.name)}
                      >
                        <HStack gap={2} justify="space-between">
                          <HStack gap={2}>
                            <Box color="fg.muted">{getColumnIcon(col.type)}</Box>
                            <Text fontSize="sm">{col.name}</Text>
                          </HStack>
                          <HStack gap={1}>
                            <Box
                              as="button"
                              p={1}
                              borderRadius="sm"
                              color="fg.muted"
                              _hover={{ bg: 'rgba(192, 132, 252, 0.2)', color: '#c084fc' }}
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
                              _hover={{ bg: 'rgba(192, 132, 252, 0.2)', color: '#c084fc' }}
                              onClick={(e: React.MouseEvent) => {
                                e.stopPropagation();
                                handleAddSort(col.name, 'DESC');
                              }}
                            >
                              <LuArrowDown size={12} />
                            </Box>
                          </HStack>
                        </HStack>
                      </Box>
                    ))}
                  </VStack>
                </Popover.Body>
              </Popover.Content>
            </Popover.Positioner>
          </Portal>
        </Popover.Root>

        {clauses.length === 0 && (
          <Text fontSize="xs" color="fg.muted" fontStyle="italic">
            Click + to add sorting
          </Text>
        )}
      </HStack>
    </Box>
  );
}
