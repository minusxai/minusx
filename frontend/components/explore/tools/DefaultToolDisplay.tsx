'use client';

import { useState } from 'react';
import { Box, HStack, VStack, Text, IconButton, Icon, GridItem } from '@chakra-ui/react';
import { LuChevronDown, LuChevronRight, LuWrench, LuCheck, LuFileText, LuCornerRightUp, LuLoader } from 'react-icons/lu';
import { DisplayProps } from '@/lib/types';

export const DEFAULT_TOOL_MAX_COLS = 12
export const DEFAULT_TOOL_MAX_COLS_COMPACT = 12  // Compact: 4 tools per row

export default function DefaultToolDisplay({ toolCallTuple, databaseName, isCompact, showThinking }: DisplayProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [toolCall, toolMessage] = toolCallTuple;

  const functionName = toolCall.function.name;
  // Note: orchestrator always parses arguments to dict in JS land
  const argsText = JSON.stringify(toolCall.function.arguments, null, 2);
  const resultText = typeof toolMessage.content === 'string'
    ? toolMessage.content
    : JSON.stringify(toolMessage.content, null, 2);

  // Detect if this is a pending tool (content is '(executing...)')
  const isPending = resultText === '(executing...)';

  return (
    showThinking && 
    <GridItem
        colSpan={isExpanded ? 12 : isCompact ? DEFAULT_TOOL_MAX_COLS_COMPACT : DEFAULT_TOOL_MAX_COLS}
        bg={"bg.elevated"}
        borderRadius={"md"}
        p={2}
        my={1}
    >
      <Box
        border="1px solid"
        borderColor="border.default"
        borderRadius="md"
        bg="bg.surface"
        overflow="hidden"
      >
        {/* Header */}
        <HStack
          py={isExpanded ? 3 : 0}
          pr={isExpanded ? 3 : 2}
          cursor="pointer"
          onClick={() => setIsExpanded(!isExpanded)}
          _hover={{ bg: 'bg.muted' }}
          gap={2}
        >
          <IconButton
            aria-label="Toggle details"
            size="xs"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
          >
            {isExpanded ? <LuChevronDown /> : <LuChevronRight />}
          </IconButton>

          <Icon as={LuWrench} boxSize={4} color="accent.secondary" />

          <Text fontWeight="600" fontSize="sm" fontFamily="mono" truncate>
            {functionName}
          </Text>

          <Box ml="auto">
            <HStack gap={1}>
              {isPending ? (
                <>
                  <Icon
                    as={LuLoader}
                    boxSize={3}
                    color="fg.muted"
                    css={{ animation: 'spin 1s linear infinite', '@keyframes spin': { '0%': { transform: 'rotate(0deg)' }, '100%': { transform: 'rotate(360deg)' } } }}
                  />
                  {isExpanded && <Text
                    fontSize="xs"
                    fontFamily="mono"
                    color="fg.muted"
                    fontWeight="600"
                  >
                    Executing...
                  </Text>}
                </>
              ) : (
                <>
                  <Icon as={LuCheck} boxSize={3} color="accent.success" />
                  {isExpanded && <Text
                    fontSize="xs"
                    fontFamily="mono"
                    color="accent.success"
                    fontWeight="600"
                  >
                    Completed
                  </Text>}
                </>
              )}
            </HStack>
          </Box>
        </HStack>

        {/* Expandable Details */}
        {isExpanded && (
          <VStack gap={3} p={3} pt={0} align="stretch" bg="bg.canvas">
            {/* Arguments */}
            <Box>
              <HStack gap={1} mb={1}>
                <Icon as={LuFileText} boxSize={3} color="fg.muted" />
                <Text fontSize="xs" fontWeight="600" color="fg.muted">
                  Arguments
                </Text>
              </HStack>
              <Box
                p={2}
                bg="bg.surface"
                borderRadius="sm"
                fontFamily="mono"
                fontSize="xs"
                overflowX="auto"
              >
                <pre>{argsText}</pre>
              </Box>
            </Box>

            {/* Result */}
            <Box>
              <HStack gap={1} mb={1}>
                <Icon as={LuCornerRightUp} boxSize={3} color="fg.muted" />
                <Text fontSize="xs" fontWeight="600" color="fg.muted">
                  Result
                </Text>
              </HStack>
              <Box
                p={2}
                bg="bg.surface"
                borderRadius="sm"
                fontFamily="mono"
                fontSize="xs"
                overflowX="auto"
              >
                {isPending ? (
                  <HStack gap={2} color="fg.muted" py={1}>
                    <Icon
                      as={LuLoader}
                      boxSize={4}
                      css={{ animation: 'spin 1s linear infinite', '@keyframes spin': { '0%': { transform: 'rotate(0deg)' }, '100%': { transform: 'rotate(360deg)' } } }}
                    />
                    <Text>Executing...</Text>
                  </HStack>
                ) : (
                  <pre>{resultText}</pre>
                )}
              </Box>
            </Box>
          </VStack>
        )}
      </Box>
    </GridItem>
  );
}
