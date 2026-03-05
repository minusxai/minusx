'use client';

import { useState } from 'react';
import { HStack, VStack, Text, Icon, GridItem, Box } from '@chakra-ui/react';
import { LuCheck, LuX, LuDatabase, LuChevronDown, LuChevronRight } from 'react-icons/lu';
import { DisplayProps } from '@/lib/types';

interface SchemaSearchResult {
  schema: { schema: string; tables: { table: string; columns: { name: string; type: string }[] }[] };
  score: number;
  matchCount: number;
  relevantResults: { field: string; location: string; snippet: string; matchType: string }[];
}

export default function SearchDBSchemaDisplay({ toolCallTuple, showThinking }: DisplayProps) {
  const [toolCall, toolMessage] = toolCallTuple;
  const [isExpanded, setIsExpanded] = useState(false);

  // Parse tool arguments
  let args: any = {};
  try {
    args = typeof toolCall.function?.arguments === 'string'
      ? JSON.parse(toolCall.function.arguments)
      : toolCall.function?.arguments || {};
  } catch {
    args = {};
  }

  const query = args.query || '';
  const connectionId = args.connection_id || '';

  // Parse result
  let result: any;
  try {
    result = typeof toolMessage.content === 'string'
      ? JSON.parse(toolMessage.content)
      : toolMessage.content;
  } catch {
    result = null;
  }

  const success = result?.success !== false;
  const queryType = result?.queryType || 'none';
  const tableCount = result?.tableCount ?? 0;

  if (!success) {
    return showThinking ? (
      <GridItem colSpan={12} my={1}>
        <HStack gap={1.5} px={2} py={1.5} bg="accent.danger/10" borderRadius="md" border="1px solid" borderColor="accent.danger/20">
          <Icon as={LuX} boxSize={3} color="accent.danger" flexShrink={0} />
          <Text fontSize="xs" color="accent.danger" fontFamily="mono">
            Schema search failed
          </Text>
        </HStack>
      </GridItem>
    ) : null;
  }

  const color = 'accent.warning';

  // Build expandable content based on query type
  const searchResults: SchemaSearchResult[] = result?.results || [];
  const schemaResults: any[] = result?.schema || [];

  const hasExpandableContent = queryType === 'string' ? searchResults.length > 0 : schemaResults.length > 0;

  return (
    <GridItem colSpan={12} my={1}>
      <Box
        bg={`${color}/10`}
        borderRadius="md"
        border="1px solid"
        borderColor={`${color}/20`}
        overflow="hidden"
      >
        <HStack
          gap={1.5}
          py={1.5}
          px={2}
          cursor={hasExpandableContent ? 'pointer' : 'default'}
          onClick={() => hasExpandableContent && setIsExpanded(!isExpanded)}
          align="start"
        >
          {hasExpandableContent && (
            <Icon as={isExpanded ? LuChevronDown : LuChevronRight} boxSize={3} color={color} flexShrink={0} mt={0.5} />
          )}
          {!hasExpandableContent && (
            <Icon as={LuCheck} boxSize={3} color={color} flexShrink={0} mt={0.5} />
          )}
          <HStack gap={1} minW={0} flex={1}>
            <Text fontSize="xs" color={color} fontFamily="mono" truncate>
              <Icon as={LuDatabase} boxSize={3} display="inline" verticalAlign="middle" mr={1} />
              Schema{query ? ` "${query}"` : ''}{connectionId ? ` on ${connectionId}` : ''}
            </Text>
            <Text fontSize="xs" color="fg.muted" fontFamily="mono" flexShrink={0}>
              · {tableCount} {tableCount === 1 ? 'table' : 'tables'}
            </Text>
          </HStack>
        </HStack>

        {/* Expandable results for string search */}
        {isExpanded && queryType === 'string' && searchResults.length > 0 && (
          <VStack gap={1} px={2} pb={2} align="stretch">
            {searchResults.slice(0, 6).map((item, i) => {
              const topSnippet = item.relevantResults?.[0];
              const schemaName = item.schema?.schema || 'unknown';
              const tableCt = item.schema?.tables?.length || 0;
              return (
                <HStack
                  key={i}
                  gap={1.5}
                  px={2}
                  py={1}
                  borderRadius="sm"
                  bg={`${color}/8`}
                >
                  <Icon as={LuDatabase} boxSize={3} color={color} flexShrink={0} />
                  <VStack gap={0} align="start" flex={1} minW={0}>
                    <Text fontSize="xs" color="fg.default" fontFamily="mono" fontWeight="600" truncate w="full">
                      {schemaName} ({tableCt} {tableCt === 1 ? 'table' : 'tables'})
                    </Text>
                    {topSnippet && (
                      <Text fontSize="2xs" color="fg.muted" fontFamily="mono" truncate w="full">
                        {topSnippet.field}: {topSnippet.snippet}
                      </Text>
                    )}
                  </VStack>
                </HStack>
              );
            })}
            {searchResults.length > 6 && (
              <Text fontSize="xs" color="fg.muted" fontFamily="mono" px={2}>
                ...{searchResults.length - 6} more results
              </Text>
            )}
          </VStack>
        )}

        {/* Expandable results for full schema / jsonpath */}
        {isExpanded && queryType !== 'string' && schemaResults.length > 0 && (
          <VStack gap={1} px={2} pb={2} align="stretch">
            {schemaResults.slice(0, 6).map((item, i) => {
              // Full schema format: { schema, tables: [...] }
              const schemaName = item.schema || item._schema || 'unknown';
              const tableCt = item.tables?.length;
              // JSONPath format: { name, type, _schema, _table }
              const colName = item.name;
              const colType = item.type;
              const tableName = item._table;

              return (
                <HStack
                  key={i}
                  gap={1.5}
                  px={2}
                  py={1}
                  borderRadius="sm"
                  bg={`${color}/8`}
                >
                  <Icon as={LuDatabase} boxSize={3} color={color} flexShrink={0} />
                  <Text fontSize="xs" color="fg.default" fontFamily="mono" fontWeight="600" truncate>
                    {colName
                      ? `${schemaName}.${tableName}.${colName} (${colType})`
                      : tableCt !== undefined
                        ? `${schemaName} (${tableCt} ${tableCt === 1 ? 'table' : 'tables'})`
                        : schemaName
                    }
                  </Text>
                </HStack>
              );
            })}
            {schemaResults.length > 6 && (
              <Text fontSize="xs" color="fg.muted" fontFamily="mono" px={2}>
                ...{schemaResults.length - 6} more results
              </Text>
            )}
          </VStack>
        )}
      </Box>
    </GridItem>
  );
}
