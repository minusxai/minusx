'use client';

import type { ComponentProps } from 'react';
import { Box, Text, Icon, Button, Grid, GridItem } from '@chakra-ui/react';
import { LuPlus, LuSettings } from 'react-icons/lu';
import type { LoadError } from '@/lib/types/errors';
import { useAppDispatch } from '@/store/hooks';
import { retryConversationTurn } from '@/store/chatSlice';
import { classifyTerminalReason, type TerminalErrorReason } from '@/lib/chat/error-retryability';

/**
 * What a terminal failure means and what actually fixes it. A new chat clears a context overflow
 * and does nothing for bad credentials — those re-fail in every conversation until an admin fixes
 * the provider, so they route to Settings → Models instead.
 */
const TERMINAL_COPY: Record<TerminalErrorReason, { message: string; action: 'new-chat' | 'models-settings' }> = {
  context_length: {
    message: "This conversation can't continue — it may have grown too long or hit a limit. Start a new chat to keep going.",
    action: 'new-chat',
  },
  auth: {
    message: "Couldn't authenticate with the configured AI model provider — its API key looks missing, wrong, or expired. Check it in Settings → Models.",
    action: 'models-settings',
  },
  permission: {
    message: 'The configured AI model provider rejected this request as not permitted — the key may not have access to this model. Check it in Settings → Models.',
    action: 'models-settings',
  },
  malformed: {
    message: "This conversation can't continue — the model provider rejected the request. Start a new chat to keep going.",
    action: 'new-chat',
  },
};

interface ChatErrorBannerProps {
  error: string | LoadError | null | undefined;
  isTerminalError: boolean;
  devMode: boolean;
  colSpan: ComponentProps<typeof GridItem>['colSpan'];
  colStart: ComponentProps<typeof GridItem>['colStart'];
  conversationID: number | undefined;
  handleNewChat: () => void;
}

// Error Display. Terminal errors (context-length, auth, malformed) can't be retried — an
// identical re-run re-fails — so we steer to a fresh chat instead of "Try again". Transient
// (and local/load) errors offer a clean replay of the failed turn (no "Continue" bubble).
export default function ChatErrorBanner({ error, isTerminalError, devMode, colSpan, colStart, conversationID, handleNewChat }: ChatErrorBannerProps) {
  const dispatch = useAppDispatch();

  // Terminal errors carry a reason (context length / auth / permission / malformed); the copy and
  // the offered action follow it, so the banner never blames conversation length for a bad key.
  const rawMessage = typeof error === 'string' ? error : error?.message;
  const terminal = isTerminalError ? TERMINAL_COPY[classifyTerminalReason(rawMessage) ?? 'context_length'] : null;
  const message = terminal
    ? terminal.message
    : (devMode ? (rawMessage || 'An error occurred') : 'An error occurred');

  return (
    <Grid templateColumns={{ base: 'repeat(12, 1fr)', md: 'repeat(12, 1fr)' }} gap={2} w="100%">
      <GridItem colSpan={colSpan} colStart={colStart}>
        <Box p={3} bg="accent.danger/10" border="1px solid" borderColor="accent.danger/20" borderRadius="md">
          <Text color="accent.danger" fontSize="sm" fontFamily="mono">{message}</Text>
          {terminal?.action === 'models-settings' ? (
            <Button mt={2} size="xs" variant="outline" colorPalette="red" aria-label="Open model settings"
              onClick={() => { window.location.href = '/settings?tab=models'; }}>
              <Icon as={LuSettings} boxSize={4} mr={1} />Open model settings
            </Button>
          ) : terminal ? (
            <Button mt={2} size="xs" variant="outline" colorPalette="red" aria-label="Start a new chat"
              onClick={handleNewChat}>
              <Icon as={LuPlus} boxSize={4} mr={1} />Start a new chat
            </Button>
          ) : conversationID ? (
            <Button mt={2} size="xs" variant="outline" colorPalette="red" aria-label="Try again"
              onClick={() => dispatch(retryConversationTurn({ conversationID }))}>
              Try again
            </Button>
          ) : null}
        </Box>
      </GridItem>
    </Grid>
  );
}
