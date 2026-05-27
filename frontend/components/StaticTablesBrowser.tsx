'use client';

import { useState } from 'react';
import {
  Box,
  VStack,
  HStack,
  Input,
  Button,
  Text,
  Spinner,
  IconButton,
  Collapsible,
  Icon,
} from '@chakra-ui/react';
import { Tooltip } from '@/components/ui/tooltip';
import {
  LuTriangleAlert,
  LuTable,
  LuRefreshCw,
  LuDatabase,
  LuChevronDown,
  LuChevronRight,
} from 'react-icons/lu';
import { SchemaTreeItem } from './SchemaTreeView';
import { useRouter } from '@/lib/navigation/use-navigation';
import { getDatasetContextStatus } from '@/lib/context/dataset-context-status';

interface WhitelistedSchema {
  schema: string;
  tables: Array<{ table: string; columns: Array<{ name: string; type: string }> }>;
}

interface StaticTablesBrowserProps {
  schemas: SchemaTreeItem[];
  schemaLoading: boolean;
  schemaError: string | null;
  connectionName: string;
  onRetry: () => void;
  /** Schemas that are in the context whitelist for this connection */
  whitelistedSchemas?: WhitelistedSchema[];
}

export default function StaticTablesBrowser({
  schemas,
  schemaLoading,
  schemaError,
  connectionName,
  onRetry,
  whitelistedSchemas,
}: StaticTablesBrowserProps) {
  const router = useRouter();
  const [tableSearch, setTableSearch] = useState('');
  const [collapsedDatasets, setCollapsedDatasets] = useState<Set<string>>(new Set());

  const toggleDataset = (schema: string) => {
    setCollapsedDatasets((prev) => {
      const next = new Set(prev);
      if (next.has(schema)) next.delete(schema);
      else next.add(schema);
      return next;
    });
  };

  const handleTableClick = (schemaName: string, tableName: string) => {
    const fullTableName = schemaName ? `${schemaName}.${tableName}` : tableName;
    const query = `SELECT * FROM ${fullTableName} LIMIT 100`;
    const utf8Bytes = new TextEncoder().encode(query);
    const binaryStr = Array.from(utf8Bytes, b => String.fromCharCode(b)).join('');
    const params = new URLSearchParams({
      databaseName: connectionName,
      queryB64: btoa(binaryStr),
    });
    router.push(`/new/question?${params.toString()}`);
  };

  const getContextStatus = (schemaName: string, tableCount: number) =>
    getDatasetContextStatus(schemaName, tableCount, whitelistedSchemas);

  if (schemaLoading) {
    return (
      <VStack justify="center" align="center" h="300px" gap={3}>
        <Spinner size="lg" color="accent.teal" />
        <Text fontSize="sm" color="fg.muted">Loading datasets...</Text>
      </VStack>
    );
  }

  if (schemaError) {
    return (
      <VStack justify="center" align="center" h="300px" gap={3}>
        <LuTriangleAlert size={32} color="var(--chakra-colors-accent-danger)" />
        <Text fontSize="sm" color="accent.danger">{schemaError}</Text>
        <Button size="sm" onClick={onRetry} colorPalette="teal">Retry</Button>
      </VStack>
    );
  }

  if (schemas.length === 0) {
    return (
      <VStack justify="center" align="center" h="300px" gap={3}>
        <LuTable size={32} color="var(--chakra-colors-fg-muted)" />
        <Text fontSize="sm" color="fg.muted">No datasets yet</Text>
        <Text fontSize="xs" color="fg.subtle">Upload CSV files or add a Google Sheet in Settings.</Text>
      </VStack>
    );
  }

  // Filter tables across all datasets
  const filteredSchemas = schemas.map((schema) => ({
    ...schema,
    tables: schema.tables.filter((t) =>
      tableSearch
        ? t.table.toLowerCase().includes(tableSearch.toLowerCase()) ||
          schema.schema.toLowerCase().includes(tableSearch.toLowerCase())
        : true
    ),
  })).filter((schema) => schema.tables.length > 0);

  const totalTables = filteredSchemas.reduce((sum, s) => sum + s.tables.length, 0);

  return (
    <VStack align="stretch" gap={2}>
      {/* Search and Refresh */}
      <HStack justify="space-between" align="center">
        <Text fontSize="xs" color="fg.muted">
          {filteredSchemas.length} dataset{filteredSchemas.length !== 1 ? 's' : ''} &middot; {totalTables} table{totalTables !== 1 ? 's' : ''}
        </Text>
      </HStack>
      <HStack gap={2}>
        <Input
          placeholder="Search tables..."
          value={tableSearch}
          onChange={(e) => setTableSearch(e.target.value)}
          fontFamily="mono"
          fontSize="sm"
          flex={1}
        />
        <IconButton
          aria-label="Refresh schema"
          size="md"
          variant="outline"
          onClick={onRetry}
          title="Fetch latest schema from database"
        >
          <LuRefreshCw size={16} />
        </IconButton>
      </HStack>

      {filteredSchemas.length === 0 ? (
        <Text fontSize="sm" color="fg.muted" textAlign="center" py={8}>
          {tableSearch ? `No tables matching "${tableSearch}"` : 'No tables found'}
        </Text>
      ) : (
        <VStack align="stretch" gap={3}>
          {filteredSchemas.map((schema) => {
            const isExpanded = !collapsedDatasets.has(schema.schema);
            const contextStatus = getContextStatus(schema.schema, schema.tables.length);
            const schemaWL = contextStatus.inContext;

            return (
              <Box
                key={schema.schema}
                borderRadius="lg"
                border="1px solid"
                borderColor="border.default"
                overflow="hidden"
              >
                {/* Dataset header */}
                <HStack
                  as="button"
                  w="100%"
                  gap={2}
                  px={4}
                  py={2.5}
                  cursor="pointer"
                  bg={isExpanded ? 'bg.surface' : 'bg.muted'}
                  _hover={{ bg: 'bg.surface' }}
                  transition="background 0.1s"
                  onClick={() => toggleDataset(schema.schema)}
                >
                  {isExpanded
                    ? <LuChevronDown size={14} color="var(--chakra-colors-fg-muted)" />
                    : <LuChevronRight size={14} color="var(--chakra-colors-fg-muted)" />
                  }
                  <LuDatabase size={14} color="var(--chakra-colors-accent-secondary)" />
                  <Text fontSize="sm" fontWeight="700" fontFamily="mono" color={isExpanded ? 'accent.secondary' : 'fg.default'}>
                    {schema.schema}
                  </Text>
                  <Box px={1.5} py={0.5} bg="fg.muted/10" borderRadius="sm">
                    <Text fontSize="2xs" fontWeight="600" fontFamily="mono" color="fg.muted">
                      {schema.tables.length} {schema.tables.length === 1 ? 'table' : 'tables'}
                    </Text>
                  </Box>
                  <Box flex={1} />
                  {whitelistedSchemas !== undefined && (
                    <Text fontSize="2xs" fontWeight="600" color={schemaWL ? 'accent.teal' : 'fg.subtle'}>
                      {schemaWL ? 'In knowledge base' : 'Not in knowledge base'}
                    </Text>
                  )}
                </HStack>

                {/* Tables grid + actions */}
                <Collapsible.Root open={isExpanded}>
                  <Collapsible.Content>
                    <HStack align="start" gap={0} borderTop="1px solid" borderColor="border.subtle">
                      {/* Tables grid */}
                      <Box
                        display="grid"
                        gridTemplateColumns="repeat(auto-fill, minmax(250px, 1fr))"
                        gap={3}
                        p={3}
                        flex={1}
                        minW={0}
                      >
                        {schema.tables.map((table) => (
                          <Tooltip
                            key={table.table}
                            content="Table not whitelisted"
                            disabled={schemaWL}
                            positioning={{ placement: 'bottom' }}
                          >
                            <Box
                              p={4}
                              bg="bg.muted"
                              borderRadius="lg"
                              border="1px solid"
                              borderColor="border.default"
                              cursor={schemaWL ? 'pointer' : 'not-allowed'}
                              opacity={schemaWL ? 1 : 0.5}
                              transition="all 0.2s"
                              _hover={schemaWL ? {
                                bg: 'bg.surface',
                                borderColor: 'accent.teal',
                                transform: 'translateY(-2px)',
                                shadow: 'md',
                              } : undefined}
                              onClick={schemaWL ? () => handleTableClick(schema.schema, table.table) : undefined}
                            >
                              <HStack gap={3} align="start">
                                <Icon as={LuTable} boxSize={5} color="accent.teal" mt={0.5} flexShrink={0} />
                                <VStack align="start" gap={1.5} flex={1} minW={0}>
                                  <Text
                                    fontSize="sm"
                                    fontWeight="700"
                                    fontFamily="mono"
                                    color="fg.default"
                                    textOverflow="ellipsis"
                                    overflow="hidden"
                                    whiteSpace="nowrap"
                                    w="100%"
                                    title={table.table}
                                  >
                                    {table.table}
                                  </Text>
                                  <HStack gap={2} w="100%" flexWrap="wrap">
                                    <Box
                                      px={1.5}
                                      py={0.5}
                                      bg="accent.secondary/15"
                                      borderRadius="sm"
                                      maxW="100%"
                                      minW={0}
                                    >
                                      <Text
                                        fontSize="2xs"
                                        fontWeight="600"
                                        color="accent.secondary"
                                        fontFamily="mono"
                                        textOverflow="ellipsis"
                                        overflow="hidden"
                                        whiteSpace="nowrap"
                                        title={schema.schema}
                                      >
                                        {schema.schema}
                                      </Text>
                                    </Box>
                                    <Box
                                      px={1.5}
                                      py={0.5}
                                      bg="fg.muted/10"
                                      borderRadius="sm"
                                      flexShrink={0}
                                    >
                                      <Text fontSize="2xs" fontWeight="600" color="fg.muted" fontFamily="mono">
                                        {table.columns.length} cols
                                      </Text>
                                    </Box>
                                  </HStack>
                                </VStack>
                              </HStack>
                            </Box>
                          </Tooltip>
                        ))}
                      </Box>

                    </HStack>
                  </Collapsible.Content>
                </Collapsible.Root>
              </Box>
            );
          })}
        </VStack>
      )}
    </VStack>
  );
}
