'use client';

import { HStack, Text, Icon, GridItem } from '@chakra-ui/react';
import { LuCheck, LuX, LuCirclePlus, LuTrash2, LuLayoutGrid, LuType, LuPencil } from 'react-icons/lu';
import { DisplayProps, contentToDetails } from '@/lib/types';

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

  const { success } = contentToDetails(toolMessage);

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
        return { icon: LuCirclePlus, label: `Added question #${question_id}` };
      case 'remove_question':
        return { icon: LuTrash2, label: `Removed question #${question_id}` };
      case 'update_layout':
        return { icon: LuLayoutGrid, label: 'Updated layout' };
      case 'add_text':
        return { icon: LuType, label: 'Added text' };
      case 'remove_asset':
        return { icon: LuTrash2, label: `Removed ${asset_id}` };
      case 'add_new_question':
        return { icon: LuCirclePlus, label: 'Created & added question' };
      case 'update_question':
        return { icon: LuPencil, label: `Updated question #${question_id}` };
      default:
        return { icon: LuCheck, label: operation || 'Updated dashboard' };
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
