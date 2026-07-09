'use client';

import { Box, HStack, Text, Icon, VStack } from '@chakra-ui/react';
import { LuUnplug } from 'react-icons/lu';
import { shallowEqual } from 'react-redux';
import { useAppSelector } from '@/store/hooks';
import { selectRemoteSessionPrompts } from '@/store/chatSlice';
import UserInputComponent from '@/components/explore/UserInputComponent';

/**
 * Global approval host for Remote Agent Sessions (REMOTE_AGENT_SESSIONS.md §9).
 *
 * A remote session's user-approval prompts (Navigate confirmations, the PublishAll review) are
 * normally delivered inline in the session conversation's chat view — but the remote agent
 * routinely navigates the user AWAY from that view (to the file it is editing), where a different
 * conversation (or none) is shown and the inline prompt never mounts. Browser-verified failure:
 * the agent's PublishAll sat pending invisibly while the user stared at the story page.
 *
 * This host renders those prompts as a floating card stack on EVERY app page while a remote
 * session is active, so approvals reach the user wherever they are. It is the SOLE renderer for
 * remote-session prompts — the inline chat displays suppress theirs when `remoteSession.active`
 * (a publish prompt auto-opens a modal; two mounts would stack two modals).
 */
export default function RemoteSessionPrompts() {
  const prompts = useAppSelector(selectRemoteSessionPrompts, shallowEqual);

  if (prompts.length === 0) return null;

  return (
    <Box
      aria-label="Remote session prompts"
      position="fixed"
      bottom={{ base: '88px', md: 6 }}
      right={6}
      zIndex={1500}
      maxW="380px"
      w="full"
    >
      <VStack gap={2} align="stretch">
        {prompts.map(({ conversationID, toolCall, userInput }) => (
          <Box
            key={userInput.id}
            aria-label={`Remote prompt: ${userInput.props?.title ?? toolCall.function?.name ?? 'approval'}`}
            bg="bg.surface"
            border="1px solid"
            borderColor="accent.teal"
            borderRadius="lg"
            shadow="lg"
            p={2}
          >
            <HStack gap={1.5} px={1} pb={1}>
              <Icon as={LuUnplug} boxSize={3.5} color="accent.teal" />
              <Text fontSize="2xs" fontFamily="mono" color="fg.muted" textTransform="uppercase" letterSpacing="wider">
                Remote agent needs your approval
              </Text>
            </HStack>
            <UserInputComponent
              conversationID={conversationID}
              tool_call_id={toolCall.id}
              userInput={userInput}
              toolName={toolCall.function?.name}
              toolArgs={toolCall.function?.arguments as Record<string, unknown> | undefined}
            />
          </Box>
        ))}
      </VStack>
    </Box>
  );
}
