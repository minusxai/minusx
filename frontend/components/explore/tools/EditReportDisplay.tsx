'use client';

import { Box, HStack, Text, Icon, GridItem } from '@chakra-ui/react';
import { LuCheck, LuX, LuCirclePlus, LuTrash2, LuClock, LuPencil, LuMail, LuFileText } from 'react-icons/lu';
import { DisplayProps, contentToDetails } from '@/lib/types';
import { type DetailCardProps, parseToolArgs, isToolSuccess } from './DetailCarousel';

// ─── Operation info helper (shared) ──────────────────────────────

function getReportOpInfo(operation: string, reference_id?: number, reference_type?: string) {
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
}

// ─── Detail card for AgentTurnContainer carousel ──────────────────

export function EditReportDetailCard({ msg }: DetailCardProps) {
  const args = parseToolArgs(msg);
  const success = isToolSuccess(msg);
  const { icon, label } = getReportOpInfo(args.operation, args.reference_id, args.reference_type);

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

  const { icon, label } = getReportOpInfo(operation, reference_id, reference_type);

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
