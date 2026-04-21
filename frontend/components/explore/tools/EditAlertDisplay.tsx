'use client';

import { HStack, Text, Icon, GridItem } from '@chakra-ui/react';
import { LuCheck, LuX, LuClock, LuBell, LuSettings } from 'react-icons/lu';
import { DisplayProps, contentToDetails } from '@/lib/types';

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

  const { success } = contentToDetails(toolMessage);

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
        return { icon: LuClock, label: 'Updated schedule' };
      case 'update_question':
        return { icon: LuBell, label: `Set question to #${question_id}` };
      case 'update_condition':
        return { icon: LuSettings, label: 'Updated condition' };
      default:
        return { icon: LuCheck, label: operation || 'Updated alert' };
    }
  };

  const { icon, label } = getOpInfo();

  return (
    <GridItem colSpan={12} my={1}>
      <HStack
        gap={1.5}
        py={1.5}
        px={2}
        bg="bg.subtle"
        borderRadius="md"
        border="1px solid"
        borderColor="border.default"
        flexWrap="wrap"
      >
        <Icon as={icon} boxSize={3} color="fg.muted" flexShrink={0} />
        <Text fontSize="xs" color="fg.muted" fontFamily="mono">
          {label}
        </Text>
      </HStack>
    </GridItem>
  );
}
