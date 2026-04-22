'use client';

import { useState } from 'react';
import { HStack, VStack, Text, Icon, GridItem, Box } from '@chakra-ui/react';
import { LuCheck, LuX, LuSearch, LuChevronDown, LuChevronRight } from 'react-icons/lu';
import { DisplayProps } from '@/lib/types';
import { getFileTypeMetadata } from '@/lib/ui/file-metadata';
import type { FileType } from '@/lib/ui/file-metadata';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { type DetailCardProps, parseToolArgs, parseToolContent } from './DetailCarousel';

// ─── Detail card for AgentTurnContainer carousel ──────────────────

export function SearchFilesDetailCard({ msg }: DetailCardProps) {
  const args = parseToolArgs(msg);
  const result = parseToolContent(msg);
  const query = args.query || result.query || '';
  const results: SearchResult[] = result?.results || [];
  const total = result?.total ?? results.length;

  return (
    <VStack gap={1} align="stretch" px={3} pb={2}>
      {/* Kind + query */}
      <HStack gap={2} mb={1}>
        <Box bg="bg.muted" px={1.5} py={0.5} borderRadius="full" flexShrink={0}>
          <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" fontWeight="500">Files</Text>
        </Box>
        {query && (
          <Text fontSize="xs" fontFamily="mono" color="fg.muted" fontStyle="italic" truncate flex={1}>
            &ldquo;{query}&rdquo;
          </Text>
        )}
      </HStack>

      {/* Results */}
      <VStack gap={1} align="stretch" maxH="350px" overflowY="auto">
        {results.length === 0 ? (
          <Text fontSize="xs" color="fg.subtle" fontFamily="mono">No results found</Text>
        ) : (
          <>
            <Text fontSize="2xs" fontFamily="mono" color="fg.subtle">
              {total} {total === 1 ? 'result' : 'results'}
            </Text>
            {results.slice(0, 6).map((r, idx) => {
              const meta = r.type ? getFileTypeMetadata(r.type as FileType) : null;
              return (
                <Box key={r.id || idx} p={2} bg="bg.subtle" borderRadius="md" border="1px solid" borderColor="border.default">
                  <HStack gap={2}>
                    <Icon as={meta?.icon || LuCheck} boxSize={3.5} color={meta?.color || 'fg.muted'} flexShrink={0} />
                    <VStack gap={0} align="start" flex={1} minW={0}>
                      <Text fontSize="xs" fontFamily="mono" color="fg.default" fontWeight="600" truncate w="full">
                        {r.name}
                      </Text>
                      <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" truncate w="full">
                        {r.path}
                      </Text>
                    </VStack>
                    {meta && (
                      <Box bg={`${meta.color}/10`} px={1.5} py={0.5} borderRadius="full" flexShrink={0}>
                        <Text fontSize="2xs" fontFamily="mono" color={meta.color} fontWeight="500">
                          {meta.label}
                        </Text>
                      </Box>
                    )}
                  </HStack>
                </Box>
              );
            })}
            {results.length > 6 && (
              <Text fontSize="2xs" fontFamily="mono" color="fg.subtle">+{results.length - 6} more</Text>
            )}
          </>
        )}
      </VStack>
    </VStack>
  );
}

// ─── Compact display (existing) ───────────────────────────────────

interface SearchResult {
  id: number;
  name: string;
  path: string;
  type: string;
  score: number;
  matchCount: number;
  relevantResults: { field: string; snippet: string; matchType: string }[];
}

export default function SearchFilesDisplay({ toolCallTuple, showThinking }: DisplayProps) {
  const searchParams = useSearchParams();
  const mode = searchParams.get('mode');
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
  const results: SearchResult[] = result?.results || [];
  const total = result?.total ?? results.length;

  const withMode = (url: string) => {
    if (!mode) return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}mode=${mode}`;
  };

  if (!success) {
    return showThinking ? (
      <GridItem colSpan={12} my={1}>
        <HStack gap={1.5} px={2} py={1.5} bg="accent.danger/10" borderRadius="md" border="1px solid" borderColor="accent.danger/20">
          <Icon as={LuX} boxSize={3} color="accent.danger" flexShrink={0} />
          <Text fontSize="xs" color="accent.danger" fontFamily="mono">
            Search failed
          </Text>
        </HStack>
      </GridItem>
    ) : null;
  }

  const accent = 'accent.cyan';
  const hasResults = results.length > 0;

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
          cursor={hasResults ? 'pointer' : 'default'}
          onClick={() => hasResults && setIsExpanded(!isExpanded)}
          align="start"
        >
          {hasResults && (
            <Icon as={isExpanded ? LuChevronDown : LuChevronRight} boxSize={3} color={accent} flexShrink={0} mt={0.5} />
          )}
          {!hasResults && (
            <Icon as={LuCheck} boxSize={3} color={accent} flexShrink={0} mt={0.5} />
          )}
          <HStack gap={1} minW={0} flex={1}>
            <Text fontSize="xs" color="fg.muted" fontFamily="mono" truncate>
              <Icon as={LuSearch} boxSize={3} display="inline" verticalAlign="middle" mr={1} />
              Search{query ? ` "${query}"` : ''}
            </Text>
            <Text fontSize="xs" color="fg.muted" fontFamily="mono" flexShrink={0}>
              · {total} {total === 1 ? 'result' : 'results'}
            </Text>
          </HStack>
        </HStack>

        {/* Expandable results list */}
        {isExpanded && hasResults && (
          <VStack gap={1} px={2} pb={2} align="stretch">
            {results.slice(0, 6).map((file) => {
              const meta = getFileTypeMetadata(file.type as FileType);
              const FileIcon = meta?.icon;
              const topSnippet = file.relevantResults?.[0];
              return (
                <Link key={file.id} href={withMode(`/f/${file.id}`)} onClick={(e) => e.stopPropagation()}>
                  <HStack
                    gap={1.5}
                    px={2}
                    py={1}
                    borderRadius="sm"
                    bg="bg.subtle"
                    _hover={{ bg: 'bg.muted' }}
                    cursor="pointer"
                  >
                    {FileIcon && <Icon as={FileIcon} boxSize={3} color="fg.muted" flexShrink={0} />}
                    <VStack gap={0} align="start" flex={1} minW={0}>
                      <Text fontSize="xs" color="fg.default" fontFamily="mono" fontWeight="600" truncate w="full">
                        {file.name}
                      </Text>
                      {topSnippet && (
                        <Text fontSize="2xs" color="fg.muted" fontFamily="mono" truncate w="full">
                          {topSnippet.field}: {topSnippet.snippet}
                        </Text>
                      )}
                    </VStack>
                  </HStack>
                </Link>
              );
            })}
            {results.length > 6 && (
              <Text fontSize="xs" color="fg.muted" fontFamily="mono" px={2}>
                ...{results.length - 6} more results
              </Text>
            )}
          </VStack>
        )}
      </Box>
    </GridItem>
  );
}
