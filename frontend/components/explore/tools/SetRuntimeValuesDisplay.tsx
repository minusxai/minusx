'use client';

import { HStack, Text, Icon, GridItem } from '@chakra-ui/react';
import { LuCheck, LuX } from 'react-icons/lu';
import { DisplayProps } from '@/lib/types';

export default function SetRuntimeValuesDisplay({ toolCallTuple, showThinking }: DisplayProps) {
  const [toolCall, toolMessage] = toolCallTuple;

  // Parse tool arguments
  let args: any = {};
  try {
    args = typeof toolCall.function?.arguments === 'string'
      ? JSON.parse(toolCall.function.arguments)
      : toolCall.function?.arguments || {};
  } catch {
    args = {};
  }

  // Parse result
  let result: any;
  try {
    result = typeof toolMessage.content === 'string'
      ? JSON.parse(toolMessage.content)
      : toolMessage.content;
  } catch {
    result = { success: false };
  }

  const { success } = result;

  // Build label from parameter_values
  const paramValues = args.parameter_values || {};
  const entries = Object.entries(paramValues);
  const paramSummary = entries.length > 0
    ? entries.slice(0, 3).map(([k, v]) => `${k}=${v}`).join(', ') +
      (entries.length > 3 ? `, +${entries.length - 3} more` : '')
    : 'parameters';

  const color = success ? 'accent.teal' : 'accent.danger';
  const icon = success ? LuCheck : LuX;
  const label = success
    ? `Set ${entries.length} parameter(s): ${paramSummary}`
    : 'Failed to set parameters';

  if (!success && !showThinking) return null;

  return (
    <GridItem colSpan={12} my={1}>
      <HStack
        gap={1.5}
        py={1.5}
        px={2}
        bg={`${color}/10`}
        borderRadius="md"
        border="1px solid"
        borderColor={`${color}/20`}
        flexWrap="wrap"
      >
        <Icon as={icon} boxSize={3} color={color} flexShrink={0} />
        <Text fontSize="xs" color={color} fontFamily="mono">
          {label}
        </Text>
      </HStack>
    </GridItem>
  );
}
