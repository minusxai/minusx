'use client';

import { HStack, Text, Icon, GridItem } from '@chakra-ui/react';
import { LuCheck, LuX, LuCirclePlus, LuTrash2, LuLayoutGrid, LuType, LuPencil } from 'react-icons/lu';
import { DisplayProps } from '@/lib/types';

export default function EditDashboardDisplay({ toolCallTuple, showThinking }: DisplayProps) {
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

  const { operation, question_id, asset_id } = args;

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

  // Failed - show minimal display hidden behind thinking
  if (!success) {
    return showThinking ? (
      <GridItem colSpan={12} my={1}>
        <HStack gap={2} px={2} py={1} bg="bg.elevated" borderRadius="md">
          <Icon as={LuX} boxSize={3} color="accent.danger" />
          <Text fontSize="xs" color="fg.muted" fontFamily="mono">
            Dashboard edit failed
          </Text>
        </HStack>
      </GridItem>
    ) : null;
  }

  // Get operation info
  const getOpInfo = () => {
    switch (operation) {
      case 'add_existing_question':
        return { icon: LuCirclePlus, label: `Added question #${question_id}`, color: 'accent.teal' };
      case 'remove_question':
        return { icon: LuTrash2, label: `Removed question #${question_id}`, color: 'accent.danger' };
      case 'update_layout':
        return { icon: LuLayoutGrid, label: 'Updated layout', color: 'accent.teal' };
      case 'add_text':
        return { icon: LuType, label: 'Added text', color: 'accent.teal' };
      case 'remove_asset':
        return { icon: LuTrash2, label: `Removed ${asset_id}`, color: 'accent.danger' };
      case 'add_new_question':
        return { icon: LuCirclePlus, label: 'Created & added question', color: 'accent.teal' };
      case 'update_question':
        return { icon: LuPencil, label: `Updated question #${question_id}`, color: 'accent.teal' };
      default:
        return { icon: LuCheck, label: operation || 'Updated dashboard', color: 'accent.teal' };
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
