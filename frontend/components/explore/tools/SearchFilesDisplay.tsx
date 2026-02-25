'use client';

import { useState } from 'react';
import { HStack, VStack, Text, Icon, GridItem, Box } from '@chakra-ui/react';
import { LuCheck, LuX, LuSearch, LuChevronDown, LuChevronRight } from 'react-icons/lu';
import { DisplayProps } from '@/lib/types';
import { getFileTypeMetadata } from '@/lib/ui/file-metadata';
import type { FileType } from '@/lib/ui/file-metadata';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

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

  const color = 'accent.warning';
  const hasResults = results.length > 0;

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
          flexWrap="wrap"
          cursor={hasResults ? 'pointer' : 'default'}
          onClick={() => hasResults && setIsExpanded(!isExpanded)}
        >
          {hasResults && (
            <Icon as={isExpanded ? LuChevronDown : LuChevronRight} boxSize={3} color={color} flexShrink={0} />
          )}
          {!hasResults && (
            <Icon as={LuCheck} boxSize={3} color={color} flexShrink={0} />
          )}
          <Icon as={LuSearch} boxSize={3} color={color} flexShrink={0} />
          <Text fontSize="xs" color={color} fontFamily="mono">
            Search{query ? ` "${query}"` : ''}
          </Text>
          <Text fontSize="xs" color="fg.muted" fontFamily="mono">
            {total} {total === 1 ? 'result' : 'results'}
          </Text>
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
                    bg={`${color}/8`}
                    _hover={{ bg: `${color}/18` }}
                    cursor="pointer"
                  >
                    {FileIcon && <Icon as={FileIcon} boxSize={3} color={color} flexShrink={0} />}
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
