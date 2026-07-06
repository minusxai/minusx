'use client';

import type { ComponentProps } from 'react';
import { Box, Text, Icon, Button, Grid, GridItem } from '@chakra-ui/react';
import { LuPlus } from 'react-icons/lu';
import type { LoadError } from '@/lib/types/errors';
import { useAppDispatch } from '@/store/hooks';
import { retryConversationTurn } from '@/store/chatSlice';

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

  const message = isTerminalError
    ? "This conversation can't continue — it may have grown too long or hit a limit. Start a new chat to keep going."
    : (devMode ? (typeof error === 'string' ? error : error?.message || 'An error occurred') : 'An error occurred');

  return (
    <Grid templateColumns={{ base: 'repeat(12, 1fr)', md: 'repeat(12, 1fr)' }} gap={2} w="100%">
      <GridItem colSpan={colSpan} colStart={colStart}>
        <Box p={3} bg="accent.danger/10" border="1px solid" borderColor="accent.danger/20" borderRadius="md">
          <Text color="accent.danger" fontSize="sm" fontFamily="mono">{message}</Text>
          {isTerminalError ? (
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
