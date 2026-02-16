'use client';

import { HStack, Text, Icon, GridItem } from '@chakra-ui/react';
import { LuCheck, LuX, LuClock, LuBell, LuSettings } from 'react-icons/lu';
import { DisplayProps } from '@/lib/types';

export default function EditAlertDisplay({ toolCallTuple, showThinking }: DisplayProps) {
  const [toolCall, toolMessage] = toolCallTuple;

  let args: any = {};
  try {
    args = typeof toolCall.function?.arguments === 'string'
      ? JSON.parse(toolCall.function.arguments)
      : toolCall.function?.arguments || {};
  } catch {
    args = {};
  }

  const { operation, question_id } = args;

  let result: any;
  try {
    result = typeof toolMessage.content === 'string'
      ? JSON.parse(toolMessage.content)
      : toolMessage.content;
  } catch {
    result = { success: false };
  }

  const { success } = result;

  if (!success) {
    return showThinking ? (
      <GridItem colSpan={12} my={1}>
        <HStack gap={2} px={2} py={1} bg="bg.elevated" borderRadius="md">
          <Icon as={LuX} boxSize={3} color="accent.danger" />
          <Text fontSize="xs" color="fg.muted" fontFamily="mono">
            Alert edit failed
          </Text>
        </HStack>
      </GridItem>
    ) : null;
  }

  const getOpInfo = () => {
    switch (operation) {
      case 'update_schedule':
        return { icon: LuClock, label: 'Updated schedule', color: 'accent.teal' };
      case 'update_question':
        return { icon: LuBell, label: `Set question to #${question_id}`, color: 'accent.teal' };
      case 'update_condition':
        return { icon: LuSettings, label: 'Updated condition', color: 'accent.teal' };
      default:
        return { icon: LuCheck, label: operation || 'Updated alert', color: 'accent.teal' };
    }
  };

  const { icon, label, color } = getOpInfo();

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
