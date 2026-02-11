'use client';

import { Box, HStack, VStack, Text, Icon, Badge, GridItem } from '@chakra-ui/react';
import { LuCheck, LuX, LuBadgeInfo } from 'react-icons/lu';
import { DisplayProps } from '@/lib/types';

export default function ClarifyDisplay({ toolCallTuple }: DisplayProps) {
  const [toolCall, toolMessage] = toolCallTuple;

  // Parse tool arguments to get question and options
  let args: any = {};
  try {
    args = typeof toolCall.function?.arguments === 'string'
      ? JSON.parse(toolCall.function.arguments)
      : toolCall.function?.arguments || {};
  } catch {
    args = {};
  }

  const { question, options = [] } = args;

  // Parse result
  let result: any;
  try {
    result = typeof toolMessage.content === 'string'
      ? JSON.parse(toolMessage.content)
      : toolMessage.content;
  } catch {
    result = { success: false, message: 'Failed to parse result' };
  }

  const { success, message, selection } = result;

  // Check for special selections
  const isFigureItOut = selection?.figureItOut;
  const isOther = selection?.other;

  // Get selected labels for highlighting
  const getSelectedLabels = (): Set<string> => {
    if (!selection) return new Set();
    if (isFigureItOut || isOther) return new Set(); // Special options not in original list
    if (Array.isArray(selection)) {
      return new Set(selection.map(s => s.label || String(s)));
    }
    return new Set([selection.label || String(selection)]);
  };

  const selectedLabels = getSelectedLabels();

  // Format status message
  const getStatusMessage = () => {
    if (!success) return message || 'Cancelled';
    if (isFigureItOut) return 'Agent will figure it out';
    if (isOther) return `Other: "${selection.text}"`;
    return `Selected: ${Array.from(selectedLabels).join(', ')}`;
  };

  return (
    <GridItem colSpan={12} my={2}>
    <Box py={3} px={4} border="1px solid" borderColor="border.default" borderRadius="md" bg="bg.subtle">
      <VStack gap={3} align="stretch">
        {/* Header */}
        <HStack gap={2}>
          <Icon as={LuBadgeInfo} boxSize={4} fill="accent.teal" color="bg.subtle" />
          <Text fontSize="md" fontWeight="600" color="fg.default" fontFamily="mono">Clarification</Text>
        </HStack>

        {/* Question */}
        {question && (
          <Text fontSize="sm" color="fg.muted" fontFamily="mono">
            {question}
          </Text>
        )}

        {/* Options with selection state */}
        <HStack gap={2} flexWrap="wrap">
          {options.map((opt: any, idx: number) => {
            const isSelected = selectedLabels.has(opt.label);
            return (
              <Badge
                key={idx}
                bg={isSelected ? 'accent.teal/20' : 'bg.muted'}
                color={isSelected ? 'accent.teal' : 'fg.muted'}
                px={3}
                py={1}
                borderRadius="full"
                fontSize="sm"
                fontWeight="medium"
                fontFamily="mono"
                opacity={!success ? 0.5 : (isSelected ? 1 : 0.6)}
              >
                {isSelected && <Icon as={LuCheck} boxSize={3} mr={1} />}
                {opt.label}
              </Badge>
            );
          })}

          {/* Show special selection badges */}
          {success && isFigureItOut && (
            <Badge
              bg="accent.teal/20"
              color="accent.teal"
              px={3}
              py={1}
              borderRadius="full"
              fontSize="sm"
              fontWeight="medium"
              fontFamily="mono"
            >
              <Icon as={LuCheck} boxSize={3} mr={1} />
              Figure it out
            </Badge>
          )}
          {success && isOther && (
            <Badge
              bg="accent.teal/20"
              color="accent.teal"
              px={3}
              py={1}
              borderRadius="full"
              fontSize="sm"
              fontWeight="medium"
              fontFamily="mono"
            >
              <Icon as={LuCheck} boxSize={3} mr={1} />
              Other
            </Badge>
          )}
        </HStack>

        {/* Status message */}
        <HStack gap={1}>
          <Icon
            as={success ? LuCheck : LuX}
            boxSize={3}
            color={success ? 'accent.teal' : 'fg.muted'}
          />
          <Text fontSize="xs" color={success ? 'accent.teal' : 'fg.muted'} fontStyle={!success ? 'italic' : 'normal'} fontFamily="mono">
            {getStatusMessage()}
          </Text>
        </HStack>
      </VStack>
    </Box>
    </GridItem>
  );
}
