'use client';

// Sticky chat input region used by both legacy ChatInterface (chatSlice) and
// ChatV2Container (chatV2Slice). All state-shape differences live in the
// callers — this component takes flat primitive props.

import dynamic from 'next/dynamic';
import { Box, Grid, GridItem, HStack, Spinner, Text, Button, Icon } from '@chakra-ui/react';
import { LuPlus } from 'react-icons/lu';
import ThinkingIndicator from './ThinkingIndicator';
import type { Attachment, DatabaseWithSchema, SkillMention, SlashCommand } from '@/lib/types';

// Same dynamic import the legacy ChatInterface uses — pdfjs-dist needs to
// stay out of SSR.
// eslint-disable-next-line no-restricted-syntax
const ChatInput = dynamic(() => import('./ChatInput'), { ssr: false });

interface QueuedMessage {
  message: string;
}

export interface ChatInputBarProps {
  onSend: (message: string, attachments: Attachment[]) => void;
  onStop: () => void;
  onNewChat: () => void;
  isAgentRunning: boolean;
  isStreaming: boolean;
  isWaitingForUserInput: boolean;
  isPreparing?: boolean;
  isLoading?: boolean;
  tokenLimitExceeded?: boolean;
  queuedMessages?: QueuedMessage[];
  wasInterrupted?: boolean;
  allowChatQueue?: boolean;
  selectedDatabase?: string | null;
  onDatabaseChange: (name: string) => void;
  container?: 'page' | 'sidebar';
  isCompact: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  colSpan?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  colStart?: any;
  connectionsLoading?: boolean;
  contextsLoading?: boolean;
  selectedContextPath?: string | null;
  selectedVersion?: number;
  onContextChange?: (contextPath: string | null, version?: number) => void;
  whitelistedSchemas?: DatabaseWithSchema[];
  availableSkills?: SkillMention[];
  availableCommands?: SlashCommand[];
  onCommandExecute?: (command: SlashCommand) => void;
}

export default function ChatInputBar(props: ChatInputBarProps) {
  const {
    onSend,
    onStop,
    onNewChat,
    isAgentRunning,
    isStreaming,
    isWaitingForUserInput,
    isPreparing = false,
    isLoading = false,
    tokenLimitExceeded = false,
    queuedMessages = [],
    wasInterrupted = false,
    allowChatQueue = false,
    selectedDatabase,
    onDatabaseChange,
    container = 'page',
    isCompact,
    colSpan,
    colStart,
    connectionsLoading = false,
    contextsLoading = false,
    selectedContextPath,
    selectedVersion,
    onContextChange,
    whitelistedSchemas,
    availableSkills,
    availableCommands,
    onCommandExecute,
  } = props;

  const showLoadingBanner = connectionsLoading || contextsLoading;

  const prefillText =
    !isAgentRunning && !isStreaming && wasInterrupted && queuedMessages.length > 0
      ? queuedMessages.map((qm) => qm.message).join('\n')
      : undefined;

  return (
    <Box
      position="sticky"
      bottom={0}
      bg="bg.canvas"
      pt={3}
      pb={{ base: 1, md: 3 }}
      px={4}
      zIndex={10}
    >
      {showLoadingBanner && (
        <Grid templateColumns={{ base: 'repeat(12, 1fr)', md: 'repeat(12, 1fr)' }} gap={2} w="100%">
          <GridItem colSpan={colSpan} colStart={colStart}>
            <Box
              bg="bg.muted"
              borderColor="border.default"
              borderWidth="1px"
              borderRadius="md"
              px={3}
              py={2}
              mb={3}
            >
              <HStack gap={2}>
                <Spinner size="sm" colorPalette="gray" />
                <Text fontSize="sm" color="fg.muted">
                  Loading{' '}
                  {connectionsLoading && contextsLoading
                    ? 'connections and context'
                    : connectionsLoading
                      ? 'connections'
                      : 'context'}
                  ...
                </Text>
              </HStack>
            </Box>
          </GridItem>
        </Grid>
      )}

      {(isAgentRunning || isStreaming) && (
        <Grid templateColumns={{ base: 'repeat(12, 1fr)', md: 'repeat(12, 1fr)' }} gap={2} w="100%">
          <GridItem colSpan={colSpan} colStart={colStart}>
            <ThinkingIndicator
              waitingForInput={isWaitingForUserInput}
              onStop={onStop}
              queuedMessages={queuedMessages}
            />
          </GridItem>
        </Grid>
      )}

      {tokenLimitExceeded && !isAgentRunning && !isStreaming ? (
        <HStack
          justify="center"
          py={2}
          px={4}
          gap={3}
          borderTop="1px solid"
          borderColor="border.muted"
          fontFamily="mono"
        >
          <Text fontSize="xs">
            <Text as="span" fontWeight="semibold">
              Conversation too long.
            </Text>{' '}
            <Text as="span" color="fg.muted">
              Long conversations degrade agent performance. Please start a new chat.
            </Text>
          </Text>
          <Button
            size="xs"
            bg="accent.teal"
            color="white"
            fontFamily="mono"
            _hover={{ bg: 'accent.teal', opacity: 0.9 }}
            onClick={onNewChat}
            flexShrink={0}
          >
            <Icon as={LuPlus} boxSize={4} mr={1} />
            New Chat
          </Button>
        </HStack>
      ) : (
        <Box width="100%">
          <ChatInput
            onSend={onSend}
            onStop={onStop}
            isAgentRunning={isAgentRunning || isStreaming}
            allowChatQueue={allowChatQueue}
            isPreparing={isPreparing}
            disabled={isLoading}
            databaseName={selectedDatabase || ''}
            onDatabaseChange={onDatabaseChange}
            container={container}
            isCompact={isCompact}
            colSpan={colSpan}
            colStart={colStart}
            connectionsLoading={connectionsLoading}
            contextsLoading={contextsLoading}
            selectedContextPath={selectedContextPath}
            selectedVersion={selectedVersion}
            onContextChange={onContextChange}
            whitelistedSchemas={whitelistedSchemas}
            availableSkills={availableSkills}
            availableCommands={availableCommands}
            onCommandExecute={onCommandExecute}
            prefillText={prefillText}
          />
        </Box>
      )}
    </Box>
  );
}
