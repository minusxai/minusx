'use client';

import { useState } from 'react';
import { HStack, VStack, Text, Icon, GridItem, Box } from '@chakra-ui/react';
import { LuCheck, LuX, LuSearch, LuChevronDown, LuChevronRight } from 'react-icons/lu';
import { DisplayProps } from '@/lib/types';
import { type DetailCardProps, parseToolArgs, parseToolContent } from './DetailCarousel';

// ─── Detail card for AgentTurnContainer carousel ──────────────────

export function FuzzySearchDetailCard({ msg }: DetailCardProps) {
  const args = parseToolArgs(msg);
  const result = parseToolContent(msg);
  const searchTerm = args.search_term || '';
  const column = args.column || '';
  const table = args.table || '';
  const matches: Array<{ value: string; similarity: number }> = result?.matches || [];
  const method = result?.method || '';
  const success = result?.success !== false;

  return (
    <VStack gap={1} align="stretch" px={3} pb={2}>
      {/* Header: table.column + search term */}
      <HStack gap={2} mb={1}>
        <Box bg="bg.muted" px={1.5} py={0.5} borderRadius="full" flexShrink={0}>
          <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" fontWeight="500">Fuzzy</Text>
        </Box>
        <Text fontSize="xs" fontFamily="mono" color="fg.muted" truncate flex={1}>
          {table}.{column}{searchTerm ? ` \u2248 "${searchTerm}"` : ''}
        </Text>
      </HStack>

      {!success ? (
        <HStack gap={1.5}>
          <Icon as={LuX} boxSize={3} color="accent.danger" flexShrink={0} />
          <Text fontSize="xs" color="accent.danger" fontFamily="mono" truncate>
            {result?.error || 'Search failed'}
          </Text>
        </HStack>
      ) : (
        <VStack gap={1} align="stretch" maxH="350px" overflowY="auto">
          <Text fontSize="2xs" fontFamily="mono" color="fg.subtle">
            {matches.length} {matches.length === 1 ? 'match' : 'matches'}
            {method ? ` (${method})` : ''}
          </Text>
          {matches.length === 0 ? (
            <Text fontSize="xs" color="fg.subtle" fontFamily="mono">No matches found</Text>
          ) : (
            matches.slice(0, 10).map((m, idx) => (
              <HStack key={idx} gap={2} px={2} py={1} bg="bg.subtle" borderRadius="sm">
                <Text fontSize="xs" fontFamily="mono" color="fg.default" fontWeight="600" truncate flex={1}>
                  {m.value}
                </Text>
                <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" flexShrink={0}>
                  {(m.similarity * 100).toFixed(0)}%
                </Text>
              </HStack>
            ))
          )}
          {matches.length > 10 && (
            <Text fontSize="2xs" fontFamily="mono" color="fg.subtle">+{matches.length - 10} more</Text>
          )}
        </VStack>
      )}
    </VStack>
  );
}

// ─── Compact display ─────────────────────────────────────────────

export default function FuzzySearchDisplay({ toolCallTuple, showThinking }: DisplayProps) {
  const [toolCall, toolMessage] = toolCallTuple;
  const [isExpanded, setIsExpanded] = useState(false);

  let args: any = {};
  try {
    args = typeof toolCall.function?.arguments === 'string'
      ? JSON.parse(toolCall.function.arguments)
      : toolCall.function?.arguments || {};
  } catch {
    args = {};
  }

  let result: any;
  try {
    result = typeof toolMessage.content === 'string'
      ? JSON.parse(toolMessage.content)
      : toolMessage.content;
  } catch {
    result = null;
  }

  const searchTerm = args.search_term || '';
  const column = args.column || '';
  const table = args.table || '';
  const success = result?.success !== false;
  const matches: Array<{ value: string; similarity: number }> = result?.matches || [];

  if (!success) {
    return showThinking ? (
      <GridItem colSpan={12} my={1}>
        <HStack gap={1.5} px={2} py={1.5} bg="accent.danger/10" borderRadius="md" border="1px solid" borderColor="accent.danger/20">
          <Icon as={LuX} boxSize={3} color="accent.danger" flexShrink={0} />
          <Text fontSize="xs" color="accent.danger" fontFamily="mono" truncate>
            Fuzzy search failed{result?.error ? `: ${result.error}` : ''}
          </Text>
        </HStack>
      </GridItem>
    ) : null;
  }

  const accent = 'accent.cyan';

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
          cursor={matches.length > 0 ? 'pointer' : 'default'}
          onClick={() => matches.length > 0 && setIsExpanded(!isExpanded)}
          align="start"
        >
          {matches.length > 0 ? (
            <Icon as={isExpanded ? LuChevronDown : LuChevronRight} boxSize={3} color={accent} flexShrink={0} mt={0.5} />
          ) : (
            <Icon as={LuCheck} boxSize={3} color={accent} flexShrink={0} mt={0.5} />
          )}
          <HStack gap={1} minW={0} flex={1}>
            <Text fontSize="xs" color="fg.muted" fontFamily="mono" truncate>
              <Icon as={LuSearch} boxSize={3} display="inline" verticalAlign="middle" mr={1} />
              Fuzzy {table}.{column}{searchTerm ? ` \u2248 "${searchTerm}"` : ''}
            </Text>
            <Text fontSize="xs" color="fg.muted" fontFamily="mono" flexShrink={0}>
              · {matches.length} {matches.length === 1 ? 'match' : 'matches'}
            </Text>
          </HStack>
        </HStack>

        {isExpanded && matches.length > 0 && (
          <VStack gap={1} px={2} pb={2} align="stretch">
            {matches.slice(0, 6).map((m, i) => (
              <HStack key={i} gap={1.5} px={2} py={1} borderRadius="sm" bg="bg.subtle">
                <Text fontSize="xs" fontFamily="mono" color="fg.default" fontWeight="600" truncate flex={1}>
                  {m.value}
                </Text>
                <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" flexShrink={0}>
                  {(m.similarity * 100).toFixed(0)}%
                </Text>
              </HStack>
            ))}
            {matches.length > 6 && (
              <Text fontSize="xs" color="fg.muted" fontFamily="mono" px={2}>
                ...{matches.length - 6} more matches
              </Text>
            )}
          </VStack>
        )}
      </Box>
    </GridItem>
  );
}
