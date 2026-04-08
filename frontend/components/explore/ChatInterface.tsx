'use client';

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from '@/lib/navigation/use-navigation';
import { Box, VStack, HStack, Text, Icon, Button, Spinner, Grid, GridItem } from '@chakra-ui/react';
import { LuPlus, LuChevronDown, LuRefreshCw, LuSparkles, LuPin, LuShare2, LuExpand, LuTerminal, LuMessageSquare, LuSlack } from 'react-icons/lu';
import type { LoadError } from '@/lib/types/errors';
import type { Attachment } from '@/lib/types';
import { AppState } from '@/lib/appState';
import dynamic from 'next/dynamic';
import ThinkingIndicator from './ThinkingIndicator';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { createConversation, sendMessage, updateAgentArgs, interruptChat, selectOptionalConversation, setActiveConversation, selectActiveTempConversation, generateVirtualConversationId } from '@/store/chatSlice';
import { useConversation } from '@/lib/hooks/useConversation';
import { useContext } from '@/lib/hooks/useContext';
import { useConfigs } from '@/lib/hooks/useConfigs';
import { Tooltip } from '@/components/ui/tooltip';
import { toaster } from '@/components/ui/toaster';
import { clearChatAttachments } from '@/store/uiSlice';
import { generateImageFromFile } from '@/lib/chart/file-image-client';
import { useScreenshot } from '@/lib/hooks/useScreenshot';
import ExampleQuestions from './message/ExampleQuestions';
import FileNotFound from '../FileNotFound';
import { deduplicateMessages } from './message/messageHelpers';
import SimpleChatMessage from './SimpleChatMessage';
import { selectDatabase } from '@/lib/utils/database-selector';
import { preserveParams } from '@/lib/navigation/url-utils';
import { selectEffectiveUser } from '@/store/authSlice';
import { isAdmin } from '@/lib/auth/role-helpers';
import ToolCallListModal from './ToolCallListModal';
import { useNavigationGuard } from '@/lib/navigation/NavigationGuardProvider';

// next/dynamic with ssr:false prevents pdfjs-dist (browser-only, uses DOMMatrix at module init)
// from being evaluated during SSR prerendering. This is an intentional SSR boundary, not a
// circular dependency workaround.
// eslint-disable-next-line no-restricted-syntax
const ChatInput = dynamic(() => import('./ChatInput'), { ssr: false });

/**
 * Build a file image attachment from the current page's app state.
 *
 * Captures the rendered [data-file-id] element via DOM snapshot — exact visual
 * match to what the user sees (chart, table, pivot, or full dashboard grid).
 *
 * Returns [] for explore/folder pages that have no file to capture.
 */
async function buildFileImageAttachment(
  appState: AppState | null | undefined,
  captureFileView: (id: number) => Promise<Blob>,
): Promise<import('@/lib/types').Attachment[]> {
  if (appState?.type !== 'file') return [];

  const fileId = appState.state.fileState.id;
  if (!fileId) return [];

  try {
    const url = await generateImageFromFile(fileId, captureFileView);
    if (!url) return [];
    const att: import('@/lib/types').Attachment = { type: 'image', name: 'screenshot.png', content: url, metadata: {} };
    return [att];
  } catch {
    return []; // Never block sending on capture failure
  }
}

interface ChatInterfaceProps {
  conversationId?: number;  // Optional file ID: if provided, load existing conversation
  contextPath: string;  // Context path (required) - load context
  contextVersion?: number;  // Optional version number (defaults to user's published)
  databaseName?: string | null;  // Optional - pre-select database
  appState?: AppState | null;  // Current page state (e.g., QuestionAppState, DashboardAppState)
  container?: 'page' | 'sidebar';  // Layout mode: 'page' for full explore page, 'sidebar' for right sidebar
  onContextChange?: (contextPath: string | null, version?: number) => void;  // Context change callback (for parent coordination)
  onDatabaseChange?: (name: string) => void;  // Database change callback (for parent coordination)
  /** Read-only mode: hides input box and action buttons. For inline agent activity feeds. */
  readOnly?: boolean;
}

export default function ChatInterface({
  conversationId: providedConversationId,
  contextPath,
  contextVersion,
  databaseName: initialDatabaseName,
  appState,
  container = 'page',
  onContextChange,
  onDatabaseChange,
  readOnly = false,
}: ChatInterfaceProps) {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const isExplorePage = !appState || (appState.type !== 'file' && appState.type !== 'folder');

  // Load context using useContext hook (reuse existing hook)
  const contextInfo = useContext(contextPath, contextVersion);
  const { databases, documentation: markdown, contextLoading } = contextInfo;
  const { navigate } = useNavigationGuard();

  // Get config for location
  const { config } = useConfigs();

  // Read connection_id stored in the Redux conversation (available synchronously on remount)
  const storedConnectionId = useAppSelector(state =>
    providedConversationId
      ? (state.chat.conversations[providedConversationId]?.agent_args?.connection_id ?? null)
      : null
  );

  // Internal database selection state — prefer stored connection from conversation over prop
  const [selectedDatabase, setSelectedDatabase] = useState<string | null>(
    storedConnectionId || initialDatabaseName || null
  );

  // When navigating to a different conversation, sync selectedDatabase to that conversation's
  // stored connection_id. Runs on storedConnectionId changes (i.e. when providedConversationId
  // changes and the conversation is already in Redux, or when it loads from DB).
  useEffect(() => {
    if (storedConnectionId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedDatabase(storedConnectionId);
    }
  }, [storedConnectionId]);

  // Auto-select database when context loads (if none selected) — intentional setState in effect
  useEffect(() => {
    if (!selectedDatabase && databases.length > 0) {
      // Prefer databases with schemas loaded for auto-select so the user starts with a working connection.
      const dbsWithSchemas = databases.filter(db => db.schemas.length > 0);
      const autoSelected = selectDatabase(dbsWithSchemas.length > 0 ? dbsWithSchemas : databases, null);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedDatabase(autoSelected);
    }
  }, [databases, selectedDatabase]);

  // Derive current database from context databases
  const database = useMemo(() =>
    databases.find(d => d.databaseName === selectedDatabase) || null,
    [databases, selectedDatabase]
  );

  // Internal database change handler
  const handleDatabaseChange = useCallback((name: string) => {
    setSelectedDatabase(name);
    onDatabaseChange?.(name);
  }, [onDatabaseChange]);

  // Derive loading states from context
  const connectionsLoading = contextLoading;
  const contextsLoading = contextLoading;

  // Load conversation from database if existing conversation (from URL)
  const { conversation: loadedConversation, isLoading, error: loadError } = useConversation(providedConversationId);

  const [showThinking, setShowThinking] = useState<boolean>(false)
  const [showToolInspector, setShowToolInspector] = useState(false)
  const [continueChatConfirmed, setContinueChatConfirmed] = useState(false)

  const effectiveUser = useAppSelector(selectEffectiveUser);
  const userIsAdmin = effectiveUser?.role ? isAdmin(effectiveUser.role) : false;
  const { captureFileView } = useScreenshot();

  // Case 1: existing conversation — follow fork chain from loaded conversation
  const forkFollowedConversation = useAppSelector(state => {
    if (!providedConversationId || !loadedConversation) return null;
    let conv = loadedConversation;
    while (conv?.forkedConversationID) {
      conv = selectOptionalConversation(state, conv.forkedConversationID) || conv;
    }
    return conv;
  });

  // Case 2: new conversation — memoized selector avoids Object.keys scan on every Redux change
  const activeTempConversation = useAppSelector(selectActiveTempConversation);

  const conversation = forkFollowedConversation ?? activeTempConversation;

  const isNewConversation = !providedConversationId;
  const conversationID = conversation?.conversationID;

  // Determine if this conversation originated from a file page or Slack
  const parentPageInfo = useMemo(() => {
    if (!conversation?.agent_args?.app_state) return null;
    const appStateData = conversation.agent_args.app_state;
    if (appStateData.type === 'file' && appStateData.state?.fileState) {
      const { id, name, type } = appStateData.state.fileState;
      return { id: id as number, name: name as string, type: type as string };
    }
    if (appStateData.type === 'slack') {
      return { id: 0, name: 'Slack', type: 'slack' };
    }
    return null;
  }, [conversation?.agent_args?.app_state]);

  // On the explore page, if viewing a conversation that started on a file page or Slack, require confirmation to continue
  const needsContinueConfirmation = isExplorePage && !isNewConversation && !!parentPageInfo && !continueChatConfirmed;

  // Reset confirmation when navigating to a different conversation
  const prevConversationIdRef = useRef(providedConversationId);
  useEffect(() => {
    if (prevConversationIdRef.current !== providedConversationId) {
      prevConversationIdRef.current = providedConversationId;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setContinueChatConfirmed(false);
    }
  }, [providedConversationId]);

  // Stable callback — inline arrow would defeat React.memo on SimpleChatMessage (re-renders all messages each streaming chunk)
  const toggleShowThinking = useCallback(() => setShowThinking(prev => !prev), []);

  // Single unified source for all messages (completed, streaming, pending)
  const allMessages = useMemo(() => {
    if (!conversation) return [];
    return deduplicateMessages(conversation)
  }, [conversation?.messages, conversation?.streamedCompletedToolCalls, conversation?.pending_tool_calls]);

  // Extract streaming info (thinking text + tool calls) — memoized to avoid JSON.parse loop on every render
  const streamingInfo = useMemo(() => {
    if (!conversation?.streamedCompletedToolCalls) return { thinkingText: null, toolCalls: [] };

    // Native thinking streamed in real-time (takes priority over legacy XML parsing)
    let thinkingText: string | null = null;
    if (conversation.streamedThinking) {
      const lines = conversation.streamedThinking.split('\n').filter(line => line.trim());
      thinkingText = lines.length > 2 ? lines.slice(0, 2).join('\n') + '...' : lines.join('\n');
    }

    const toolCalls: string[] = [];
    for (let i = conversation.streamedCompletedToolCalls.length - 1; i >= 0; i--) {
      const msg = conversation.streamedCompletedToolCalls[i];
      const toolName = msg.function?.name;
      if (toolName && toolName !== 'TalkToUser') {
        toolCalls.unshift(toolName);
      }
    }

    return { thinkingText, toolCalls };
  }, [conversation?.streamedCompletedToolCalls, conversation?.streamedThinking]);

//   console.log('allmessages', allMessages);

  // Check if this conversation has an ongoing agent
  const isAgentRunning = conversation?.executionState === 'WAITING' || conversation?.executionState === 'EXECUTING';
  const isStreaming = conversation?.executionState === 'STREAMING';

  // Check if waiting for user input (any pending tool has userInputs without result)
  const isWaitingForUserInput = useMemo(() => {
    if (!conversation?.pending_tool_calls) return false;
    return conversation.pending_tool_calls.some(tc =>
      tc.userInputs?.some(ui => ui.result === undefined)
    );
  }, [conversation?.pending_tool_calls]);

  // Get error from conversation or use local state for client-side errors
  const [localError, setLocalError] = useState<LoadError | null>(null);
  // Only show runtime/execution errors here (not loadError - that's shown in dedicated section above)
  const error = conversation?.error || localError;
  const [showScrollButton, setShowScrollButton] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // Track container width for responsive layout
  useEffect(() => {
    if (!scrollContainerRef.current) return;

    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });

    resizeObserver.observe(scrollContainerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Compute layout based on container width and mode
//   console.log('Container width:', containerWidth, 'Container:', container);
  const isCompact = container === 'sidebar' || (containerWidth > 0 && containerWidth < 900);
  const colSpan = isCompact ? 12 : { base: 12, md: 8, lg: 6 };
  const colStart = isCompact ? 1 : { base: 1, md: 3, lg: 4 };

  // Clear errors when navigating between conversations — intentional setState in effect
  const prevProvidedIdRef = useRef(providedConversationId);
  useEffect(() => {
    const prevId = prevProvidedIdRef.current;
    prevProvidedIdRef.current = providedConversationId;

    // Clear errors when going from one conversation to another
    if (prevId !== providedConversationId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLocalError(null);
    }
  }, [providedConversationId]);

  // Note: We don't abort requests on unmount - they complete in background and update Redux
  // This allows navigation while agent is thinking without cancelling the request
  // Only the explicit Stop button aborts requests

  // Check if user is at the bottom of the scroll container
  const checkScrollPosition = useCallback(() => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setShowScrollButton(!isAtBottom && allMessages.length > 0);
  }, [allMessages.length]);

  // Scroll to bottom smoothly
  const scrollToBottom = () => {
    if (!scrollContainerRef.current) return;
    scrollContainerRef.current.scrollTo({
      top: scrollContainerRef.current.scrollHeight,
      behavior: 'smooth'
    });
  };

  // Track last user message count to detect new messages
  const userMessageCount = useMemo(() => {
    return allMessages.filter(m => m.role === 'user').length;
  }, [allMessages]);

  const prevUserMessageCountRef = useRef(0);

  // Auto-scroll only once when a new user message is added — intentional setState in effect
  useEffect(() => {
    if (userMessageCount > prevUserMessageCountRef.current) {
      // New user message detected - scroll to bottom once
      scrollToBottom();
      prevUserMessageCountRef.current = userMessageCount;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    checkScrollPosition();
  }, [userMessageCount]);

  const handleNewChat = () => {
    setLocalError(null);
    dispatch(clearChatAttachments());

    // Stop agent if running
    if (conversationID && isAgentRunning) {
      dispatch(interruptChat({ conversationID }));
    }

    // Deactivate all conversations (saves current to history)
    dispatch(setActiveConversation(null));

    // For explore page: navigate to /explore to show empty state
    if (container === 'page') {
      router.push('/explore');
    }
  };

  const handleStopAgent = () => {
    if (conversationID) {
      dispatch(interruptChat({ conversationID }));
    }
  };

  const handleSendMessage = async (userInput: string, attachments: Attachment[] = []) => {
    if (!userInput.trim()) return;

    // Block sending if connections or contexts are still loading
    if (connectionsLoading || contextsLoading) {
      setLocalError({
        message: 'Still loading connections and context...',
        code: 'UNKNOWN'
      });
      return;
    }

    // REMOVED: No longer block chat without database
    // Users can now chat even without database connections
    // if (!database) {
    //   setLocalError({
    //     message: 'No database connection available',
    //     code: 'UNKNOWN'
    //   });
    //   return;
    // }

    setLocalError(null);

    // Simplify schema for agent
    const simplifiedSchema = database?.schemas?.map(s => ({
      schema: s.schema,
      tables: s.tables.map(t => t.table)
    })) || [];

    // Capture the current file view (chart, table, pivot, or dashboard) as an image.
    // Uploaded to S3 and sent as image_url vision block to Claude.
    const fileAttachments = await buildFileImageAttachment(appState, captureFileView);
    const allAttachments = [...attachments, ...fileAttachments];

    // For new conversations (no conversationID yet)
    if (isNewConversation && !conversationID) {
      // Create conversation with temp ID (negative) and initial message
      dispatch(createConversation({
        conversationID: generateVirtualConversationId(),
        agent: 'AnalystAgent',
        agent_args: {
          connection_id: selectedDatabase || null,
          context_path: contextPath || null,
          context_version: contextVersion ?? null,
          schema: simplifiedSchema,
          context: markdown || '',
          app_state: appState,
          city: config.city,
          agent_name: config.branding.agentName || 'MinusX',
          ...(allAttachments.length > 0 ? { attachments: allAttachments } : {}),
        },
        message: userInput,
        attachments: attachments.length > 0 ? attachments : undefined,
      }));

      // Navigation will happen via useEffect when conversation forks to real ID
      return;
    }

    // Existing conversation - normal flow
    if (conversationID) {
      // Update agent_args with fresh appState before sending message
      dispatch(updateAgentArgs({
        conversationID,
        agent_args: {
          connection_id: database?.databaseName || null,
          context_path: contextPath || null,
          context_version: contextVersion ?? null,
          schema: simplifiedSchema,
          context: markdown || '',
          app_state: appState,
          city: config.city,
          agent_name: config.branding.agentName || 'MinusX',
          ...(allAttachments.length > 0 ? { attachments: allAttachments } : {}),
        }
      }));

      // Send message
      dispatch(sendMessage({
        conversationID,
        message: userInput,
        attachments: attachments.length > 0 ? attachments : undefined,
      }));
    }
  };

  // Navigate when conversation forks (new conversation gets real ID, or conflict resolution)
  useEffect(() => {
    if (!conversation || container !== 'page') return;

    // Don't navigate if conversation is inactive (was cleared via "New Chat")
    if (!conversation.active) return;

    // For new conversations: navigate when we get a real ID (positive)
    if (isNewConversation && conversationID && conversationID > 0) {
      console.log("[ChatInterface] New conversation created with ID:", conversationID);
      router.push(`/explore/${conversationID}`);
      return;
    }

    // For existing conversations: navigate if URL doesn't match current conversation ID
    if (!isNewConversation && conversationID && conversationID !== providedConversationId) {
      console.log("[ChatInterface] Conversation forked to:", conversationID);
      router.push(`/explore/${conversationID}`);
    }
  }, [conversationID, isNewConversation, providedConversationId, container, router, conversation]);


  // Handler for setting conversation as active
  const handleSetAsActive = () => {
    if (conversationID) {
      dispatch(setActiveConversation(conversationID));
    }
  };

  // Determine if current conversation is active
  const isConversationActive = conversation?.active === true;

  // "Set as Active" button (only shown for non-active conversations)
  const setAsActiveButton = providedConversationId && !isConversationActive && conversation && (
    <Tooltip content="Make this conversation active in sidechat" positioning={{ placement: 'bottom' }}>
      <Button
        onClick={handleSetAsActive}
        size="xs"
        variant="outline"
        borderColor="border.emphasized"
        color="fg.muted"
        _hover={{ bg: 'bg.muted', borderColor: 'accent.teal', color: 'accent.teal' }}
      >
        <Icon as={LuPin} boxSize={4} mr={1} />
        Set as Active
      </Button>
    </Tooltip>
  );

  // New Chat button component (reused in both banner and standalone)
  const newChatButton = allMessages.length > 0 && (
    <Button
      onClick={handleNewChat}
      size="xs"
      bg="accent.teal"
      color="white"
      _hover={{ bg: 'accent.teal', opacity: 0.9 }}
    >
      {isExplorePage ? (
        <><Icon as={LuPlus} boxSize={4} mr={1} />New Chat</>
      ) : (
        <Tooltip content="Clear Chat" positioning={{ placement: 'left' }}><LuRefreshCw /></Tooltip>
      )}
    </Button>
  );

  return (
    <VStack gap={0} align="stretch" height="100%" overflow="hidden">
      {/* Action Buttons Bar (only show when there are messages, hidden in readOnly) */}
      {!readOnly && allMessages.length > 0 && (
        <Box
          position="sticky"
          top={0}
          bg="bg.canvas"
          pt={3}
          pb={2}
          zIndex={10}
          display="flex"
          justifyContent="center"
        >
          <Box width="100%" display="flex" justifyContent="space-between" alignItems="center" px={5}>
            <HStack gap={2}>
            {container === 'sidebar' && (
              <Tooltip content="Open in explore" positioning={{ placement: 'bottom' }}>
                <Button
                  onClick={() => {
                    const path = conversationID && conversationID > 0
                      ? `/explore/${conversationID}`
                      : '/explore';
                    navigate(preserveParams(path));
                  }}
                  size="xs"
                  variant="outline"
                  borderColor="border.muted"
                  color="fg.subtle"
                  _hover={{ color: 'accent.teal', borderColor: 'accent.teal' }}
                >
                  <LuExpand />
                </Button>
              </Tooltip>
            )}
            {userIsAdmin && allMessages.length > 0 && (
              <Tooltip content="Inspect tool calls" positioning={{ placement: 'bottom' }}>
                <Button
                  onClick={() => setShowToolInspector(true)}
                  size="xs"
                  variant="outline"
                  borderColor="border.muted"
                  color="fg.subtle"
                  _hover={{ color: 'accent.teal', borderColor: 'accent.teal' }}
                >
                  <LuTerminal />
                </Button>
              </Tooltip>
            )}
            </HStack>
            <HStack gap={2}>
              {setAsActiveButton}
              {newChatButton}
              <Tooltip content="Copy link" positioning={{ placement: 'bottom' }}>
                <Button
                  onClick={() => {
                    const path = conversationID && conversationID > 0
                      ? `/explore/${conversationID}`
                      : window.location.pathname + window.location.search;
                    const url = window.location.origin + preserveParams(path);
                    navigator.clipboard.writeText(url);
                    toaster.create({ title: 'Link copied to clipboard', type: 'success' });
                  }}
                  size="xs"
                  bg="accent.teal"
                  color="white"
                  _hover={{ bg: 'accent.teal', opacity: 0.9 }}
                >
                  <LuShare2 />
                </Button>
              </Tooltip>
            </HStack>
          </Box>
        </Box>
      )}

      <Box position="relative" flex="1" overflow="hidden">
        <Box
          ref={scrollContainerRef}
          borderRadius="md"
          bg="bg.canvas"
          height="100%"
          overflowY="auto"
          display="flex"
          flexDirection="column"
          justifyContent={allMessages.length === 0 ? "center" : "flex-start"}
          onScroll={checkScrollPosition}
        >
          <Box width="100%" p={4}>
            <VStack gap={4} align="stretch">
          {isLoading ? (
            // Loading spinner while loading conversation from database
            <VStack gap={6} align="center" justify="center" flex="1" py={12}>
              <Spinner size="xl" color="accent.teal" />
              <Text color="fg.muted" fontSize="sm" fontFamily="mono">
                Loading conversation...
              </Text>
            </VStack>
          ) : loadError ? (
            <FileNotFound/>
          ) : !readOnly && allMessages.length === 0 ? (
            <ExampleQuestions
              onPromptClick={handleSendMessage}
              container={container}
              colSpan={colSpan}
              colStart={colStart}
            />
          ) : (
            <Grid templateColumns={{ base: 'repeat(12, 1fr)', md: 'repeat(12, 1fr)' }}
                gap={2} w="100%">
            <GridItem colSpan={colSpan} colStart={colStart}>

              {
                allMessages.map((msg, idx) => {
                    return <SimpleChatMessage
                        key={`${msg.role}-${idx}-${(msg as any).tool_call_id || ''}`}
                        message={msg}
                        databaseName={selectedDatabase || ''}
                        isCompact={isCompact}
                        showThinking={showThinking}
                        toggleShowThinking={toggleShowThinking}
                        markdownContext={container === 'sidebar' ? 'sidebar' : 'mainpage'}
                    />
                })
              }

              {/* Streaming info: show thinking text and tool calls while streaming */}
              {isStreaming && (() => {
                const { thinkingText, toolCalls } = streamingInfo;
                if (thinkingText || toolCalls.length > 0) {
                  return (
                    <Box p={3} bg="bg.muted" borderRadius="md" my={2}>
                      <VStack gap={2} justify="space-between" align="flex-start">
                        <HStack gap={2} flex="1">
                          <Icon as={LuSparkles} boxSize={4} color="accent.teal" flexShrink={0} />
                          <Text
                            color="fg.muted"
                            fontSize="sm"
                            fontFamily="mono"
                            fontStyle={thinkingText ? "italic" : "normal"}
                          >
                            {thinkingText || `Running: ${toolCalls.join(', ')}`}
                          </Text>
                        </HStack>
                        {thinkingText && toolCalls.length > 0 && (
                        <HStack justify={'flex-end'}>
                          <Text
                            color="fg.subtle"
                            fontSize="xs"
                            fontFamily="mono"
                            flexShrink={0}
                          >
                            {toolCalls.length} tool{toolCalls.length !== 1 ? 's' : ''}
                          </Text>
                        </HStack>
                        )}
                      </VStack>
                    </Box>
                  );
                }
                return null;
              })()}

              {/* Note: Pending user inputs are rendered via ToolCallDisplay in the message stream */}
            </GridItem></Grid>
          )}

          {/* Error Display */}
          {error && (() => {
            return (
              <Grid templateColumns={{ base: 'repeat(12, 1fr)', md: 'repeat(12, 1fr)' }}
                      gap={2}
                      w="100%"
                  >
              <GridItem colSpan={colSpan} colStart={colStart}>
                  <Box
                p={3}
                bg="accent.danger/10"
                borderLeft="3px solid"
                borderColor="accent.danger"
                borderRadius="md"
              >
                  <Text color="accent.danger" fontSize="sm" fontFamily="mono">
                    {typeof error === 'string' ? error : error?.message || 'An error occurred'}
                  </Text>
                  </Box>
              </GridItem>

              </Grid>
            );
          })()}

          {/* Thinking indicator - shown whenever agent is running */}
          {(isAgentRunning || isStreaming) && (
            <Grid templateColumns={{ base: 'repeat(12, 1fr)', md: 'repeat(12, 1fr)' }}
                      gap={2}
                      w="100%"
                  >
              <GridItem colSpan={colSpan} colStart={colStart}>
                  <ThinkingIndicator waitingForInput={isWaitingForUserInput} />
              </GridItem>
            </Grid>
          )}
            </VStack>
          </Box>
        </Box>

        {/* Scroll to Bottom Button */}
        {showScrollButton && (
          <Box
            position="absolute"
            bottom={4}
            left="50%"
            transform="translateX(-50%)"
            zIndex={20}
          >
            <Button
              onClick={scrollToBottom}
              size="sm"
              bg="accent.teal"
              color="white"
              borderRadius="full"
              p={2}
              minW="auto"
              h="auto"
              boxShadow="0 4px 12px rgba(0, 0, 0, 0.15)"
              _hover={{
                bg: 'accent.teal',
                opacity: 0.9,
                transform: 'scale(1.05)'
              }}
              transition="all 0.2s"
            >
              <Icon as={LuChevronDown} boxSize={5} />
            </Button>
          </Box>
        )}
      </Box>

      {/* Admin tool call inspector */}
      {userIsAdmin && showToolInspector && (
        <ToolCallListModal
          messages={allMessages}
          isOpen={showToolInspector}
          onClose={() => setShowToolInspector(false)}
        />
      )}

      {/* Continue chat confirmation banner for conversations from other pages */}
      {needsContinueConfirmation && parentPageInfo && (
        <Box
          position="sticky"
          bottom={0}
          bg="bg.canvas"
          pt={3}
          pb={{ base: 1, md: 3 }}
          px={4}
          zIndex={10}
        >
          <Grid templateColumns={{ base: 'repeat(12, 1fr)', md: 'repeat(12, 1fr)' }} gap={2} w="100%">
            <GridItem colSpan={colSpan} colStart={colStart}>
              <Box
                bg="bg.muted"
                borderWidth="1px"
                borderColor="border.default"
                borderRadius="lg"
                px={4}
                py={3}
              >
                <VStack align="center" gap={2}>
                  <VStack align="center" gap={0.5}>
                    <Text fontSize="sm" color="fg.default" fontFamily="mono" fontWeight="500">
                      This conversation started on{' '}
                      {parentPageInfo.type === 'slack' ? (
                        <Text as="span" color="accent.teal">Slack</Text>
                      ) : parentPageInfo.id > 0 ? (
                        <Text
                          as="span"
                          color="accent.teal"
                          cursor="pointer"
                          _hover={{ textDecoration: 'underline' }}
                          onClick={() => navigate(`/f/${parentPageInfo.id}`)}
                        >
                          {parentPageInfo.name}
                        </Text>
                      ) : (
                        <>a{' '}
                          <Text
                            as="span"
                            color="accent.teal"
                            cursor="pointer"
                            _hover={{ textDecoration: 'underline' }}
                            onClick={() => navigate(`/new/${parentPageInfo.type}`)}
                          >
                            new {parentPageInfo.type} page
                          </Text>
                        </>
                      )}
                    </Text>
                  </VStack>
                  <Button
                    size="sm"
                    bg="accent.teal"
                    color="white"
                    _hover={{ opacity: 0.9 }}
                    onClick={() => setContinueChatConfirmed(true)}
                  >
                    <Icon as={LuMessageSquare} boxSize={4} mr={1} />
                    Continue chat here
                  </Button>
                </VStack>
              </Box>
            </GridItem>
          </Grid>
        </Box>
      )}

      {/* Input - Sticky at bottom (hidden in readOnly mode) */}
      {!readOnly && !loadError && !needsContinueConfirmation && (
        <Box
          position="sticky"
          bottom={0}
          bg="bg.canvas"
          pt={3}
          pb={{ base: 1, md: 3 }}
          px={4}
          zIndex={10}
        >
          {/* Loading Status Banner */}
          {(connectionsLoading || contextsLoading) && (
            <Grid templateColumns={{ base: 'repeat(12, 1fr)', md: 'repeat(12, 1fr)' }}
                gap={2}
                w="100%"
            >
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
                  Loading {
                    connectionsLoading && contextsLoading ? 'connections and context' :
                    connectionsLoading ? 'connections' :
                    'context'
                  }...
                </Text>
              </HStack>
            </Box>
            </GridItem>
            </Grid>
          )}

          <Box width="100%">
            <ChatInput
              onSend={handleSendMessage}
              onStop={handleStopAgent}
              isAgentRunning={isAgentRunning || isStreaming}
              disabled={isLoading}
              databaseName={selectedDatabase || ''}
              onDatabaseChange={handleDatabaseChange}
              container={container}
              isCompact={isCompact}
              connectionsLoading={connectionsLoading}
              contextsLoading={contextsLoading}
              selectedContextPath={contextPath}
              selectedVersion={contextVersion}
              onContextChange={onContextChange}
              whitelistedSchemas={databases}
            />
          </Box>
        </Box>
      )}
    </VStack>
  );
}
