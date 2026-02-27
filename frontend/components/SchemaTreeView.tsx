'use client';

import { useState, useMemo } from 'react';
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
}

const TABLES_PER_PAGE = 5;
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
}: SchemaTreeViewProps) {
  const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(new Set());
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');

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
    if (selectable) {
      result = [...result].sort((a, b) => {
        const aSelected = isSchemaWhitelisted(a.schema);
        const bSelected = isSchemaWhitelisted(b.schema);

        if (aSelected && !bSelected) return -1;
        if (!aSelected && bSelected) return 1;

        // If both selected or both not selected, maintain original order
        return 0;
      });

      // Sort tables within each schema: selected ones first
      result = result.map((schemaItem) => {
        const sortedTables = [...schemaItem.tables].sort((a, b) => {
          const aSelected = isTableWhitelisted(schemaItem.schema, a.table);
          const bSelected = isTableWhitelisted(schemaItem.schema, b.table);

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
  }, [schemas, searchQuery, showColumns, selectable, whitelist]);

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
    <VStack gap={0} align="stretch" height="100%">
      {/* Search Bar */}
      <Box position="relative">
        <Icon
          as={LuSearch}
          position="absolute"
          left={3}
          top="50%"
          transform="translateY(-50%)"
          color="fg.muted"
          boxSize={4}
          pointerEvents="none"
          zIndex={1}
        />
        <Input
          placeholder={showColumns ? "Search schemas, tables & columns..." : "Search schemas & tables..."}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          fontSize="sm"
          fontFamily="mono"
          bg="bg.surface"
          borderColor="border.default"
          _focus={{ borderColor: 'accent.teal', outline: 'none' }}
          pl={10}
          pr={searchQuery ? 10 : 3}
          borderRadius={0}
        />
        {searchQuery && (
          <Box
            position="absolute"
            right={2}
            top="50%"
            transform="translateY(-50%)"
            zIndex={1}
          >
            <IconButton
              aria-label="Clear search"
              size="xs"
              variant="ghost"
              onClick={() => setSearchQuery('')}
            >
              <LuX size={14} />
            </IconButton>
          </Box>
        )}
      </Box>

      {/* Refresh Button */}
      {onRetry && (
        <HStack
          p={2}
          borderBottom="1px solid"
          borderColor="border.default"
          bg="bg.surface"
          justify="space-between"
        >
          <Text fontSize="xs" color="fg.muted" fontFamily="mono">
            {connectionName ? `${connectionName} schema` : 'Database schema'}
          </Text>
          <IconButton
            aria-label="Refresh schema"
            size="xs"
            variant="ghost"
            onClick={onRetry}
            title="Fetch latest schema from database"
          >
            <LuRefreshCw size={14} />
          </IconButton>
        </HStack>
      )}

      {/* Stats Summary (only in selectable mode with showStats=true) */}
      {stats && (
        <Box
          p={3}
          bg="bg.muted"
          borderRadius="md"
          border="1px solid"
          borderColor="border.default"
        >
          <HStack gap={4} fontFamily="mono" fontSize="sm">
            <HStack gap={1.5}>
              <Icon as={LuDatabase} boxSize={4} color="accent.secondary" />
              <Text fontWeight="600">
                {stats.whitelistedSchemas}/{stats.totalSchemas}
              </Text>
              <Text color="fg.muted">Schemas</Text>
            </HStack>
            <Text color="fg.muted">•</Text>
            <HStack gap={1.5}>
              <Icon as={LuTable} boxSize={4} color="accent.teal" />
              <Text fontWeight="600">
                {stats.whitelistedTables}/{stats.totalTables}
              </Text>
              <Text color="fg.muted">Tables</Text>
            </HStack>
          </HStack>
        </Box>
      )}

      {/* Tree View */}
      <Box flex="1" overflowY="auto">
        {filteredSchemas.length === 0 ? (
          <Box p={8} textAlign="center">
            <Text color="fg.muted" fontSize="sm">
              {searchQuery ? 'No matching schemas, tables or columns found' : 'No schemas found'}
            </Text>
          </Box>
        ) : (
          <VStack gap={1} align="stretch">
            {filteredSchemas.map((schemaItem) => {
              const isSchemaExpanded = expandedSchemas.has(schemaItem.schema);
              const checkboxState = selectable ? getSchemaCheckboxState(schemaItem) : null;

              return (
                <Box key={schemaItem.schema}>
                  {/* Schema Header */}
                  <Box
                    px={3}
                    py={2}
                    borderRadius="md"
                    border="1px solid"
                    borderColor={isSchemaExpanded ? 'accent.secondary' : 'border.default'}
                    bg={isSchemaExpanded ? 'accent.secondary/10' : 'bg.muted'}
                    cursor="pointer"
                    onClick={() => toggleSchemaExpanded(schemaItem.schema)}
                    _hover={{
                      bg: isSchemaExpanded ? 'accent.secondary/20' : 'bg.surface',
                      borderColor: 'accent.secondary'
                    }}
                    transition="all 0.2s"
                  >
                    <HStack gap={2} justify="space-between" w="100%">
                      <HStack gap={2} flex={1} minW={0}>
                        <Icon
                          as={isSchemaExpanded ? LuChevronDown : LuChevronRight}
                          boxSize={4}
                          color="fg.muted"
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
                          boxSize={4}
                          color={isSchemaExpanded ? 'accent.secondary' : 'fg.muted'}
                          flexShrink={0}
                        />
                        <Box
                          px={1.5}
                          py={0.5}
                          bg="accent.secondary/15"
                          borderRadius="sm"
                          fontSize="2xs"
                          fontWeight="700"
                          color="accent.secondary"
                          textTransform="uppercase"
                          letterSpacing="0.05em"
                          flexShrink={0}
                        >
                          Schema
                        </Box>
                        <Text
                          fontSize="sm"
                          fontWeight={isSchemaExpanded ? '800' : '700'}
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
                        {selectable && isSchemaWhitelisted(schemaItem.schema) && (
                          <Text fontSize="xs" color="fg.muted">
                            (entire schema)
                          </Text>
                        )}
                      </HStack>
                      <Box
                        px={2}
                        py={0.5}
                        bg="bg.canvas"
                        borderRadius="sm"
                        border="1px solid"
                        borderColor="border.muted"
                      >
                        <Text
                          fontSize="2xs"
                          fontWeight="700"
                          color="fg.subtle"
                          fontFamily="mono"
                        >
                          {schemaItem.tables.length} {schemaItem.tables.length === 1 ? 'table' : 'tables'}
                        </Text>
                      </Box>
                    </HStack>
                  </Box>

                  {/* Path Filter UI for schema-level whitelists */}
                  {showPathFilter && availableChildPaths.length > 0 && isSchemaWhitelisted(schemaItem.schema) && (
                    <Box ml={10} mt={2}>
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

                  {/* Tables List */}
                  <Collapsible.Root open={isSchemaExpanded}>
                    <Collapsible.Content>
                      <Box
                        mt={2}
                        ml={4}
                        pl={3}
                        borderLeft="2px solid"
                        borderColor="border.muted"
                      >
                        <VStack gap={2} align="stretch">
                          {schemaItem.tables.slice(0, getVisibleTableCount(schemaItem.schema, schemaItem.tables.length)).map((table) => {
                            const tableKey = `${schemaItem.schema}.${table.table}`;
                            const isTableExpanded = expandedTables.has(tableKey);
                            const filteredColumns = getFilteredColumns(schemaItem.schema, table);
                            const columnCount = showColumns ? (searchQuery ? filteredColumns.length : table.columns.length) : 0;
                            const schemaWL = selectable ? isSchemaWhitelisted(schemaItem.schema) : false;
                            const tableWL = selectable ? isTableWhitelisted(schemaItem.schema, table.table) : false;

                            return (
                              <Box key={tableKey}>
                                {/* Table Header */}
                                <Box
                                  px={3}
                                  py={1}
                                  borderRadius="md"
                                  border="1px solid"
                                  borderColor="border.default"
                                  bg={isTableExpanded ? 'accent.teal/10' : 'bg.muted'}
                                  cursor="pointer"
                                  onClick={() => {
                                    if (showColumns) {
                                      toggleTableExpanded(schemaItem.schema, table.table);
                                    } else if (selectable && onWhitelistChange) {
                                      toggleTable(schemaItem.schema, table.table);
                                    }
                                  }}
                                  _hover={{
                                    bg: isTableExpanded ? 'accent.teal/20' : 'bg.surface',
                                    borderColor: 'accent.teal'
                                  }}
                                  transition="all 0.2s"
                                  opacity={schemaWL ? 0.6 : 1}
                                >
                                  <HStack gap={2} justify="space-between" w="100%">
                                    <HStack gap={2} flex={1} minW={0}>
                                      {showColumns && (
                                        <Icon
                                          as={isTableExpanded ? LuChevronDown : LuChevronRight}
                                          boxSize={4}
                                          color="fg.muted"
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
                                        boxSize={4}
                                        color={isTableExpanded ? 'accent.teal' : 'fg.muted'}
                                        opacity={schemaWL ? 0.6 : 1}
                                        flexShrink={0}
                                      />
                                      <Box
                                        px={1.5}
                                        py={0.5}
                                        bg="accent.teal/15"
                                        borderRadius="sm"
                                        fontSize="2xs"
                                        fontWeight="700"
                                        color="accent.teal"
                                        textTransform="uppercase"
                                        letterSpacing="0.05em"
                                        opacity={schemaWL ? 0.6 : 1}
                                        flexShrink={0}
                                      >
                                        Table
                                      </Box>
                                      <Text
                                        fontSize="sm"
                                        fontWeight={isTableExpanded ? '700' : '600'}
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
                                    <HStack gap={2}>
                                      {onTablePreview && (
                                        <Box
                                          as="button"
                                          display="flex"
                                          alignItems="center"
                                          gap={1}
                                          px={2}
                                          py={1}
                                          fontSize="xs"
                                          fontWeight="600"
                                          fontFamily="mono"
                                          color="accent.teal"
                                          bg="accent.teal/10"
                                          borderRadius="md"
                                          border="1px solid"
                                          borderColor="accent.teal/30"
                                          cursor="pointer"
                                          transition="all 0.2s"
                                          _hover={{
                                            bg: 'accent.teal/20',
                                            borderColor: 'accent.teal',
                                            transform: 'translateY(-1px)'
                                          }}
                                          onClick={(e: React.MouseEvent) => {
                                            e.stopPropagation();
                                            onTablePreview(schemaItem.schema, table.table);
                                          }}
                                        >
                                          <LuEye size={12} />
                                          Preview Table
                                        </Box>
                                      )}
                                      {showColumns && (
                                        <Box
                                          px={2}
                                          py={0.5}
                                          bg="bg.canvas"
                                          borderRadius="sm"
                                          border="1px solid"
                                          borderColor="border.muted"
                                        >
                                          <Text
                                            fontSize="2xs"
                                            fontWeight="700"
                                            color="fg.subtle"
                                            fontFamily="mono"
                                          >
                                            {columnCount} cols
                                          </Text>
                                        </Box>
                                      )}
                                    </HStack>
                                  </HStack>
                                </Box>

                                {/* Path Filter UI - only for whitelisted tables in parent contexts */}
                                {showPathFilter && availableChildPaths.length > 0 && tableWL && !schemaWL && (
                                  <Box ml={10} mt={2}>
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

                                {/* Columns List - Only render when table is expanded */}
                                {showColumns && isTableExpanded && (
                                  <Collapsible.Root open={isTableExpanded}>
                                    <Collapsible.Content>
                                      <Box
                                        mt={1}
                                        ml={4}
                                        pl={3}
                                        borderLeft="2px solid"
                                        borderColor="border.muted"
                                      >
                                        <VStack gap={1} align="stretch" py={2}>
                                          {filteredColumns.slice(0, getVisibleColumnCount(tableKey, filteredColumns.length)).map((column) => (
                                            <Box
                                              key={column.name}
                                              px={3}
                                              py={2}
                                              borderRadius="sm"
                                              border="1px solid"
                                              borderColor="border.muted"
                                              bg="bg.canvas"
                                              _hover={{
                                                bg: 'bg.muted',
                                                borderColor: getTypeColor(column.type)
                                              }}
                                              transition="all 0.2s"
                                            >
                                              <HStack gap={2} justify="space-between">
                                                <HStack gap={2} flex={1} minW={0}>
                                                  <Icon
                                                    as={LuColumns3}
                                                    boxSize={3}
                                                    color="fg.subtle"
                                                    flexShrink={0}
                                                  />
                                                  <Box
                                                    px={1}
                                                    py={0.5}
                                                    bg="fg.muted/10"
                                                    borderRadius="sm"
                                                    fontSize="2xs"
                                                    fontWeight="600"
                                                    color="fg.muted"
                                                    textTransform="uppercase"
                                                    letterSpacing="0.05em"
                                                    flexShrink={0}
                                                  >
                                                    Column
                                                  </Box>
                                                  <Text
                                                    fontSize="xs"
                                                    fontWeight="600"
                                                    fontFamily="mono"
                                                    color="fg.default"
                                                    textOverflow="ellipsis"
                                                    overflow="hidden"
                                                    whiteSpace="nowrap"
                                                    maxW="150px"
                                                    title={column.name}
                                                  >
                                                    {column.name}
                                                  </Text>
                                                </HStack>
                                                <Box
                                                  px={2}
                                                  py={0.5}
                                                  bg={`${getTypeColor(column.type)}/10`}
                                                  borderRadius="sm"
                                                  border="1px solid"
                                                  borderColor={`${getTypeColor(column.type)}/30`}
                                                  flexShrink={0}
                                                >
                                                  <Text
                                                    fontSize="2xs"
                                                    fontWeight="700"
                                                    color={getTypeColor(column.type)}
                                                    fontFamily="mono"
                                                    textTransform="uppercase"
                                                  >
                                                    {column.type}
                                                  </Text>
                                                </Box>
                                              </HStack>
                                            </Box>
                                          ))}

                                          {/* Show More Columns Button */}
                                          {filteredColumns.length > getVisibleColumnCount(tableKey, filteredColumns.length) && (
                                            <Box
                                              px={3}
                                              py={2}
                                              borderRadius="sm"
                                              border="1px dashed"
                                              borderColor="border.default"
                                              bg="bg.surface"
                                              cursor="pointer"
                                              onClick={() => showMoreColumns(tableKey)}
                                              _hover={{ bg: 'bg.muted', borderColor: 'accent.teal' }}
                                              transition="all 0.2s"
                                            >
                                              <Text fontSize="xs" color="fg.muted" textAlign="center" fontFamily="mono">
                                                Show {Math.min(COLUMNS_PER_PAGE, filteredColumns.length - getVisibleColumnCount(tableKey, filteredColumns.length))} more columns
                                              </Text>
                                            </Box>
                                          )}
                                        </VStack>
                                      </Box>
                                    </Collapsible.Content>
                                  </Collapsible.Root>
                                )}
                              </Box>
                            );
                          })}

                          {/* Show More Tables Button */}
                          {schemaItem.tables.length > getVisibleTableCount(schemaItem.schema, schemaItem.tables.length) && (
                            <Box
                              px={3}
                              py={2}
                              borderRadius="md"
                              border="1px dashed"
                              borderColor="border.default"
                              bg="bg.surface"
                              cursor="pointer"
                              onClick={() => showMoreTables(schemaItem.schema)}
                              _hover={{ bg: 'bg.muted', borderColor: 'accent.teal' }}
                              transition="all 0.2s"
                            >
                              <Text fontSize="sm" color="fg.muted" textAlign="center" fontFamily="mono">
                                Show {Math.min(TABLES_PER_PAGE, schemaItem.tables.length - getVisibleTableCount(schemaItem.schema, schemaItem.tables.length))} more tables
                              </Text>
                            </Box>
                          )}
                        </VStack>
                      </Box>
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
