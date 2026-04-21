'use client';

import { HStack, Text, Icon, GridItem } from '@chakra-ui/react';
import { LuCheck, LuX, LuCirclePlus, LuTrash2, LuClock, LuPencil, LuMail, LuFileText } from 'react-icons/lu';
import { DisplayProps, contentToDetails } from '@/lib/types';

export default function EditReportDisplay({ toolCallTuple, showThinking }: DisplayProps) {
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

  const { operation, reference_id, reference_type } = args;

  const { success } = contentToDetails(toolMessage);

  // Failed - show minimal display hidden behind thinking
  if (!success) {
    return showThinking ? (
      <GridItem colSpan={12} my={1}>
        <HStack gap={2} px={2} py={1} bg="bg.elevated" borderRadius="md">
          <Icon as={LuX} boxSize={3} color="accent.danger" />
          <Text fontSize="xs" color="fg.muted" fontFamily="mono">
            Report edit failed
          </Text>
        </HStack>
      </GridItem>
    ) : null;
  }

  // Get operation info
  const getOpInfo = () => {
    switch (operation) {
      case 'update_schedule':
        return { icon: LuClock, label: 'Updated schedule' };
      case 'add_reference':
        return { icon: LuCirclePlus, label: `Added ${reference_type} #${reference_id}` };
      case 'remove_reference':
        return { icon: LuTrash2, label: `Removed reference #${reference_id}` };
      case 'update_reference':
        return { icon: LuPencil, label: `Updated prompt for #${reference_id}` };
      case 'update_report_prompt':
        return { icon: LuFileText, label: 'Updated synthesis instructions' };
      case 'update_emails':
        return { icon: LuMail, label: 'Updated delivery emails' };
      default:
        return { icon: LuCheck, label: operation || 'Updated report' };
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
