'use client';

import { useState } from 'react';
import {
  Box,
  VStack,
  HStack,
  Input,
  Button,
  Text,
  Icon,
  Spinner,
  IconButton,
} from '@chakra-ui/react';
import { LuTriangleAlert, LuTable, LuRefreshCw } from 'react-icons/lu';
import { SchemaTreeItem } from './SchemaTreeView';
import { useRouter } from '@/lib/navigation/use-navigation';

interface ConnectionTablesBrowserProps {
  schemas: SchemaTreeItem[];
  schemaLoading: boolean;
  schemaError: string | null;
  connectionName: string;
  onRetry: () => void;
}

const TABLES_PER_PAGE = 20;

export default function ConnectionTablesBrowser({
  schemas,
  schemaLoading,
  schemaError,
  connectionName,
  onRetry,
}: ConnectionTablesBrowserProps) {
  const router = useRouter();
  const [tableSearch, setTableSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  const handleTableClick = (schemaName: string, tableName: string) => {
    const fullTableName = schemaName ? `${schemaName}.${tableName}` : tableName;
    const query = `SELECT * FROM ${fullTableName} LIMIT 100`;
    const params = new URLSearchParams({
      databaseName: connectionName,
      query: query,
    });
    router.push(`/new/question?${params.toString()}`);
  };

  if (schemaLoading) {
    return (
      <VStack justify="center" align="center" h="300px" gap={3}>
        <Spinner size="lg" color="accent.teal" />
        <Text fontSize="sm" color="fg.muted">Loading schema...</Text>
      </VStack>
    );
  }

  if (schemaError) {
    return (
      <VStack justify="center" align="center" h="300px" gap={3}>
        <Icon as={LuTriangleAlert} boxSize={8} color="accent.danger" />
        <Text fontSize="sm" color="accent.danger">{schemaError}</Text>
        <Button size="sm" onClick={onRetry} colorPalette="teal">
          Retry
        </Button>
      </VStack>
    );
  }

  if (schemas.length === 0) {
    return (
      <VStack justify="center" align="center" h="300px" gap={3}>
        <Icon as={LuTable} boxSize={8} color="fg.muted" />
        <Text fontSize="sm" color="fg.muted">No tables found</Text>
        <Button size="sm" onClick={onRetry} colorPalette="teal">
          Refresh
        </Button>
      </VStack>
    );
  }

  // Filter tables
  const allTables = schemas.flatMap((schema) =>
    schema.tables.map((table) => ({
      schema: schema.schema,
      table: table.table,
      columnCount: table.columns.length,
    }))
  );

  const filteredTables = allTables.filter((item) =>
    tableSearch
      ? item.table.toLowerCase().includes(tableSearch.toLowerCase()) ||
        item.schema.toLowerCase().includes(tableSearch.toLowerCase())
      : true
  );

  // Pagination calculations
  const totalTables = filteredTables.length;
  const totalPages = Math.ceil(totalTables / TABLES_PER_PAGE);
  const startIndex = (currentPage - 1) * TABLES_PER_PAGE;
  const paginatedTables = filteredTables.slice(startIndex, startIndex + TABLES_PER_PAGE);

  return (
    <VStack align="stretch" gap={4}>
      {/* Search and Refresh */}
      <HStack gap={2}>
        <Input
          placeholder="Search tables..."
          value={tableSearch}
          onChange={(e) => {
            setTableSearch(e.target.value);
            setCurrentPage(1);
          }}
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

      {filteredTables.length === 0 ? (
        <Text fontSize="sm" color="fg.muted" textAlign="center" py={8}>
          {tableSearch ? `No tables matching "${tableSearch}"` : 'No tables found'}
        </Text>
      ) : (
        <>
          {/* Results count */}
          <HStack justify="space-between" align="center">
            <Text fontSize="xs" color="fg.muted">
              Showing {startIndex + 1}-{Math.min(startIndex + TABLES_PER_PAGE, totalTables)} of {totalTables} tables
            </Text>
          </HStack>

          {/* Tables Grid */}
          <Box
            display="grid"
            gridTemplateColumns="repeat(auto-fill, minmax(250px, 1fr))"
            gap={3}
          >
            {paginatedTables.map((item) => (
              <Box
                key={`${item.schema}.${item.table}`}
                p={4}
                bg="bg.muted"
                borderRadius="lg"
                border="1px solid"
                borderColor="border.default"
                cursor="pointer"
                transition="all 0.2s"
                _hover={{
                  bg: 'bg.surface',
                  borderColor: 'accent.teal',
                  transform: 'translateY(-2px)',
                  shadow: 'md',
                }}
                onClick={() => handleTableClick(item.schema, item.table)}
              >
                <HStack gap={3} align="start">
                  <Icon
                    as={LuTable}
                    boxSize={5}
                    color="accent.teal"
                    mt={0.5}
                  />
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
                      title={item.table}
                    >
                      {item.table}
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
                          title={item.schema}
                        >
                          {item.schema}
                        </Text>
                      </Box>
                      <Box
                        px={1.5}
                        py={0.5}
                        bg="fg.muted/10"
                        borderRadius="sm"
                        flexShrink={0}
                      >
                        <Text
                          fontSize="2xs"
                          fontWeight="600"
                          color="fg.muted"
                          fontFamily="mono"
                        >
                          {item.columnCount} cols
                        </Text>
                      </Box>
                    </HStack>
                  </VStack>
                </HStack>
              </Box>
            ))}
          </Box>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <HStack justify="center" gap={2} pt={2}>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                Previous
              </Button>
              <HStack gap={1}>
                {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                  let pageNum: number;
                  if (totalPages <= 5) {
                    pageNum = i + 1;
                  } else if (currentPage <= 3) {
                    pageNum = i + 1;
                  } else if (currentPage >= totalPages - 2) {
                    pageNum = totalPages - 4 + i;
                  } else {
                    pageNum = currentPage - 2 + i;
                  }
                  return (
                    <Button
                      key={pageNum}
                      size="xs"
                      variant={currentPage === pageNum ? 'solid' : 'ghost'}
                      bg={currentPage === pageNum ? 'accent.teal' : undefined}
                      color={currentPage === pageNum ? 'white' : undefined}
                      onClick={() => setCurrentPage(pageNum)}
                      minW="32px"
                    >
                      {pageNum}
                    </Button>
                  );
                })}
              </HStack>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
              >
                Next
              </Button>
            </HStack>
          )}
        </>
      )}
    </VStack>
  );
}
