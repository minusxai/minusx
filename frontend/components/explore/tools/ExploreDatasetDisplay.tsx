'use client';

import { useState } from 'react';
import { HStack, VStack, Text, Icon, GridItem, Box } from '@chakra-ui/react';
import { LuCheck, LuX, LuBrain, LuChevronDown, LuChevronRight } from 'react-icons/lu';
import { DisplayProps } from '@/lib/types';
import { type DetailCardProps, parseToolArgs, parseToolContent } from './DetailCarousel';

// ─── Detail card for AgentTurnContainer carousel ──────────────────

export function ExploreDatasetDetailCard({ msg }: DetailCardProps) {
  const args = parseToolArgs(msg);
  const result = parseToolContent(msg);
  const prompt = args.prompt || '';
  const query = args.query || '';
  const connection = args.connection || '';
  const analysis = result?.analysis || '';
  const success = result?.success !== false;

  return (
    <VStack gap={1} align="stretch" px={3} pb={2}>
      {/* Header: connection + prompt */}
      <HStack gap={2} mb={1}>
        <Box bg="bg.muted" px={1.5} py={0.5} borderRadius="full" flexShrink={0}>
          <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" fontWeight="500">Explore</Text>
        </Box>
        <Text fontSize="xs" fontFamily="mono" color="fg.muted" truncate flex={1}>
          {connection}
        </Text>
      </HStack>

      {/* Prompt */}
      <Box px={2} py={1.5} bg="bg.subtle" borderRadius="sm">
        <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" mb={0.5}>Prompt</Text>
        <Text fontSize="xs" fontFamily="mono" color="fg.default">
          {prompt}
        </Text>
      </Box>

      {/* Query */}
      {query && (
        <Box px={2} py={1.5} bg="bg.subtle" borderRadius="sm">
          <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" mb={0.5}>Query</Text>
          <Text fontSize="xs" fontFamily="mono" color="fg.default" whiteSpace="pre-wrap">
            {query}
          </Text>
        </Box>
      )}

      {!success ? (
        <HStack gap={1.5}>
          <Icon as={LuX} boxSize={3} color="accent.danger" flexShrink={0} />
          <Text fontSize="xs" color="accent.danger" fontFamily="mono" truncate>
            {result?.error || 'Exploration failed'}
          </Text>
        </HStack>
      ) : analysis ? (
        <Box px={2} py={1.5} bg="bg.subtle" borderRadius="sm" maxH="350px" overflowY="auto">
          <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" mb={0.5}>Analysis</Text>
          <Text fontSize="xs" fontFamily="mono" color="fg.default" whiteSpace="pre-wrap">
            {analysis}
          </Text>
        </Box>
      ) : null}
    </VStack>
  );
}

// ─── Compact display ─────────────────────────────────────────────

export default function ExploreDatasetDisplay({ toolCallTuple, showThinking }: DisplayProps) {
  const [toolCall, toolMessage] = toolCallTuple;
  const [isExpanded, setIsExpanded] = useState(false);

  let args: Record<string, string> = {};
  try {
    args = typeof toolCall.function?.arguments === 'string'
      ? JSON.parse(toolCall.function.arguments)
      : toolCall.function?.arguments || {};
  } catch {
    args = {};
  }

  let result: Record<string, unknown> | null = null;
  try {
    result = typeof toolMessage.content === 'string'
      ? JSON.parse(toolMessage.content)
      : toolMessage.content;
  } catch {
    result = null;
  }

  const prompt = args.prompt || '';
  const success = result?.success !== false;
  const analysis = (result?.analysis as string) || '';

  if (!success) {
    return showThinking ? (
      <GridItem colSpan={12} my={1}>
        <HStack gap={1.5} px={2} py={1.5} bg="accent.danger/10" borderRadius="md" border="1px solid" borderColor="accent.danger/20">
          <Icon as={LuX} boxSize={3} color="accent.danger" flexShrink={0} />
          <Text fontSize="xs" color="accent.danger" fontFamily="mono" truncate>
            Explore failed{result?.error ? `: ${result.error}` : ''}
          </Text>
        </HStack>
      </GridItem>
    ) : null;
  }

  const accent = 'accent.warning';

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
          cursor={analysis ? 'pointer' : 'default'}
          onClick={() => analysis && setIsExpanded(!isExpanded)}
          align="start"
        >
          {analysis ? (
            <Icon as={isExpanded ? LuChevronDown : LuChevronRight} boxSize={3} color={accent} flexShrink={0} mt={0.5} />
          ) : (
            <Icon as={LuCheck} boxSize={3} color={accent} flexShrink={0} mt={0.5} />
          )}
          <HStack gap={1} minW={0} flex={1}>
            <Text fontSize="xs" color="fg.muted" fontFamily="mono" truncate>
              <Icon as={LuBrain} boxSize={3} display="inline" verticalAlign="middle" mr={1} />
              Explore: {prompt}
            </Text>
          </HStack>
        </HStack>

        {isExpanded && analysis && (
          <VStack gap={1} px={2} pb={2} align="stretch">
            <Box px={2} py={1.5} borderRadius="sm" bg="bg.subtle" maxH="200px" overflowY="auto">
              <Text fontSize="xs" fontFamily="mono" color="fg.default" whiteSpace="pre-wrap">
                {analysis}
              </Text>
            </Box>
          </VStack>
        )}
      </Box>
    </GridItem>
  );
}
