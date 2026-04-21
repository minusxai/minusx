'use client';

import { Box, HStack, VStack, Text, Icon, GridItem } from '@chakra-ui/react';
import { LuCheck, LuX, LuCirclePlus, LuTrash2, LuLayoutGrid, LuType, LuPencil } from 'react-icons/lu';
import { DisplayProps, contentToDetails } from '@/lib/types';
import { type DetailCardProps, parseToolArgs, isToolSuccess } from './DetailCarousel';

// ─── Operation info helper (shared) ──────────────────────────────

function getDashboardOpInfo(operation: string, question_id?: number, asset_id?: string) {
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
}

// ─── Detail card for AgentTurnContainer carousel ──────────────────

export function EditDashboardDetailCard({ msg }: DetailCardProps) {
  const args = parseToolArgs(msg);
  const success = isToolSuccess(msg);
  const { icon, label } = getDashboardOpInfo(args.operation, args.question_id, args.asset_id);

  return (
    <Box mx={3} mb={2} p={3} bg="bg.subtle" borderRadius="md" border="1px solid" borderColor="border.default">
      <HStack gap={2}>
        <Icon as={success ? icon : LuX} boxSize={4} color={success ? 'fg.muted' : 'accent.danger'} />
        <Text fontSize="sm" fontFamily="mono" color="fg.default" fontWeight="600" flex={1}>
          {label}
        </Text>
        <Box bg={success ? 'accent.teal/10' : 'accent.danger/10'} px={2} py={0.5} borderRadius="full" flexShrink={0}>
          <Text fontSize="2xs" fontFamily="mono" color={success ? 'accent.teal' : 'accent.danger'} fontWeight="500">
            {success ? 'Done' : 'Failed'}
          </Text>
        </Box>
      </HStack>
    </Box>
  );
}

// ─── Compact display (existing) ───────────────────────────────────

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

  const { icon, label } = getDashboardOpInfo(operation, question_id, asset_id);

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
