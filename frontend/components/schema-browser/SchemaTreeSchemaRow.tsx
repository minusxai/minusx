'use client';

import type React from 'react';
import { Box, VStack, HStack, Text, Icon, Collapsible, Input } from '@chakra-ui/react';
import { LuTable, LuChevronRight, LuChevronDown, LuColumns3, LuDatabase, LuEye } from 'react-icons/lu';
import { Checkbox } from '@/components/ui/checkbox';
import ChildPathSelector from '../selectors/ChildPathSelector';
import TableMetricsEditor from '../context/TableMetricsEditor';
import TableRelationshipsEditor from '../context/TableRelationshipsEditor';
import type { TableAnnotation, MetricDef, TableRelationship } from '@/lib/types';
import type { SchemaTreeItem, WhitelistItem } from './SchemaTreeView';

const TABLES_PER_PAGE = 25;
const COLUMNS_PER_PAGE = 5;

/**
 * Uncontrolled description input — the DOM owns the buffer while typing and only
 * commits on blur, so editing one description doesn't re-render the whole tree on
 * every keystroke. Keyed on `value` to re-seed when it changes externally.
 */
function AnnInput({ value, placeholder, ariaLabel, onCommit }: {
  value: string; placeholder?: string; ariaLabel: string; onCommit: (next: string) => void;
}) {
  return (
    <Input
      key={value}
      defaultValue={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      size="xs"
      h="22px"
      fontSize="xs"
      variant="subtle"
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => { if (e.target.value !== value) onCommit(e.target.value); }}
    />
  );
}

interface SchemaTreeSchemaRowProps {
  schemaItem: SchemaTreeItem;

  selectable: boolean;
  whitelist: WhitelistItem[];
  onWhitelistChange?: (whitelist: WhitelistItem[]) => void;
  connectionWhitelisted: boolean;

  showColumns: boolean;
  showPathFilter: boolean;
  availableChildPaths: string[];
  onTablePreview?: (schemaName: string, tableName: string) => void;
  connectionName?: string;
  searchQuery: string;

  annotationsEditable: boolean;
  annotations: TableAnnotation[];
  inheritedAnnotations: TableAnnotation[];

  metrics: MetricDef[];
  onMetricsChange?: (next: MetricDef[]) => void;
  inheritedMetrics: MetricDef[];

  relationships: TableRelationship[];
  onRelationshipsChange?: (next: TableRelationship[]) => void;
  inheritedRelationships: TableRelationship[];
  /** All tables in this connection (join target candidates). */
  allTables: Array<{ schema: string; table: string; columns: Array<{ name: string; type: string }> }>;

  expandedSchemas: Set<string>;
  expandedTables: Set<string>;

  isSchemaWhitelisted: (schemaName: string) => boolean;
  isTableWhitelisted: (schemaName: string, tableName: string) => boolean;
  getSchemaCheckboxState: (schema: SchemaTreeItem) => { checked: boolean; indeterminate: boolean };
  getFilteredColumns: (
    schemaName: string,
    table: { table: string; columns: Array<{ name: string; type: string }> }
  ) => Array<{ name: string; type: string }>;
  getVisibleTableCount: (schemaName: string, totalTables: number) => number;
  getVisibleColumnCount: (tableKey: string, totalColumns: number) => number;
  getTypeColor: (type: string) => string;

  findTableAnn: (list: TableAnnotation[], schema: string, table: string) => TableAnnotation | undefined;
  effectiveTableDescription: (schema: string, table: string) => string | undefined;
  effectiveColumnDescription: (schema: string, table: string, col: string, profiled?: string) => string | undefined;
  setTableDescription: (schema: string, table: string, desc: string) => void;
  setColumnDescription: (schema: string, table: string, col: string, desc: string) => void;

  toggleSchema: (schema: SchemaTreeItem) => void;
  toggleTable: (schemaName: string, tableName: string) => void;
  toggleSchemaExpanded: (schemaName: string) => void;
  toggleTableExpanded: (schemaName: string, tableName: string) => void;
  handlePathFilterChange: (item: WhitelistItem, newChildPaths: string[] | undefined) => void;
  showMoreTables: (schemaName: string) => void;
  showMoreColumns: (tableKey: string) => void;
}

/** Renders one schema's row plus its (collapsible) list of tables and columns. */
export default function SchemaTreeSchemaRow({
  schemaItem,
  selectable,
  whitelist,
  onWhitelistChange,
  connectionWhitelisted,
  showColumns,
  showPathFilter,
  availableChildPaths,
  onTablePreview,
  connectionName,
  searchQuery,
  annotationsEditable,
  annotations,
  inheritedAnnotations,
  metrics,
  onMetricsChange,
  inheritedMetrics,
  relationships,
  onRelationshipsChange,
  inheritedRelationships,
  allTables,
  expandedSchemas,
  expandedTables,
  isSchemaWhitelisted,
  isTableWhitelisted,
  getSchemaCheckboxState,
  getFilteredColumns,
  getVisibleTableCount,
  getVisibleColumnCount,
  getTypeColor,
  findTableAnn,
  effectiveTableDescription,
  effectiveColumnDescription,
  setTableDescription,
  setColumnDescription,
  toggleSchema,
  toggleTable,
  toggleSchemaExpanded,
  toggleTableExpanded,
  handlePathFilterChange,
  showMoreTables,
  showMoreColumns,
}: SchemaTreeSchemaRowProps) {
  const isSchemaExpanded = expandedSchemas.has(schemaItem.schema);
  const checkboxState = selectable ? getSchemaCheckboxState(schemaItem) : null;

  return (
    <Box>
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
                    {(() => {
                      const tableHasDesc = annotationsEditable || !!effectiveTableDescription(schemaItem.schema, table.table);
                      return (
                    <HStack gap={1.5} flex={tableHasDesc ? undefined : 1} w={tableHasDesc ? '220px' : undefined} flexShrink={0} minW={0}>
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
                      );
                    })()}
                    {annotationsEditable ? (
                      <Box flex={1} minW={0} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                        <AnnInput
                          ariaLabel={`${schemaItem.schema}.${table.table} description`}
                          value={findTableAnn(annotations, schemaItem.schema, table.table)?.description ?? ''}
                          placeholder={findTableAnn(inheritedAnnotations, schemaItem.schema, table.table)?.description || 'Describe this table…'}
                          onCommit={(v) => setTableDescription(schemaItem.schema, table.table, v)}
                        />
                      </Box>
                    ) : effectiveTableDescription(schemaItem.schema, table.table) ? (
                      <Text flex={1} minW={0} fontSize="xs" color="fg.muted" truncate title={effectiveTableDescription(schemaItem.schema, table.table)}>
                        {effectiveTableDescription(schemaItem.schema, table.table)}
                      </Text>
                    ) : null}
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
                          {/* Per-table metrics (edited inline) */}
                          {(onMetricsChange || metrics.length > 0 || inheritedMetrics.length > 0) && (
                            <Box borderBottom="1px solid" borderColor="border.muted">
                              <TableMetricsEditor
                                connection={connectionName}
                                schema={schemaItem.schema}
                                table={table.table}
                                metrics={metrics}
                                onMetricsChange={onMetricsChange}
                                inheritedMetrics={inheritedMetrics}
                              />
                            </Box>
                          )}
                          {/* Per-table FK relationships (edited inline) — feed the derived semantic layer */}
                          {(onRelationshipsChange || relationships.length > 0 || inheritedRelationships.length > 0) && (
                            <Box borderBottom="1px solid" borderColor="border.muted">
                              <TableRelationshipsEditor
                                connection={connectionName}
                                schema={schemaItem.schema}
                                table={table.table}
                                columns={table.columns}
                                tables={allTables}
                                relationships={relationships}
                                onRelationshipsChange={onRelationshipsChange}
                                inheritedRelationships={inheritedRelationships}
                              />
                            </Box>
                          )}
                          {filteredColumns.slice(0, getVisibleColumnCount(tableKey, filteredColumns.length)).map((column) => {
                            const profiledDesc = (column as { meta?: { description?: string } }).meta?.description;
                            const colDesc = effectiveColumnDescription(schemaItem.schema, table.table, column.name, profiledDesc);
                            return (
                            <VStack
                              key={column.name}
                              align="stretch"
                              gap={0}
                              borderBottom="1px solid"
                              borderColor="border.muted"
                              _hover={{ bg: 'bg.muted' }}
                              transition="background 0.1s"
                            >
                            <HStack pl={3} pr={3} py={1} gap={2}>
                              <HStack gap={1.5} w="160px" flexShrink={0} minW={0}>
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
                                  minW={0}
                                  title={column.name}
                                >
                                  {column.name}
                                </Text>
                              </HStack>
                              {annotationsEditable ? (
                                <Box flex={1} minW={0}>
                                  <AnnInput
                                    ariaLabel={`${schemaItem.schema}.${table.table}.${column.name} description`}
                                    value={findTableAnn(annotations, schemaItem.schema, table.table)?.columns?.find(c => c.name === column.name)?.description ?? ''}
                                    placeholder={profiledDesc || 'Describe column…'}
                                    onCommit={(v) => setColumnDescription(schemaItem.schema, table.table, column.name, v)}
                                  />
                                </Box>
                              ) : (
                                <Text flex={1} minW={0} fontSize="2xs" color="fg.muted" truncate title={colDesc}>
                                  {colDesc || ''}
                                </Text>
                              )}
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
                            {/* Persistent source hint while editing, so the profiled
                                description stays visible even after an override. */}
                            {annotationsEditable && profiledDesc && (
                              <Text pl="172px" pr={3} pb={1} fontSize="2xs" color="fg.subtle" truncate title={profiledDesc}>
                                source: {profiledDesc}
                              </Text>
                            )}
                            </VStack>
                            );
                          })}

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
}
