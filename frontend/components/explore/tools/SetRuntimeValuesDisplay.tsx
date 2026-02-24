'use client';

import { HStack, Text, Icon, GridItem, Box } from '@chakra-ui/react';
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

  // Build chips from parameter_values
  const paramValues = args.parameter_values || {};
  const entries = Object.entries(paramValues);

  const color = success ? 'accent.teal' : 'accent.danger';
  const icon = success ? LuCheck : LuX;

  if (!success && !showThinking) return null;

  if (!success) {
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
        >
          <Icon as={icon} boxSize={3} color={color} flexShrink={0} />
          <Text fontSize="xs" color={color} fontFamily="mono">
            Failed to set parameters
          </Text>
        </HStack>
      </GridItem>
    );
  }

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
          Set {entries.length} parameter(s)
        </Text>
        {entries.slice(0, 5).map(([k, v]) => (
          <Box
            key={k}
            px={1.5}
            py={0.5}
            bg={`${color}/85`}
            color={"white"}
            borderRadius="sm"
          >
            <Text fontSize="xs" color={"white"} fontFamily="mono">
              {k}={String(v)}
            </Text>
          </Box>
        ))}
        {entries.length > 5 && (
          <Text fontSize="xs" color="fg.muted" fontFamily="mono">
            +{entries.length - 5} more
          </Text>
        )}
      </HStack>
    </GridItem>
  );
}
