'use client';

import { Box, HStack, Text, Icon, GridItem } from '@chakra-ui/react';
import { LuCheck, LuX, LuClock, LuBell, LuSettings } from 'react-icons/lu';
import { DisplayProps, contentToDetails } from '@/lib/types';
import { type DetailCardProps, parseToolArgs, isToolSuccess } from './DetailCarousel';

// ─── Operation info helper (shared) ──────────────────────────────

function getAlertOpInfo(operation: string, question_id?: number) {
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
}

// ─── Detail card for AgentTurnContainer carousel ──────────────────

export function EditAlertDetailCard({ msg }: DetailCardProps) {
  const args = parseToolArgs(msg);
  const success = isToolSuccess(msg);
  const { icon, label } = getAlertOpInfo(args.operation, args.question_id);

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

  const { icon, label } = getAlertOpInfo(operation, question_id);

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
