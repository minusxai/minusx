/**
 * JoinBuilder - Visual editor for JOIN clauses
 * Chip-based UI matching other query builder sections
 */

'use client';

import { useState, useEffect } from 'react';
import { Box, Text, HStack, VStack, Popover, Portal } from '@chakra-ui/react';
import { JoinClause, TableReference } from '@/lib/sql/ir-types';
import { CompletionsAPI } from '@/lib/data/completions/completions';
import { QueryChip, getColumnIcon } from './QueryChip';
import { LuX, LuGitMerge } from 'react-icons/lu';

interface TableInfo {
  alias: string;
  tableName: string;
  schema?: string;
}

interface JoinBuilderProps {
  databaseName: string;
  joins: JoinClause[];
  onChange: (joins: JoinClause[]) => void;
  fromTable: TableReference;
  existingTables: string[];
  onClose?: () => void;
}

export function JoinBuilder({
  databaseName,
  joins,
  onChange,
  fromTable,
  existingTables,
  onClose,
}: JoinBuilderProps) {
  const [availableTables, setAvailableTables] = useState<
    Array<{ name: string; schema?: string; displayName: string }>
  >([]);
  const [loading, setLoading] = useState(false);

  // Cache columns for each table
  const [tableColumnsCache, setTableColumnsCache] = useState<
    Record<string, Array<{ name: string; type?: string }>>
  >({});

  // Popover states
  const [addJoinOpen, setAddJoinOpen] = useState(false);
  const [editingJoinIndex, setEditingJoinIndex] = useState<number | null>(null);
  const [addConditionForJoin, setAddConditionForJoin] = useState<number | null>(null);

  useEffect(() => {
    async function loadTables() {
      setLoading(true);
      try {
        const result = await CompletionsAPI.getTableSuggestions({ databaseName });
        if (result.success && result.tables) {
          setAvailableTables(result.tables);
        }
      } catch (err) {
        console.error('Failed to load tables:', err);
      } finally {
        setLoading(false);
      }
    }
    loadTables();
  }, [databaseName]);

  // Load columns for a specific table (with caching)
  const loadColumnsForTable = async (tableName: string, schema?: string) => {
    const cacheKey = schema ? `${schema}.${tableName}` : tableName;
    if (tableColumnsCache[cacheKey]) return tableColumnsCache[cacheKey];

    try {
      const result = await CompletionsAPI.getColumnSuggestions({
        databaseName,
        table: tableName,
        schema,
      });
      if (result.success && result.columns) {
        setTableColumnsCache((prev) => ({ ...prev, [cacheKey]: result.columns || [] }));
        return result.columns;
      }
    } catch (err) {
      console.error(`Failed to load columns for ${cacheKey}:`, err);
    }
    return [];
  };

  // Build a map from alias/name to actual table info
  const getTableInfoMap = (): Map<string, TableInfo> => {
    const map = new Map<string, TableInfo>();
    const fromKey = fromTable.alias || fromTable.table;
    if (fromKey) {
      map.set(fromKey, { alias: fromKey, tableName: fromTable.table, schema: fromTable.schema });
    }
    joins.forEach((join) => {
      const joinKey = join.table.alias || join.table.table;
      if (joinKey) {
        map.set(joinKey, { alias: joinKey, tableName: join.table.table, schema: join.table.schema });
      }
    });
    return map;
  };

  // Get columns for a table (resolves alias to actual table)
  const getColumnsForTable = (aliasOrName: string): Array<{ name: string; type?: string }> => {
    if (!aliasOrName) return [];
    const tableInfoMap = getTableInfoMap();
    const resolved = tableInfoMap.get(aliasOrName);
    const actualTableName = resolved?.tableName || aliasOrName;
    const schema = resolved?.schema;
    const cacheKey = schema ? `${schema}.${actualTableName}` : actualTableName;

    if (tableColumnsCache[cacheKey]) return tableColumnsCache[cacheKey];

    const tableInfo = availableTables.find(t => t.name === actualTableName || t.displayName === actualTableName);
    loadColumnsForTable(actualTableName, schema || tableInfo?.schema);
    return [];
  };

  // Preload columns
  useEffect(() => {
    if (fromTable.table) loadColumnsForTable(fromTable.table, fromTable.schema);
    joins.forEach((join) => {
      if (join.table.table) loadColumnsForTable(join.table.table, join.table.schema);
    });
  }, [fromTable.table, fromTable.schema, joins]);

  const handleAddJoin = (displayName: string) => {
    const table = availableTables.find((t) => t.displayName === displayName);
    if (!table) return;

    const newJoin: JoinClause = {
      type: 'INNER',
      table: { table: table.name, schema: table.schema, alias: undefined },
      on: [],
    };
    onChange([...joins, newJoin]);
    setAddJoinOpen(false);
  };

  const handleRemoveJoin = (index: number) => {
    onChange(joins.filter((_, i) => i !== index));
  };

  const handleChangeJoinType = (index: number, type: 'INNER' | 'LEFT') => {
    const newJoins = [...joins];
    newJoins[index] = { ...newJoins[index], type };
    onChange(newJoins);
  };

  const handleChangeJoinTable = (index: number, displayName: string) => {
    const table = availableTables.find((t) => t.displayName === displayName);
    if (!table) return;
    const newJoins = [...joins];
    newJoins[index] = {
      ...newJoins[index],
      table: { table: table.name, schema: table.schema, alias: undefined },
    };
    onChange(newJoins);
  };

  const handleAddCondition = (joinIndex: number, leftTable: string, leftCol: string, rightTable: string, rightCol: string) => {
    const newJoins = [...joins];
    newJoins[joinIndex].on.push({
      left_table: leftTable,
      left_column: leftCol,
      right_table: rightTable,
      right_column: rightCol,
    });
    onChange(newJoins);
    setAddConditionForJoin(null);
  };

  const handleRemoveCondition = (joinIndex: number, condIndex: number) => {
    const newJoins = [...joins];
    newJoins[joinIndex].on = newJoins[joinIndex].on.filter((_, i) => i !== condIndex);
    onChange(newJoins);
  };

  const getTableDisplayName = (table: TableReference) => {
    return table.schema ? `${table.schema}.${table.table}` : table.table;
  };

  const formatJoinLabel = (join: JoinClause) => {
    const tableName = join.table.alias || getTableDisplayName(join.table);
    return `${join.type} JOIN ${tableName}`;
  };

  const formatConditionLabel = (cond: JoinClause['on'][0]) => {
    return `${cond.left_table}.${cond.left_column} = ${cond.right_table}.${cond.right_column}`;
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
          Join
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

      <VStack align="stretch" gap={3}>
        {/* Existing joins */}
        {joins.map((join, joinIndex) => (
          <Box key={joinIndex}>
            <HStack gap={2} flexWrap="wrap" align="center" mb={join.on.length > 0 ? 2 : 0}>
              {/* Join chip - clickable to edit */}
              <Popover.Root
                open={editingJoinIndex === joinIndex}
                onOpenChange={(details) => {
                  if (!details.open) setEditingJoinIndex(null);
                }}
              >
                <Popover.Trigger asChild>
                  <Box>
                    <QueryChip
                      variant="table"
                      icon={<LuGitMerge size={11} />}
                      onRemove={() => handleRemoveJoin(joinIndex)}
                      onClick={() => setEditingJoinIndex(joinIndex)}
                      isActive={editingJoinIndex === joinIndex}
                    >
                      {formatJoinLabel(join)}
                    </QueryChip>
                  </Box>
                </Popover.Trigger>
                <Portal>
                  <Popover.Positioner>
                    <Popover.Content width="280px" bg="gray.900" borderColor="gray.700" border="1px solid" p={0} overflow="hidden" borderRadius="lg">
                      <Popover.Body p={2} bg="gray.900">
                        {/* Join type */}
                        <Text fontSize="xs" fontWeight="600" color="fg.muted" textTransform="uppercase" px={2} py={1.5}>
                          Join Type
                        </Text>
                        <VStack gap={0.5} align="stretch" mb={2}>
                          {(['INNER', 'LEFT'] as const).map((type) => (
                            <Box
                              key={type}
                              px={2}
                              py={1.5}
                              borderRadius="md"
                              cursor="pointer"
                              bg={join.type === type ? 'rgba(99, 102, 241, 0.15)' : 'transparent'}
                              _hover={{ bg: 'rgba(255, 255, 255, 0.05)' }}
                              onClick={() => handleChangeJoinType(joinIndex, type)}
                            >
                              <Text fontSize="sm">{type} JOIN</Text>
                            </Box>
                          ))}
                        </VStack>

                        {/* Table selection */}
                        <Text fontSize="xs" fontWeight="600" color="fg.muted" textTransform="uppercase" px={2} py={1.5}>
                          Table
                        </Text>
                        <VStack gap={0.5} align="stretch" maxH="200px" overflowY="auto">
                          {availableTables.map((table) => (
                            <Box
                              key={table.displayName}
                              px={2}
                              py={1.5}
                              borderRadius="md"
                              cursor="pointer"
                              bg={getTableDisplayName(join.table) === table.displayName ? 'rgba(99, 102, 241, 0.15)' : 'transparent'}
                              _hover={{ bg: 'rgba(255, 255, 255, 0.05)' }}
                              onClick={() => {
                                handleChangeJoinTable(joinIndex, table.displayName);
                                setEditingJoinIndex(null);
                              }}
                            >
                              <Text fontSize="sm">{table.displayName}</Text>
                            </Box>
                          ))}
                        </VStack>
                      </Popover.Body>
                    </Popover.Content>
                  </Popover.Positioner>
                </Portal>
              </Popover.Root>

              <Text fontSize="xs" color="fg.muted" fontWeight="500">
                on
              </Text>

              {/* Condition chips */}
              {join.on.map((condition, condIndex) => (
                <QueryChip
                  key={condIndex}
                  variant="filter"
                  onRemove={() => handleRemoveCondition(joinIndex, condIndex)}
                >
                  {formatConditionLabel(condition)}
                </QueryChip>
              ))}

              {/* Add condition */}
              <Popover.Root
                open={addConditionForJoin === joinIndex}
                onOpenChange={(details) => {
                  if (!details.open) setAddConditionForJoin(null);
                }}
              >
                <Popover.Trigger asChild>
                  <Box
                    as="button"
                    display="inline-flex"
                    alignItems="center"
                    gap={1}
                    bg="transparent"
                    border="1px dashed"
                    borderColor="rgba(147, 197, 253, 0.28)"
                    borderRadius="md"
                    px={2}
                    py={1}
                    cursor="pointer"
                    transition="all 0.15s ease"
                    _hover={{ bg: 'rgba(147, 197, 253, 0.1)', borderStyle: 'solid' }}
                    onClick={() => setAddConditionForJoin(joinIndex)}
                  >
                    <Text fontSize="xs" color="#93c5fd" fontWeight="500">+ on</Text>
                  </Box>
                </Popover.Trigger>
                <Portal>
                  <Popover.Positioner>
                    <Popover.Content width="320px" bg="gray.900" borderColor="gray.700" border="1px solid" p={0} overflow="hidden" borderRadius="lg">
                      <Popover.Body p={2} bg="gray.900">
                        <Text fontSize="xs" fontWeight="600" color="fg.muted" textTransform="uppercase" px={2} py={1.5}>
                          Add Condition
                        </Text>
                        <ConditionBuilder
                          existingTables={existingTables}
                          getColumnsForTable={getColumnsForTable}
                          fromTable={fromTable}
                          joinTable={join.table}
                          onAdd={(left, leftCol, right, rightCol) => {
                            handleAddCondition(joinIndex, left, leftCol, right, rightCol);
                          }}
                        />
                      </Popover.Body>
                    </Popover.Content>
                  </Popover.Positioner>
                </Portal>
              </Popover.Root>
            </HStack>
          </Box>
        ))}

        {/* Add join */}
        <Popover.Root open={addJoinOpen} onOpenChange={(details) => setAddJoinOpen(details.open)}>
          <Popover.Trigger asChild>
            <Box
              as="button"
              display="inline-flex"
              alignItems="center"
              gap={1.5}
              bg="transparent"
              border="1px dashed"
              borderColor="rgba(99, 102, 241, 0.3)"
              borderRadius="md"
              px={2.5}
              py={1}
              cursor="pointer"
              transition="all 0.15s ease"
              _hover={{ bg: 'rgba(99, 102, 241, 0.1)', borderStyle: 'solid' }}
              onClick={() => setAddJoinOpen(true)}
            >
              <Text fontSize="sm" color="#a5b4fc" fontWeight="500">+</Text>
              <Text fontSize="xs" color="#a5b4fc" fontWeight="500">Add Join</Text>
            </Box>
          </Popover.Trigger>
          <Portal>
            <Popover.Positioner>
              <Popover.Content width="280px" bg="gray.900" borderColor="gray.700" border="1px solid" p={0} overflow="hidden" borderRadius="lg">
                <Popover.Body p={2} bg="gray.900">
                  <Text fontSize="xs" fontWeight="600" color="fg.muted" textTransform="uppercase" px={2} py={1.5}>
                    Join Table
                  </Text>
                  <VStack gap={0.5} align="stretch" maxH="250px" overflowY="auto">
                    {loading ? (
                      <Text fontSize="sm" color="fg.muted" px={2} py={1.5}>Loading...</Text>
                    ) : (
                      availableTables.map((table) => (
                        <Box
                          key={table.displayName}
                          px={2}
                          py={1.5}
                          borderRadius="md"
                          cursor="pointer"
                          _hover={{ bg: 'rgba(255, 255, 255, 0.05)' }}
                          onClick={() => handleAddJoin(table.displayName)}
                        >
                          <Text fontSize="sm">{table.displayName}</Text>
                        </Box>
                      ))
                    )}
                  </VStack>
                </Popover.Body>
              </Popover.Content>
            </Popover.Positioner>
          </Portal>
        </Popover.Root>
      </VStack>
    </Box>
  );
}

// Helper component for building conditions
interface ConditionBuilderProps {
  existingTables: string[];
  getColumnsForTable: (table: string) => Array<{ name: string; type?: string }>;
  fromTable: TableReference;
  joinTable: TableReference;
  onAdd: (leftTable: string, leftCol: string, rightTable: string, rightCol: string) => void;
}

function ConditionBuilder({ existingTables, getColumnsForTable, fromTable, joinTable, onAdd }: ConditionBuilderProps) {
  const [leftTable, setLeftTable] = useState(fromTable.alias || fromTable.table);
  const [leftCol, setLeftCol] = useState('');
  const [rightTable, setRightTable] = useState(joinTable.alias || joinTable.table);
  const [rightCol, setRightCol] = useState('');

  const leftColumns = getColumnsForTable(leftTable);
  const rightColumns = getColumnsForTable(rightTable);

  const canAdd = leftTable && leftCol && rightTable && rightCol;

  return (
    <VStack gap={2} align="stretch">
      {/* Left side */}
      <HStack gap={2}>
        <Box flex={1}>
          <Text fontSize="xs" color="fg.muted" mb={1}>Left Table</Text>
          <VStack gap={0.5} align="stretch" maxH="100px" overflowY="auto" bg="rgba(0,0,0,0.2)" borderRadius="md" p={1}>
            {existingTables.map((t) => (
              <Box
                key={t}
                px={2}
                py={1}
                borderRadius="sm"
                cursor="pointer"
                fontSize="xs"
                bg={leftTable === t ? 'rgba(99, 102, 241, 0.2)' : 'transparent'}
                _hover={{ bg: 'rgba(255, 255, 255, 0.05)' }}
                onClick={() => { setLeftTable(t); setLeftCol(''); }}
              >
                {t}
              </Box>
            ))}
          </VStack>
        </Box>
        <Box flex={1}>
          <Text fontSize="xs" color="fg.muted" mb={1}>Column</Text>
          <VStack gap={0.5} align="stretch" maxH="100px" overflowY="auto" bg="rgba(0,0,0,0.2)" borderRadius="md" p={1}>
            {leftColumns.map((c) => (
              <Box
                key={c.name}
                px={2}
                py={1}
                borderRadius="sm"
                cursor="pointer"
                fontSize="xs"
                bg={leftCol === c.name ? 'rgba(99, 102, 241, 0.2)' : 'transparent'}
                _hover={{ bg: 'rgba(255, 255, 255, 0.05)' }}
                onClick={() => setLeftCol(c.name)}
              >
                <HStack gap={1}>
                  <Box color="fg.muted">{getColumnIcon(c.type)}</Box>
                  <Text>{c.name}</Text>
                </HStack>
              </Box>
            ))}
          </VStack>
        </Box>
      </HStack>

      <Text fontSize="xs" color="fg.muted" textAlign="center">=</Text>

      {/* Right side */}
      <HStack gap={2}>
        <Box flex={1}>
          <Text fontSize="xs" color="fg.muted" mb={1}>Right Table</Text>
          <VStack gap={0.5} align="stretch" maxH="100px" overflowY="auto" bg="rgba(0,0,0,0.2)" borderRadius="md" p={1}>
            {existingTables.map((t) => (
              <Box
                key={t}
                px={2}
                py={1}
                borderRadius="sm"
                cursor="pointer"
                fontSize="xs"
                bg={rightTable === t ? 'rgba(99, 102, 241, 0.2)' : 'transparent'}
                _hover={{ bg: 'rgba(255, 255, 255, 0.05)' }}
                onClick={() => { setRightTable(t); setRightCol(''); }}
              >
                {t}
              </Box>
            ))}
          </VStack>
        </Box>
        <Box flex={1}>
          <Text fontSize="xs" color="fg.muted" mb={1}>Column</Text>
          <VStack gap={0.5} align="stretch" maxH="100px" overflowY="auto" bg="rgba(0,0,0,0.2)" borderRadius="md" p={1}>
            {rightColumns.map((c) => (
              <Box
                key={c.name}
                px={2}
                py={1}
                borderRadius="sm"
                cursor="pointer"
                fontSize="xs"
                bg={rightCol === c.name ? 'rgba(99, 102, 241, 0.2)' : 'transparent'}
                _hover={{ bg: 'rgba(255, 255, 255, 0.05)' }}
                onClick={() => setRightCol(c.name)}
              >
                <HStack gap={1}>
                  <Box color="fg.muted">{getColumnIcon(c.type)}</Box>
                  <Text>{c.name}</Text>
                </HStack>
              </Box>
            ))}
          </VStack>
        </Box>
      </HStack>

      {/* Add button */}
      <Box
        as="button"
        mt={1}
        px={3}
        py={1.5}
        borderRadius="md"
        bg={canAdd ? 'rgba(45, 212, 191, 0.2)' : 'rgba(255, 255, 255, 0.05)'}
        color={canAdd ? '#2dd4bf' : 'fg.muted'}
        fontSize="sm"
        fontWeight="500"
        cursor={canAdd ? 'pointer' : 'not-allowed'}
        opacity={canAdd ? 1 : 0.5}
        _hover={canAdd ? { bg: 'rgba(45, 212, 191, 0.3)' } : undefined}
        onClick={() => canAdd && onAdd(leftTable, leftCol, rightTable, rightCol)}
      >
        Add Condition
      </Box>
    </VStack>
  );
}
