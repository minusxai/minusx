'use client';

import { useState, useMemo, useEffect } from 'react';
import { Box, VStack, HStack, Text, Icon, Collapsible, IconButton, Input } from '@chakra-ui/react';
import { LuTable, LuChevronRight, LuChevronDown, LuColumns3, LuSearch, LuX, LuDatabase, LuEye, LuRefreshCw } from 'react-icons/lu';
import { Checkbox } from '@/components/ui/checkbox';
import ChildPathSelector from './ChildPathSelector';

// Types for the component
export interface SchemaTreeItem {
  schema: string;
  tables: Array<{
    table: string;
    columns: Array<{
      name: string;
      type: string;
    }>;
  }>;
}

export interface WhitelistItem {
  type: 'schema' | 'table';
  name: string;
  schema?: string;
  childPaths?: string[];  // NEW: Optional child path filtering
}

interface SchemaTreeViewProps {
  schemas: SchemaTreeItem[];

  // Selection mode
  selectable?: boolean;
  whitelist?: WhitelistItem[];
  onWhitelistChange?: (whitelist: WhitelistItem[]) => void;

  // Display options
  showColumns?: boolean;
  showStats?: boolean;

  // NEW: Path filtering options
  showPathFilter?: boolean;  // Enable path filtering UI
  availableChildPaths?: string[];  // List of immediate child paths

  // Table preview callback (for question page only)
  onTablePreview?: (schemaName: string, tableName: string) => void;

  // Error handling
  schemaError?: string | null;
  connectionName?: string;
  onRetry?: () => void;  // Refresh schema from backend

  /** Start with all schemas expanded */
  defaultExpandedSchemas?: boolean;

  /** When true, the entire connection is wildcarded (databases === '*') */
  connectionWhitelisted?: boolean;
}

const TABLES_PER_PAGE = 25;
const COLUMNS_PER_PAGE = 5;

export default function SchemaTreeView({
  schemas,
  selectable = false,
  whitelist = [],
  onWhitelistChange,
  showColumns = true,
  showStats = false,
  showPathFilter = false,
  availableChildPaths = [],
  onTablePreview,
  schemaError,
  connectionName,
  onRetry,
  defaultExpandedSchemas = false,
  connectionWhitelisted = false,
}: SchemaTreeViewProps) {
  const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(() =>
    defaultExpandedSchemas ? new Set(schemas.map(s => s.schema)) : new Set()
  );
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [whitelistForSort, setWhitelistForSort] = useState(whitelist);

  // Update sort snapshot when new schema data is loaded (fresh data gets fresh sort)
  useEffect(() => {
    setWhitelistForSort(whitelist);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schemas]);

  // Track visible counts for tables in each schema
  const [visibleTableCounts, setVisibleTableCounts] = useState<Record<string, number>>({});

  // Track visible counts for columns in each table
  const [visibleColumnCounts, setVisibleColumnCounts] = useState<Record<string, number>>({});

  // Selection helpers (defined early so they can be used in useMemo)
  const isSchemaWhitelisted = (schemaName: string): boolean => {
    if (!selectable) return false;
    return whitelist.some(item => item.type === 'schema' && item.name === schemaName);
  };

  const isTableWhitelisted = (schemaName: string, tableName: string): boolean => {
    if (!selectable) return false;
    return whitelist.some(
      item => item.type === 'table' && item.name === tableName && item.schema === schemaName
    );
  };

  // Filter and sort schemas/tables based on search query and selection
  const filteredSchemas = useMemo(() => {
    let result = schemas;

    // Apply search filter if query exists
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = schemas
        .map((schemaItem) => {
          // Filter tables within this schema
          const filteredTables = schemaItem.tables.filter((table) => {
            // Check if schema name matches
            if (schemaItem.schema.toLowerCase().includes(query)) {
              return true;
            }

            // Check if table name matches
            if (table.table.toLowerCase().includes(query)) {
              return true;
            }

            // Check if any column name matches (if showing columns)
            if (showColumns) {
              return table.columns.some((col) =>
                col.name.toLowerCase().includes(query)
              );
            }

            return false;
          });

          return {
            ...schemaItem,
            tables: filteredTables
          };
        })
        .filter((schemaItem) => schemaItem.tables.length > 0);
    }

    // Sort schemas: selected ones first (only in selectable mode)
    // Uses whitelistForSort (a snapshot) so toggling checkboxes doesn't cause re-sort mid-interaction.
    // The snapshot is refreshed on schema collapse and when schemas prop changes.
    if (selectable) {
      result = [...result].sort((a, b) => {
        const aSelected = whitelistForSort.some(item => item.type === 'schema' && item.name === a.schema);
        const bSelected = whitelistForSort.some(item => item.type === 'schema' && item.name === b.schema);

        if (aSelected && !bSelected) return -1;
        if (!aSelected && bSelected) return 1;

        // If both selected or both not selected, maintain original order
        return 0;
      });

      // Sort tables within each schema: selected ones first
      result = result.map((schemaItem) => {
        const sortedTables = [...schemaItem.tables].sort((a, b) => {
          const aSelected = whitelistForSort.some(item => item.type === 'table' && item.name === a.table && item.schema === schemaItem.schema);
          const bSelected = whitelistForSort.some(item => item.type === 'table' && item.name === b.table && item.schema === schemaItem.schema);

          if (aSelected && !bSelected) return -1;
          if (!aSelected && bSelected) return 1;

          return 0;
        });

        return {
          ...schemaItem,
          tables: sortedTables
        };
      });
    }

    return result;
  }, [schemas, searchQuery, showColumns, selectable, whitelistForSort]);

  // Get filtered columns for a table
  const getFilteredColumns = (schemaName: string, table: { table: string; columns: Array<{ name: string; type: string }> }) => {
    if (!searchQuery.trim()) {
      return table.columns;
    }

    const query = searchQuery.toLowerCase();
    // If schema name matches, show all columns
    if (schemaName.toLowerCase().includes(query)) {
      return table.columns;
    }

    // If table name matches, show all columns
    if (table.table.toLowerCase().includes(query)) {
      return table.columns;
    }

    // Otherwise, only show matching columns
    return table.columns.filter((col) =>
      col.name.toLowerCase().includes(query)
    );
  };

  const getSchemaTables = (schema: SchemaTreeItem): number => {
    if (!selectable) return 0;
    return whitelist.filter(
      item => item.type === 'table' && item.schema === schema.schema
    ).length;
  };

  const getSchemaCheckboxState = (schema: SchemaTreeItem): { checked: boolean; indeterminate: boolean } => {
    if (!selectable) return { checked: false, indeterminate: false };
    if (connectionWhitelisted) return { checked: true, indeterminate: false };

    const schemaWhitelisted = isSchemaWhitelisted(schema.schema);
    const whitelistedTableCount = getSchemaTables(schema);

    if (schemaWhitelisted) {
      return { checked: true, indeterminate: false };
    } else if (whitelistedTableCount > 0 && whitelistedTableCount < schema.tables.length) {
      return { checked: false, indeterminate: true };
    } else if (whitelistedTableCount === schema.tables.length && whitelistedTableCount > 0) {
      return { checked: true, indeterminate: false };
    } else {
      return { checked: false, indeterminate: false };
    }
  };

  const toggleSchema = (schema: SchemaTreeItem) => {
    if (!selectable || !onWhitelistChange) return;

    if (connectionWhitelisted) {
      // Transition from global wildcard to explicit by excluding this schema
      const otherSchemas = schemas
        .filter(s => s.schema !== schema.schema)
        .map(s => ({ type: 'schema' as const, name: s.schema }));
      onWhitelistChange(otherSchemas);
      return;
    }

    const isWhitelisted = isSchemaWhitelisted(schema.schema);
    const whitelistedTableCount = getSchemaTables(schema);

    if (isWhitelisted) {
      onWhitelistChange(
        whitelist.filter(item => !(item.type === 'schema' && item.name === schema.schema))
      );
    } else if (whitelistedTableCount > 0) {
      onWhitelistChange([
        ...whitelist.filter(item => !(item.type === 'table' && item.schema === schema.schema)),
        { type: 'schema', name: schema.schema }
      ]);
    } else {
      onWhitelistChange([
        ...whitelist,
        { type: 'schema', name: schema.schema }
      ]);
    }
  };

  const toggleTable = (schemaName: string, tableName: string) => {
    if (!selectable || !onWhitelistChange) return;

    if (connectionWhitelisted) {
      // Transition from global wildcard to explicit, excluding this specific table
      const otherSchemas = schemas
        .filter(s => s.schema !== schemaName)
        .map(s => ({ type: 'schema' as const, name: s.schema }));
      const thisSchema = schemas.find(s => s.schema === schemaName);
      const remainingTables = thisSchema?.tables
        .filter(t => t.table !== tableName)
        .map(t => ({ type: 'table' as const, name: t.table, schema: schemaName })) || [];
      onWhitelistChange([...otherSchemas, ...remainingTables]);
      return;
    }

    const isSchemaWL = isSchemaWhitelisted(schemaName);
    const isTableWL = isTableWhitelisted(schemaName, tableName);

    if (isSchemaWL) {
      const otherTables = schemas
        .find(s => s.schema === schemaName)
        ?.tables.filter(t => t.table !== tableName) || [];

      // Find the schema whitelist item to preserve its childPaths
      const schemaItem = whitelist.find(item => item.type === 'schema' && item.name === schemaName);
      const inheritedChildPaths = schemaItem?.childPaths;

      onWhitelistChange([
        ...whitelist.filter(item => !(item.type === 'schema' && item.name === schemaName)),
        ...otherTables.map(table => ({
          type: 'table' as const,
          name: table.table,
          schema: schemaName,
          ...(inheritedChildPaths && { childPaths: inheritedChildPaths })
        }))
      ]);
    } else if (isTableWL) {
      onWhitelistChange(
        whitelist.filter(
          item => !(item.type === 'table' && item.name === tableName && item.schema === schemaName)
        )
      );
    } else {
      onWhitelistChange([
        ...whitelist,
        { type: 'table', name: tableName, schema: schemaName }
      ]);
    }
  };

  const toggleSchemaExpanded = (schemaName: string) => {
    setExpandedSchemas((prev) => {
      const next = new Set(prev);
      if (next.has(schemaName)) {
        // Collapsing — refresh sort snapshot so re-expansion sorts correctly
        setWhitelistForSort(whitelist);
        next.delete(schemaName);
      } else {
        next.add(schemaName);
      }
      return next;
    });
  };

  const toggleTableExpanded = (schemaName: string, tableName: string) => {
    const key = `${schemaName}.${tableName}`;
    setExpandedTables((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // Handler for changing childPaths on a whitelist item
  const handlePathFilterChange = (item: WhitelistItem, newChildPaths: string[] | undefined) => {
    if (!onWhitelistChange || !whitelist) return;

    const newWhitelist = whitelist.map(w => {
      if (w.name === item.name && w.type === item.type && w.schema === item.schema) {
        return { ...w, childPaths: newChildPaths };
      }
      return w;
    });

    onWhitelistChange(newWhitelist);
  };

  // Helper to get visible table count for a schema
  const getVisibleTableCount = (schemaName: string, totalTables: number): number => {
    return visibleTableCounts[schemaName] || Math.min(TABLES_PER_PAGE, totalTables);
  };

  // Helper to show more tables for a schema
  const showMoreTables = (schemaName: string) => {
    setVisibleTableCounts(prev => ({
      ...prev,
      [schemaName]: (prev[schemaName] || TABLES_PER_PAGE) + TABLES_PER_PAGE
    }));
  };

  // Helper to get visible column count for a table
  const getVisibleColumnCount = (tableKey: string, totalColumns: number): number => {
    return visibleColumnCounts[tableKey] || Math.min(COLUMNS_PER_PAGE, totalColumns);
  };

  // Helper to show more columns for a table
  const showMoreColumns = (tableKey: string) => {
    setVisibleColumnCounts(prev => ({
      ...prev,
      [tableKey]: (prev[tableKey] || COLUMNS_PER_PAGE) + COLUMNS_PER_PAGE
    }));
  };

  const getTypeColor = (type: string): string => {
    const typeLower = type.toLowerCase();
    if (typeLower.includes('int') || typeLower.includes('number') || typeLower.includes('decimal') || typeLower.includes('float')) {
      return 'accent.teal';
    }
    if (typeLower.includes('varchar') || typeLower.includes('text') || typeLower.includes('char') || typeLower.includes('string')) {
      return 'accent.primary';
    }
    if (typeLower.includes('date') || typeLower.includes('time') || typeLower.includes('timestamp')) {
      return 'accent.secondary';
    }
    if (typeLower.includes('bool')) {
      return 'accent.success';
    }
    return 'fg.muted';
  };

  // Calculate stats if enabled
  const stats = useMemo(() => {
    if (!showStats || !selectable) return null;

    const totalSchemas = schemas.length;
    const totalTables = schemas.reduce((sum, schema) => sum + schema.tables.length, 0);
    const whitelistedSchemas = whitelist.filter(item => item.type === 'schema').length;
    const whitelistedTables = whitelist.filter(item => item.type === 'table').length;

    return { totalSchemas, totalTables, whitelistedSchemas, whitelistedTables };
  }, [schemas, whitelist, showStats, selectable]);

  return (
    <VStack gap={0} align="stretch" height="100%" borderRadius="md" overflow="hidden" border="1px solid" borderColor="border.default">
      {/* Search Bar — inset, integrated feel */}
      <Box
        position="relative"
        borderBottom="1px solid"
        borderColor="border.default"
      >
        <Icon
          as={LuSearch}
          position="absolute"
          left={3}
          top="50%"
          transform="translateY(-50%)"
          color="fg.subtle"
          boxSize={3.5}
          pointerEvents="none"
          zIndex={1}
        />
        <Input
          aria-label="Search schema tree"
          placeholder={showColumns ? "Search schemas, tables & columns..." : "Search schemas & tables..."}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          fontSize="xs"
          fontFamily="mono"
          bg="bg.muted"
          border="none"
          borderRadius={0}
          _focus={{ bg: 'bg.surface', outline: 'none', boxShadow: 'inset 0 -2px 0 0 var(--chakra-colors-accent-teal)' }}
          _placeholder={{ color: 'fg.subtle' }}
          pl={9}
          pr={searchQuery ? 9 : 3}
          py={2}
          h="auto"
        />
        {searchQuery && (
          <Box
            position="absolute"
            right={1}
            top="50%"
            transform="translateY(-50%)"
            zIndex={1}
          >
            <IconButton
              aria-label="Clear search"
              size="2xs"
              variant="ghost"
              onClick={() => setSearchQuery('')}
              color="fg.subtle"
              _hover={{ color: 'fg.default' }}
            >
              <LuX size={12} />
            </IconButton>
          </Box>
        )}
      </Box>

      {/* Refresh Button */}
      {onRetry && (
        <HStack
          px={3}
          py={1.5}
          borderBottom="1px solid"
          borderColor="border.default"
          bg="bg.muted"
          justify="space-between"
        >
          <Text fontSize="xs" color="fg.subtle" fontFamily="mono">
            {connectionName ? `${connectionName} schema` : 'Database schema'}
          </Text>
          <IconButton
            aria-label="Refresh schema"
            size="2xs"
            variant="ghost"
            onClick={onRetry}
            title="Fetch latest schema from database"
            color="fg.subtle"
            _hover={{ color: 'accent.teal' }}
          >
            <LuRefreshCw size={12} />
          </IconButton>
        </HStack>
      )}

      {/* Stats Summary — compact inline bar */}
      {stats && (
        <HStack
          px={3}
          py={2}
          gap={3}
          fontFamily="mono"
          fontSize="xs"
          borderBottom="1px solid"
          borderColor="border.default"
          bg="bg.muted"
        >
          <HStack gap={1}>
            <Icon as={LuDatabase} boxSize={3} color="accent.secondary" />
            <Text fontWeight="700" color="fg.default">
              {stats.whitelistedSchemas}/{stats.totalSchemas}
            </Text>
            <Text color="fg.subtle">schemas</Text>
          </HStack>
          <Text color="fg.subtle">·</Text>
          <HStack gap={1}>
            <Icon as={LuTable} boxSize={3} color="accent.teal" />
            <Text fontWeight="700" color="fg.default">
              {stats.whitelistedTables}/{stats.totalTables}
            </Text>
            <Text color="fg.subtle">tables</Text>
          </HStack>
        </HStack>
      )}

      {/* Tree View */}
      <Box flex="1" overflowY="auto">
        {filteredSchemas.length === 0 ? (
          <Box p={6} textAlign="center">
            <Text color="fg.subtle" fontSize="xs" fontFamily="mono">
              {searchQuery ? 'No matching schemas, tables or columns found' : 'No schemas found'}
            </Text>
          </Box>
        ) : (
          <VStack gap={0} align="stretch">
            {filteredSchemas.map((schemaItem) => {
              const isSchemaExpanded = expandedSchemas.has(schemaItem.schema);
              const checkboxState = selectable ? getSchemaCheckboxState(schemaItem) : null;

              return (
                <Box key={schemaItem.schema}>
                  {/* Schema Header — flat row with left accent */}
                  <HStack
                    px={3}
                    py={2}
                    gap={2}
                    borderBottom="1px solid"
                    borderColor="border.default"
                    borderLeft="2px solid"
                    borderLeftColor={isSchemaExpanded ? 'accent.secondary' : 'transparent'}
                    bg={isSchemaExpanded ? 'accent.secondary/8' : 'bg.canvas'}
                    cursor="pointer"
                    onClick={() => toggleSchemaExpanded(schemaItem.schema)}
                    _hover={{ bg: isSchemaExpanded ? 'accent.secondary/12' : 'bg.muted' }}
                    transition="all 0.15s"
                    opacity={connectionWhitelisted ? 0.6 : 1}
                    justify="space-between"
                  >
                    <HStack gap={1.5} flex={1} minW={0}>
                      <Icon
                        as={isSchemaExpanded ? LuChevronDown : LuChevronRight}
                        boxSize={3.5}
                        color="fg.subtle"
                        flexShrink={0}
                      />
                      {selectable && onWhitelistChange && checkboxState && (
                        <Box
                          position="relative"
                          onClick={(e: React.MouseEvent) => {
                            e.stopPropagation();
                          }}
                        >
                          <Checkbox
                            checked={checkboxState.checked}
                            onCheckedChange={() => toggleSchema(schemaItem)}
                          />
                          {checkboxState.indeterminate && (
                            <Box
                              position="absolute"
                              top="50%"
                              left="50%"
                              transform="translate(-50%, -50%)"
                              width="8px"
                              height="2px"
                              bg="accent.teal"
                              borderRadius="sm"
                              pointerEvents="none"
                            />
                          )}
                        </Box>
                      )}
                      <Icon
                        as={LuDatabase}
                        boxSize={3.5}
                        color={isSchemaExpanded ? 'accent.secondary' : 'fg.muted'}
                        flexShrink={0}
                      />
                      <Text
                        fontSize="xs"
                        fontWeight="700"
                        fontFamily="mono"
                        color={isSchemaExpanded ? 'accent.secondary' : 'fg.default'}
                        textOverflow="ellipsis"
                        overflow="hidden"
                        whiteSpace="nowrap"
                        flex={1}
                        minW={0}
                        title={schemaItem.schema}
                      >
                        {schemaItem.schema}
                      </Text>
                      {selectable && (connectionWhitelisted || isSchemaWhitelisted(schemaItem.schema)) && (
                        <Text fontSize="10px" color="fg.subtle" flexShrink={0}>
                          {connectionWhitelisted ? '(connection)' : '(entire schema)'}
                        </Text>
                      )}
                    </HStack>
                    <HStack gap={2} flexShrink={0}>
                      {/* Inline path filter badge for schema */}
                      {showPathFilter && availableChildPaths.length > 0 && isSchemaWhitelisted(schemaItem.schema) && (
                        <Box onClick={(e: React.MouseEvent) => e.stopPropagation()} flexShrink={0}>
                          <ChildPathSelector
                            availablePaths={availableChildPaths}
                            selectedPaths={(() => {
                              const item = whitelist.find(
                                w => w.type === 'schema' && w.name === schemaItem.schema
                              );
                              return item?.childPaths;
                            })()}
                            onChange={(paths) => {
                              const item = whitelist.find(
                                w => w.type === 'schema' && w.name === schemaItem.schema
                              );
                              if (item) handlePathFilterChange(item, paths);
                            }}
                          />
                        </Box>
                      )}
                      <Text
                        fontSize="10px"
                        fontWeight="600"
                        color="fg.subtle"
                        fontFamily="mono"
                        flexShrink={0}
                      >
                        {schemaItem.tables.length} {schemaItem.tables.length === 1 ? 'table' : 'tables'}
                      </Text>
                    </HStack>
                  </HStack>

                  {/* Tables List */}
                  <Collapsible.Root open={isSchemaExpanded}>
                    <Collapsible.Content>
                      <VStack
                        gap={0}
                        align="stretch"
                        ml={3}
                        borderLeft="1px solid"
                        borderColor="border.muted"
                      >
                        {schemaItem.tables.slice(0, getVisibleTableCount(schemaItem.schema, schemaItem.tables.length)).map((table) => {
                          const tableKey = `${schemaItem.schema}.${table.table}`;
                          const isTableExpanded = expandedTables.has(tableKey);
                          const filteredColumns = getFilteredColumns(schemaItem.schema, table);
                          const columnCount = showColumns ? (searchQuery ? filteredColumns.length : table.columns.length) : 0;
                          const schemaWL = selectable ? (connectionWhitelisted || isSchemaWhitelisted(schemaItem.schema)) : false;
                          const tableWL = selectable ? isTableWhitelisted(schemaItem.schema, table.table) : false;

                          return (
                            <Box key={tableKey}>
                              {/* Table Header — indented flat row */}
                              <HStack
                                pl={3}
                                pr={3}
                                py={1.5}
                                gap={1.5}
                                borderBottom="1px solid"
                                borderColor="border.muted"
                                bg={isTableExpanded ? 'accent.teal/6' : 'bg.canvas'}
                                cursor="pointer"
                                onClick={() => {
                                  if (showColumns) {
                                    toggleTableExpanded(schemaItem.schema, table.table);
                                  } else if (selectable && onWhitelistChange) {
                                    toggleTable(schemaItem.schema, table.table);
                                  }
                                }}
                                _hover={{ bg: isTableExpanded ? 'accent.teal/10' : 'bg.muted' }}
                                transition="all 0.15s"
                                opacity={schemaWL ? 0.6 : 1}
                                justify="space-between"
                              >
                                <HStack gap={1.5} flex={1} minW={0}>
                                  {showColumns && (
                                    <Icon
                                      as={isTableExpanded ? LuChevronDown : LuChevronRight}
                                      boxSize={3}
                                      color="fg.subtle"
                                      flexShrink={0}
                                    />
                                  )}
                                  {selectable && onWhitelistChange && (
                                    <Box
                                      onClick={(e: React.MouseEvent) => {
                                        e.stopPropagation();
                                      }}
                                      flexShrink={0}
                                    >
                                      <Checkbox
                                        checked={schemaWL || tableWL}
                                        onCheckedChange={() => toggleTable(schemaItem.schema, table.table)}
                                      />
                                    </Box>
                                  )}
                                  <Icon
                                    as={LuTable}
                                    boxSize={3}
                                    color={isTableExpanded ? 'accent.teal' : 'fg.muted'}
                                    opacity={schemaWL ? 0.6 : 1}
                                    flexShrink={0}
                                  />
                                  <Text
                                    fontSize="xs"
                                    fontWeight={isTableExpanded ? '700' : '500'}
                                    fontFamily="mono"
                                    color={isTableExpanded ? 'accent.teal' : (schemaWL ? 'fg.muted' : 'fg.default')}
                                    textOverflow="ellipsis"
                                    overflow="hidden"
                                    whiteSpace="nowrap"
                                    flex={1}
                                    minW={0}
                                    title={table.table}
                                  >
                                    {table.table}
                                  </Text>
                                </HStack>
                                <HStack gap={2} flexShrink={0}>
                                  {onTablePreview && (
                                    <Box
                                      as="button"
                                      display="flex"
                                      alignItems="center"
                                      gap={1}
                                      px={1.5}
                                      py={0.5}
                                      fontSize="10px"
                                      fontWeight="600"
                                      fontFamily="mono"
                                      color="accent.teal"
                                      bg="transparent"
                                      borderRadius="sm"
                                      cursor="pointer"
                                      transition="all 0.15s"
                                      _hover={{ bg: 'accent.teal/10' }}
                                      onClick={(e: React.MouseEvent) => {
                                        e.stopPropagation();
                                        onTablePreview(schemaItem.schema, table.table);
                                      }}
                                    >
                                      <LuEye size={11} />
                                      Preview
                                    </Box>
                                  )}
                                  {/* Inline path filter badge */}
                                  {showPathFilter && availableChildPaths.length > 0 && tableWL && !schemaWL && (
                                    <Box onClick={(e: React.MouseEvent) => e.stopPropagation()} flexShrink={0}>
                                      <ChildPathSelector
                                        availablePaths={availableChildPaths}
                                        selectedPaths={(() => {
                                          const item = whitelist.find(
                                            w => w.type === 'table' && w.name === table.table && w.schema === schemaItem.schema
                                          );
                                          return item?.childPaths;
                                        })()}
                                        onChange={(paths) => {
                                          const item = whitelist.find(
                                            w => w.type === 'table' && w.name === table.table && w.schema === schemaItem.schema
                                          );
                                          if (item) handlePathFilterChange(item, paths);
                                        }}
                                      />
                                    </Box>
                                  )}
                                  {showColumns && (
                                    <Text
                                      fontSize="10px"
                                      fontWeight="600"
                                      color="fg.subtle"
                                      fontFamily="mono"
                                    >
                                      {columnCount} cols
                                    </Text>
                                  )}
                                </HStack>
                              </HStack>

                              {/* Columns List */}
                              {showColumns && isTableExpanded && (
                                <Collapsible.Root open={isTableExpanded}>
                                  <Collapsible.Content>
                                    <VStack
                                      gap={0}
                                      align="stretch"
                                      ml={5}
                                      borderLeft="1px solid"
                                      borderColor="border.muted"
                                    >
                                      {filteredColumns.slice(0, getVisibleColumnCount(tableKey, filteredColumns.length)).map((column) => (
                                        <HStack
                                          key={column.name}
                                          pl={3}
                                          pr={3}
                                          py={1}
                                          gap={2}
                                          borderBottom="1px solid"
                                          borderColor="border.muted"
                                          _hover={{ bg: 'bg.muted' }}
                                          transition="background 0.1s"
                                          justify="space-between"
                                        >
                                          <HStack gap={1.5} flex={1} minW={0}>
                                            <Icon
                                              as={LuColumns3}
                                              boxSize={3}
                                              color="fg.subtle"
                                              flexShrink={0}
                                            />
                                            <Text
                                              fontSize="xs"
                                              fontWeight="500"
                                              fontFamily="mono"
                                              color="fg.default"
                                              textOverflow="ellipsis"
                                              overflow="hidden"
                                              whiteSpace="nowrap"
                                              flex={1}
                                              minW={0}
                                              title={column.name}
                                            >
                                              {column.name}
                                            </Text>
                                          </HStack>
                                          <Text
                                            fontSize="10px"
                                            fontWeight="600"
                                            color={getTypeColor(column.type)}
                                            fontFamily="mono"
                                            flexShrink={0}
                                          >
                                            {column.type}
                                          </Text>
                                        </HStack>
                                      ))}

                                      {/* Show More Columns Button */}
                                      {filteredColumns.length > getVisibleColumnCount(tableKey, filteredColumns.length) && (
                                        <Box
                                          pl={3}
                                          pr={3}
                                          py={1.5}
                                          borderBottom="1px solid"
                                          borderColor="border.muted"
                                          cursor="pointer"
                                          onClick={() => showMoreColumns(tableKey)}
                                          _hover={{ bg: 'bg.muted' }}
                                          transition="background 0.1s"
                                        >
                                          <Text fontSize="10px" color="accent.teal" fontFamily="mono" fontWeight="600">
                                            + {Math.min(COLUMNS_PER_PAGE, filteredColumns.length - getVisibleColumnCount(tableKey, filteredColumns.length))} more columns
                                          </Text>
                                        </Box>
                                      )}
                                    </VStack>
                                  </Collapsible.Content>
                                </Collapsible.Root>
                              )}
                            </Box>
                          );
                        })}

                        {/* Show More Tables Button */}
                        {schemaItem.tables.length > getVisibleTableCount(schemaItem.schema, schemaItem.tables.length) && (
                          <Box
                            pl={3}
                            pr={3}
                            py={2}
                            borderBottom="1px solid"
                            borderColor="border.muted"
                            cursor="pointer"
                            onClick={() => showMoreTables(schemaItem.schema)}
                            _hover={{ bg: 'bg.muted' }}
                            transition="background 0.1s"
                          >
                            <Text fontSize="xs" color="accent.teal" fontFamily="mono" fontWeight="600">
                              + {Math.min(TABLES_PER_PAGE, schemaItem.tables.length - getVisibleTableCount(schemaItem.schema, schemaItem.tables.length))} more tables
                            </Text>
                          </Box>
                        )}
                      </VStack>
                    </Collapsible.Content>
                  </Collapsible.Root>
                </Box>
              );
            })}
          </VStack>
        )}
      </Box>
    </VStack>
  );
}
