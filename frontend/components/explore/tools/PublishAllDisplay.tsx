'use client';

import { useMemo } from 'react';
import { useSelector } from 'react-redux';
import { Box, HStack, VStack, Text, Icon, GridItem, Spinner } from '@chakra-ui/react';
import { LuCheck, LuX, LuUpload } from 'react-icons/lu';
import { DisplayProps, contentToDetails } from '@/lib/types';
import type { RootState } from '@/store/store';
import { makeSelectConversationByToolCallId } from '@/store/chatSlice';
import UserInputComponent from '../UserInputComponent';
import { type DetailCardProps, parseToolContent, isToolSuccess } from './DetailCarousel';

// ─── Detail card for AgentTurnContainer carousel ──────────────────

export function PublishAllDetailCard({ msg }: DetailCardProps) {
  const toolMsg = msg as { tool_call_id?: string; function?: { name?: string } };
  const toolCallId = toolMsg.tool_call_id ?? '';
  const success = isToolSuccess(msg);
  const content = parseToolContent(msg);
  const message = content?.message || '';

  // Pending publish confirmation: PublishAll never publishes by itself — it opens the publish
  // prompt and waits for the USER. Render that prompt (mirrors NavigateDetailCard); without this
  // branch an unresolved call mis-rendered as "Published successfully".
  const selectConversation = useMemo(() => makeSelectConversationByToolCallId(), []);
  const conversation = useSelector((state: RootState) => selectConversation(state, toolCallId));
  const pendingTool = conversation?.pending_tool_calls.find(p => p.toolCall.id === toolCallId);
  const pendingUserInputs = pendingTool?.userInputs?.filter(ui => ui.result === undefined);

  if (pendingUserInputs && pendingUserInputs.length > 0 && conversation) {
    return (
      <Box mx={3} mb={2}>
        {pendingUserInputs.map(userInput => (
          <UserInputComponent
            key={userInput.id}
            conversationID={conversation.conversationID}
            tool_call_id={toolCallId}
            userInput={userInput}
            toolName={toolMsg.function?.name}
          />
        ))}
      </Box>
    );
  }

  // Unresolved and no prompt yet (result not in the log): waiting, NOT success.
  if (!content && pendingTool && !pendingTool.result) {
    return (
      <Box mx={3} mb={2} p={3} bg="bg.subtle" borderRadius="md" border="1px solid" borderColor="border.default">
        <HStack gap={2}>
          <Spinner size="xs" color="fg.muted" />
          <Text fontSize="sm" fontFamily="mono" color="fg.muted">
            Waiting for publish confirmation…
          </Text>
        </HStack>
      </Box>
    );
  }

  return (
    <Box mx={3} mb={2} p={3} bg="bg.subtle" borderRadius="md" border="1px solid" borderColor="border.default">
      <HStack gap={2}>
        <Icon as={success ? LuCheck : LuX} boxSize={4}
          color={success ? 'accent.success' : 'accent.danger'} />
        <VStack gap={0} align="start" flex={1} minW={0}>
          <Text fontSize="sm" fontFamily="mono" color="fg.default" fontWeight="600">
            {success ? 'Published successfully' : 'Publish failed'}
          </Text>
          {message && (
            <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" truncate w="full">
              {message}
            </Text>
          )}
        </VStack>
        <Box bg={success ? 'accent.success/10' : 'accent.danger/10'} px={2} py={0.5} borderRadius="full" flexShrink={0}>
          <Text fontSize="2xs" fontFamily="mono" color={success ? 'accent.success' : 'accent.danger'} fontWeight="500">
            {success ? 'Done' : 'Error'}
          </Text>
        </Box>
      </HStack>
    </Box>
  );
}

// ─── Compact display (existing) ───────────────────────────────────

export default function PublishAllDisplay({ toolCallTuple, showThinking }: DisplayProps) {
  const [, toolMessage] = toolCallTuple;

  const { success, message } = contentToDetails(toolMessage);

  if (!success) {
    return showThinking ? (
      <GridItem colSpan={12} my={1}>
        <HStack gap={1.5} px={2} py={1.5} bg="accent.danger/10" borderRadius="md" border="1px solid" borderColor="accent.danger/20">
          <Icon as={LuX} boxSize={3} color="accent.danger" flexShrink={0} />
          <Text fontSize="xs" color="accent.danger" fontFamily="mono">
            {message || 'Publish cancelled'}
          </Text>
        </HStack>
      </GridItem>
    ) : null;
  }

  const color = 'fg.muted';

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
        <Icon as={LuCheck} boxSize={3} color={color} flexShrink={0} />
        <Icon as={LuUpload} boxSize={3} color={color} flexShrink={0} />
        <Text fontSize="xs" color={color} fontFamily="mono">
          {message || 'Published successfully'}
        </Text>
      </HStack>
    </GridItem>
  );
}
