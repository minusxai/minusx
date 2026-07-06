'use client';

import { Box, HStack, Text, Spinner } from '@chakra-ui/react';
import { LuChevronDown, LuChevronRight } from 'react-icons/lu';
import { StreamingProgressInline } from './tools/StreamingProgress';

interface StreamingInfoBlockProps {
  streamingInfo: {
    thinkingText: string | null;
    toolCalls: string[];
    isAnswering: boolean;
    completedCount: number;
    totalCount: number;
    latestAction: string;
  };
  viewMode: 'compact' | 'detailed';
  showThinking: boolean;
  toggleShowThinking: () => void;
}

export default function StreamingInfoBlock({ streamingInfo, viewMode, showThinking, toggleShowThinking }: StreamingInfoBlockProps) {
  const { thinkingText, toolCalls, isAnswering, completedCount, totalCount, latestAction } = streamingInfo;

  if (isAnswering) return null;

  if (thinkingText && viewMode !== 'compact') {
    return (
      <Box my={2}>
        <HStack
          gap={1}
          cursor="pointer"
          onClick={toggleShowThinking}
          _hover={{ opacity: 0.8 }}
          color="fg.subtle"
          fontSize="sm"
          overflow="hidden"
          w="100%"
        >
          <Box flexShrink={0}>{showThinking ? <LuChevronDown size={16} /> : <LuChevronRight size={16} />}</Box>
          {!showThinking && (
            <Text fontFamily="mono" fontSize="sm" color="fg.subtle" fontStyle="italic" truncate>
              {thinkingText}
            </Text>
          )}
          {showThinking && (
            <Text fontFamily="mono" fontSize="sm" color="fg.subtle">Thinking</Text>
          )}
        </HStack>
        {showThinking && (
          <Box mt={1} pl={5} borderLeft="2px solid" borderColor="border.default">
            <Text color="fg.subtle" fontSize="sm" fontFamily="mono" fontStyle="italic" whiteSpace="pre-wrap">
              {thinkingText}
            </Text>
          </Box>
        )}
      </Box>
    );
  }

  if (toolCalls.length > 0) {
    if (viewMode === 'compact') {
      return <StreamingProgressInline completedCount={completedCount} totalCount={totalCount} latestAction={latestAction} />;
    }
    return (
      <HStack my={2} gap={2} flexWrap="wrap">
        {toolCalls.map((tool, i) => (
          <HStack key={i} px={2.5} py={1} borderRadius="full" borderWidth="1px" borderColor="accent.teal/30" bg="accent.teal/5" gap={1.5}>
            <Spinner size="xs" color="accent.teal" />
            <Text color="fg.muted" fontSize="xs" fontFamily="mono">{tool}</Text>
          </HStack>
        ))}
      </HStack>
    );
  }

  return null;
}
