'use client';

import { useState } from 'react';
import { HStack, VStack, Text, Icon, GridItem, Box } from '@chakra-ui/react';
import { LuCheck, LuX, LuDatabase, LuChevronDown, LuChevronRight } from 'react-icons/lu';
import { DisplayProps } from '@/lib/types';
import { type DetailCardProps, parseToolArgs, parseToolContent } from './DetailCarousel';

// ─── Helpers ────────────────────────────────────────────────────────

/** Summarize column meta for a table: e.g. "3 cat, 2 date" */
function getTableMetaHighlight(columns: any[] | undefined): string | null {
  if (!columns) return null;
  let cat = 0, num = 0, temp = 0;
  for (const col of columns) {
    const c = col.meta?.category;
    if (c === 'categorical') cat++;
    else if (c === 'numeric') num++;
    else if (c === 'temporal') temp++;
  }
  const parts: string[] = [];
  if (cat) parts.push(`${cat} cat`);
  if (temp) parts.push(`${temp} date`);
  if (num) parts.push(`${num} num`);
  return parts.length > 0 ? parts.join(', ') : null;
}

// ─── Detail card for AgentTurnContainer carousel ──────────────────

export function SearchDBSchemaDetailCard({ msg }: DetailCardProps) {
  const args = parseToolArgs(msg);
  const result = parseToolContent(msg);
  const query = args.query || '';
  const queryType = result?.queryType || 'none';

  return (
    <VStack gap={1} align="stretch" px={3} pb={2}>
      {/* Kind + query */}
      <HStack gap={2} mb={1}>
        <Box bg="bg.muted" px={1.5} py={0.5} borderRadius="full" flexShrink={0}>
          <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" fontWeight="500">DB Schema</Text>
        </Box>
        {query && (
          <Text fontSize="xs" fontFamily="mono" color="fg.muted" fontStyle="italic" truncate flex={1}>
            &ldquo;{query}&rdquo;
          </Text>
        )}
      </HStack>

      {/* Results */}
      <VStack gap={1} align="stretch" maxH="350px" overflowY="auto">
        {queryType === 'string' ? (
          <StringSearchResults results={result?.results || []} />
        ) : (
          <SchemaResults schemas={result?.schema || []} queryType={queryType} />
        )}
      </VStack>
    </VStack>
  );
}

/** Render string search results (scored matches) */
function StringSearchResults({ results }: { results: any[] }) {
  if (results.length === 0) return <Text fontSize="xs" color="fg.subtle" fontFamily="mono">No matches</Text>;

  return (
    <>
      <Text fontSize="2xs" fontFamily="mono" color="fg.subtle">
        {results.length} {results.length === 1 ? 'match' : 'matches'}
      </Text>
      {results.slice(0, 8).map((item: any, idx: number) => {
        const schemaObj = item.schema || {};
        const schemaName = schemaObj.schema || 'unknown';
        const tables = schemaObj.tables || [];
        return (
          <Box key={idx} p={2} bg="bg.subtle" borderRadius="md" border="1px solid" borderColor="border.default">
            <HStack gap={2} mb={tables.length > 0 ? 1 : 0}>
              <Icon as={LuDatabase} boxSize={3} color="accent.primary" flexShrink={0} />
              <Text fontSize="xs" fontFamily="mono" color="fg.default" fontWeight="600">
                {schemaName}
              </Text>
              <Text fontSize="2xs" fontFamily="mono" color="fg.subtle">
                {tables.length} {tables.length === 1 ? 'table' : 'tables'} · score {(item.score * 100).toFixed(0)}%
              </Text>
            </HStack>
            {item.relevantResults?.slice(0, 3).map((r: any, ri: number) => (
              <Text key={ri} fontSize="2xs" fontFamily="mono" color="fg.muted" pl={5}>
                {r.field}: {r.location}
              </Text>
            ))}
          </Box>
        );
      })}
      {results.length > 8 && (
        <Text fontSize="2xs" fontFamily="mono" color="fg.subtle">+{results.length - 8} more</Text>
      )}
    </>
  );
}

/** Render full schema or jsonpath results */
function SchemaResults({ schemas, queryType }: { schemas: any[]; queryType: string }) {
  if (schemas.length === 0) return <Text fontSize="xs" color="fg.subtle" fontFamily="mono">No schema data</Text>;

  // JSONPath can return arbitrary shapes (columns, tables, scalars)
  if (queryType === 'jsonpath') {
    return (
      <>
        <Text fontSize="2xs" fontFamily="mono" color="fg.subtle">
          {schemas.length} {schemas.length === 1 ? 'result' : 'results'}
        </Text>
        {schemas.slice(0, 10).map((item: any, idx: number) => (
          <Box key={idx} p={2} bg="bg.subtle" borderRadius="md" border="1px solid" borderColor="border.default">
            <HStack gap={2}>
              <Icon as={LuDatabase} boxSize={3} color="accent.primary" flexShrink={0} />
              <Text fontSize="xs" fontFamily="mono" color="fg.default" fontWeight="600" truncate>
                {item.name
                  ? `${item._schema ? `${item._schema}.` : ''}${item._table ? `${item._table}.` : ''}${item.name}`
                  : item.table
                    ? `${item._schema ? `${item._schema}.` : ''}${item.table}`
                    : item.schema || JSON.stringify(item).slice(0, 60)
                }
              </Text>
              {item.type && (
                <Text fontSize="2xs" fontFamily="mono" color="fg.subtle">{item.type}</Text>
              )}
              {item.columns && (
                <Text fontSize="2xs" fontFamily="mono" color="fg.subtle">{item.columns.length} cols</Text>
              )}
            </HStack>
          </Box>
        ))}
        {schemas.length > 10 && (
          <Text fontSize="2xs" fontFamily="mono" color="fg.subtle">+{schemas.length - 10} more</Text>
        )}
      </>
    );
  }

  // Full schema: [{schema, tables: [{table, columns}]}]
  const totalTables = schemas.reduce((sum: number, s: any) => sum + (s.tables?.length || 0), 0);
  return (
    <>
      <Text fontSize="2xs" fontFamily="mono" color="fg.subtle">
        {schemas.length} {schemas.length === 1 ? 'schema' : 'schemas'} · {totalTables} {totalTables === 1 ? 'table' : 'tables'}
      </Text>
      {schemas.map((s: any, idx: number) => (
        <Box key={idx} p={2} bg="bg.subtle" borderRadius="md" border="1px solid" borderColor="border.default">
          <HStack gap={2} mb={(s.tables?.length || 0) > 0 ? 1 : 0}>
            <Icon as={LuDatabase} boxSize={3} color="accent.primary" flexShrink={0} />
            <Text fontSize="xs" fontFamily="mono" color="fg.default" fontWeight="600">{s.schema}</Text>
            <Text fontSize="2xs" fontFamily="mono" color="fg.subtle">{s.tables?.length || 0} tables</Text>
          </HStack>
          {s.tables && s.tables.length > 0 && (
            <HStack gap={1} flexWrap="wrap" pl={5}>
              {s.tables.slice(0, 12).map((t: any, ti: number) => {
                const colCount = t.columns?.length || 0;
                const metaHighlight = getTableMetaHighlight(t.columns);
                return (
                  <Box key={ti} bg="bg.muted" px={1.5} py={0.5} borderRadius="sm">
                    <Text fontSize="2xs" fontFamily="mono" color="fg.default" fontWeight="600">
                      {t.table}
                      <Text as="span" color="fg.subtle" fontWeight="400"> {colCount}c</Text>
                      {metaHighlight && <Text as="span" color="fg.subtle" fontWeight="400"> · {metaHighlight}</Text>}
                    </Text>
                  </Box>
                );
              })}
              {s.tables.length > 12 && (
                <Text fontSize="2xs" fontFamily="mono" color="fg.subtle">+{s.tables.length - 12}</Text>
              )}
            </HStack>
          )}
        </Box>
      ))}
    </>
  );
}

// ─── Compact display (existing) ───────────────────────────────────

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

  const accent = 'accent.cyan';

  // Build expandable content based on query type
  const searchResults: SchemaSearchResult[] = result?.results || [];
  const schemaResults: any[] = result?.schema || [];

  const hasExpandableContent = queryType === 'string' ? searchResults.length > 0 : schemaResults.length > 0;

  return (
    <GridItem colSpan={12} my={1}>
      <Box
        bg={`${accent}/6`}
        borderRadius="md"
        border="1px solid"
        borderColor={`${accent}/15`}
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
            <Icon as={isExpanded ? LuChevronDown : LuChevronRight} boxSize={3} color={accent} flexShrink={0} mt={0.5} />
          )}
          {!hasExpandableContent && (
            <Icon as={LuCheck} boxSize={3} color={accent} flexShrink={0} mt={0.5} />
          )}
          <HStack gap={1} minW={0} flex={1}>
            <Text fontSize="xs" color="fg.muted" fontFamily="mono" truncate>
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
                  bg="bg.subtle"
                >
                  <Icon as={LuDatabase} boxSize={3} color="fg.muted" flexShrink={0} />
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
                  bg="bg.subtle"
                >
                  <Icon as={LuDatabase} boxSize={3} color="fg.muted" flexShrink={0} />
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
