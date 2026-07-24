'use client';

import { useMemo } from 'react';
import { Box, HStack, Text, VStack } from '@chakra-ui/react';
import { useAppSelector } from '@/store/hooks';
import { selectConversation } from '@/store/chatSlice';
import UserInputComponent from './UserInputComponent';

const CLARIFY_TOOLS: ReadonlySet<string> = new Set(['Clarify', 'ClarifyFrontend']);

interface PendingClarifyPanelProps {
  conversationID: number;
  /** Clarify tool_call_ids belonging to this turn, in turn order */
  toolCallIds: string[];
}

/**
 * Prominent "agent is waiting on you" block rendered OUTSIDE the task/working
 * area. Stacks EVERY unresolved clarification at once — the detail carousel
 * shows one card at a time, which buried all but the first when the agent
 * asked several clarifications together.
 */
export default function PendingClarifyPanel({ conversationID, toolCallIds }: PendingClarifyPanelProps) {
  const conversation = useAppSelector(state => selectConversation(state, conversationID));

  const pendingClarifies = useMemo(() => {
    if (!conversation) return [];
    const byId = new Map(conversation.pending_tool_calls.map(p => [p.toolCall.id, p] as const));
    return toolCallIds
      .map(id => byId.get(id))
      .filter((p): p is NonNullable<typeof p> =>
        !!p
        && CLARIFY_TOOLS.has(p.toolCall.function?.name || '')
        && (p.userInputs?.some(ui => ui.result === undefined) ?? false));
  }, [conversation, toolCallIds]);

  if (pendingClarifies.length === 0) return null;

  return (
    <Box
      aria-label="Waiting for your input"
      role="region"
      my={2}
      p={3}
      border="1px solid"
      borderColor="border.default"
      borderRadius="lg"
      bg="bg.surface"
    >
      <VStack gap={2} align="stretch">
        <HStack gap={2}>
          <Box w="7px" h="7px" borderRadius="full" bg="accent.teal" flexShrink={0} />
          <Text
            fontSize="2xs"
            fontFamily="mono"
            fontWeight="600"
            textTransform="uppercase"
            letterSpacing="0.05em"
            color="accent.teal"
          >
            Waiting for your input
            {pendingClarifies.length > 1 ? ` (${pendingClarifies.length} questions)` : ''}
          </Text>
        </HStack>

        {pendingClarifies.map(pendingTool => {
          const rawArgs = pendingTool.toolCall.function?.arguments;
          let toolArgs: Record<string, any> | undefined;
          try {
            toolArgs = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;
          } catch { toolArgs = undefined; }

          return pendingTool.userInputs!
            .filter(ui => ui.result === undefined)
            .map(userInput => (
              <UserInputComponent
                key={userInput.id}
                conversationID={conversationID}
                tool_call_id={pendingTool.toolCall.id}
                userInput={userInput}
                toolName={pendingTool.toolCall.function?.name}
                toolArgs={toolArgs}
              />
            ));
        })}
      </VStack>
    </Box>
  );
}
