'use client';

import { useState, useMemo, useEffect } from 'react';
import { Box, VStack, Text } from '@chakra-ui/react';
import type { TableAnnotation, MetricDef } from '@/lib/types';
import SchemaTreeSearchBar from './SchemaTreeSearchBar';
import SchemaTreeSummaryBar from './SchemaTreeSummaryBar';
import SchemaTreeSchemaRow from './SchemaTreeSchemaRow';

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

  // Annotations (table/column descriptions)
  /** Context-authored table/column descriptions for this connection. */
  annotations?: TableAnnotation[];
  /** When provided, descriptions become editable and edits are emitted here. */
  onAnnotationsChange?: (next: TableAnnotation[]) => void;
  /** Inherited descriptions (read-only) used as a fallback for the effective value. */
  inheritedAnnotations?: TableAnnotation[];

  // Metrics (per-table, edited inline in the tree)
  /** All context metrics. */
  metrics?: MetricDef[];
  /** When provided, metrics become editable and edits are emitted here. */
  onMetricsChange?: (next: MetricDef[]) => void;
  /** Inherited metrics (read-only). */
  inheritedMetrics?: MetricDef[];

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
  annotations = [],
  onAnnotationsChange,
  inheritedAnnotations = [],
  metrics = [],
  onMetricsChange,
  inheritedMetrics = [],
}: SchemaTreeViewProps) {
  const annotationsEditable = !!onAnnotationsChange;

  // Match by connection (when known) so the same schema.table across two connections
  // doesn't collide; legacy entries without a connection still match (lenient).
  const matchesTable = (a: TableAnnotation, schema: string, table: string) =>
    a.schema === schema && a.table === table && (a.connection == null || a.connection === connectionName);

  const findTableAnn = (list: TableAnnotation[], schema: string, table: string) =>
    list.find(a => matchesTable(a, schema, table));

  const effectiveTableDescription = (schema: string, table: string): string | undefined =>
    findTableAnn(annotations, schema, table)?.description
      ?? findTableAnn(inheritedAnnotations, schema, table)?.description;

  const effectiveColumnDescription = (schema: string, table: string, col: string, profiled?: string): string | undefined =>
    findTableAnn(annotations, schema, table)?.columns?.find(c => c.name === col)?.description
      ?? findTableAnn(inheritedAnnotations, schema, table)?.columns?.find(c => c.name === col)?.description
      ?? profiled;

  // Drop empty table-annotation entries (no description and no described columns).
  const pruneAnnotations = (list: TableAnnotation[]): TableAnnotation[] =>
    list
      .map(a => ({ ...a, columns: (a.columns || []).filter(c => c.description) }))
      .filter(a => a.description || (a.columns && a.columns.length > 0))
      .map(a => (a.columns && a.columns.length === 0 ? { schema: a.schema, table: a.table, description: a.description } : a));

  const setTableDescription = (schema: string, table: string, desc: string) => {
    const d = desc.trim() || undefined;
    const next = [...annotations];
    const i = next.findIndex(a => matchesTable(a, schema, table));
    if (i >= 0) next[i] = { ...next[i], description: d };
    else next.push({ connection: connectionName, schema, table, description: d });
    onAnnotationsChange?.(pruneAnnotations(next));
  };

  const setColumnDescription = (schema: string, table: string, col: string, desc: string) => {
    const d = desc.trim() || undefined;
    const next = [...annotations];
    let i = next.findIndex(a => matchesTable(a, schema, table));
    if (i < 0) { next.push({ connection: connectionName, schema, table, columns: [] }); i = next.length - 1; }
    const cols = [...(next[i].columns || [])];
    const ci = cols.findIndex(c => c.name === col);
    if (ci >= 0) cols[ci] = { ...cols[ci], description: d };
    else cols.push({ name: col, description: d });
    next[i] = { ...next[i], columns: cols };
    onAnnotationsChange?.(pruneAnnotations(next));
  };

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

  // Normalize incoming data: `columns` is typed as required but data
  // can arrive with it undefined. Default to [] so every
  // downstream access (search .some(), .length, getFilteredColumns) is safe.
  const normalizedSchemas = useMemo(
    () =>
      schemas.map((schemaItem) => ({
        ...schemaItem,
        tables: schemaItem.tables.map((table) => ({
          ...table,
          columns: table.columns ?? [],
        })),
      })),
    [schemas]
  );

  // Filter and sort schemas/tables based on search query and selection
  const filteredSchemas = useMemo(() => {
    let result = normalizedSchemas;

    // Apply search filter if query exists
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = normalizedSchemas
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
  }, [normalizedSchemas, searchQuery, showColumns, selectable, whitelistForSort]);

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
      <SchemaTreeSearchBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        showColumns={showColumns}
      />

      <SchemaTreeSummaryBar
        onRetry={onRetry}
        connectionName={connectionName}
        stats={stats}
      />

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
            {filteredSchemas.map((schemaItem) => (
              <SchemaTreeSchemaRow
                key={schemaItem.schema}
                schemaItem={schemaItem}
                selectable={selectable}
                whitelist={whitelist}
                onWhitelistChange={onWhitelistChange}
                connectionWhitelisted={connectionWhitelisted}
                showColumns={showColumns}
                showPathFilter={showPathFilter}
                availableChildPaths={availableChildPaths}
                onTablePreview={onTablePreview}
                connectionName={connectionName}
                searchQuery={searchQuery}
                annotationsEditable={annotationsEditable}
                annotations={annotations}
                inheritedAnnotations={inheritedAnnotations}
                metrics={metrics}
                onMetricsChange={onMetricsChange}
                inheritedMetrics={inheritedMetrics}
                expandedSchemas={expandedSchemas}
                expandedTables={expandedTables}
                isSchemaWhitelisted={isSchemaWhitelisted}
                isTableWhitelisted={isTableWhitelisted}
                getSchemaCheckboxState={getSchemaCheckboxState}
                getFilteredColumns={getFilteredColumns}
                getVisibleTableCount={getVisibleTableCount}
                getVisibleColumnCount={getVisibleColumnCount}
                findTableAnn={findTableAnn}
                effectiveTableDescription={effectiveTableDescription}
                effectiveColumnDescription={effectiveColumnDescription}
                setTableDescription={setTableDescription}
                setColumnDescription={setColumnDescription}
                toggleSchema={toggleSchema}
                toggleTable={toggleTable}
                toggleSchemaExpanded={toggleSchemaExpanded}
                toggleTableExpanded={toggleTableExpanded}
                handlePathFilterChange={handlePathFilterChange}
                showMoreTables={showMoreTables}
                showMoreColumns={showMoreColumns}
              />
            ))}
          </VStack>
        )}
      </Box>
    </VStack>
  );
}
