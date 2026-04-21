'use client';

import { Box, HStack, VStack, Text, Icon, GridItem } from '@chakra-ui/react';
import { LuCheck, LuX, LuBookOpen, LuLoader } from 'react-icons/lu';
import { DisplayProps, contentToDetails } from '@/lib/types';
import { type DetailCardProps, parseToolArgs, isToolSuccess } from './DetailCarousel';

// ─── Detail card for AgentTurnContainer carousel ──────────────────

export function LoadSkillDetailCard({ msg }: DetailCardProps) {
  const args = parseToolArgs(msg);
  const success = isToolSuccess(msg);
  const name = args.name || 'unknown';

  return (
    <Box mx={3} mb={2} p={3} bg="bg.subtle" borderRadius="md" border="1px solid" borderColor="border.default">
      <HStack gap={2}>
        <Icon as={success ? LuBookOpen : LuX} boxSize={4}
          color={success ? 'fg.muted' : 'accent.danger'} />
        <VStack gap={0} align="start" flex={1} minW={0}>
          <Text fontSize="sm" fontFamily="mono" color="fg.default" fontWeight="600">
            {name}
          </Text>
          <Text fontSize="2xs" fontFamily="mono" color="fg.subtle">
            {success ? 'Skill loaded' : 'Failed to load'}
          </Text>
        </VStack>
        <Box bg={success ? 'accent.teal/10' : 'accent.danger/10'} px={2} py={0.5} borderRadius="full" flexShrink={0}>
          <Text fontSize="2xs" fontFamily="mono" color={success ? 'accent.teal' : 'accent.danger'} fontWeight="500">
            {success ? 'Loaded' : 'Error'}
          </Text>
        </Box>
      </HStack>
    </Box>
  );
}

// ─── Compact display (existing) ───────────────────────────────────

export default function LoadSkillDisplay({ toolCallTuple }: DisplayProps) {
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

  const skillName = args.name || 'unknown';
  const isPending = toolMessage.content === '(executing...)';

  if (isPending) {
    return (
      <GridItem colSpan={12} my={1}>
        <HStack gap={1.5} py={1.5} px={2} bg="bg.elevated" borderRadius="md">
          <Icon
            as={LuLoader}
            boxSize={3}
            color="fg.muted"
            css={{ animation: 'spin 1s linear infinite', '@keyframes spin': { '0%': { transform: 'rotate(0deg)' }, '100%': { transform: 'rotate(360deg)' } } }}
          />
          <Text fontSize="xs" color="fg.muted" fontFamily="mono">
            Loading skill
          </Text>
          <HStack gap={1} bg="bg.subtle" px={1.5} py={0.5} borderRadius="sm">
            <Icon as={LuBookOpen} boxSize={3} color="fg.default" />
            <Text fontSize="xs" color="fg.default" fontFamily="mono" fontWeight="600">
              {skillName}
            </Text>
          </HStack>
        </HStack>
      </GridItem>
    );
  }

  const { success } = contentToDetails(toolMessage);

  if (!success) {
    return (
      <GridItem colSpan={12} my={1}>
        <HStack gap={2} px={2} py={1.5} bg="bg.elevated" borderRadius="md">
          <Icon as={LuX} boxSize={3} color="accent.danger" />
          <Text fontSize="xs" color="fg.muted" fontFamily="mono">
            Failed to load skill "{skillName}"
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
        bg="bg.subtle"
        borderRadius="md"
        border="1px solid"
        borderColor="border.default"
      >
        <Icon as={LuCheck} boxSize={3} color="accent.success" flexShrink={0} />
        <Text fontSize="xs" color="fg.muted" fontFamily="mono" whiteSpace="nowrap">
          Loaded skill
        </Text>
        <HStack gap={1} bg="bg.subtle" px={1.5} py={0.5} borderRadius="sm">
          <Icon as={LuBookOpen} boxSize={3} color="fg.default" />
          <Text fontSize="xs" color="fg.default" fontFamily="mono" fontWeight="600">
            {skillName}
          </Text>
        </HStack>
      </HStack>
    </GridItem>
  );
}
