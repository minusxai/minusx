'use client';

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from '@/lib/navigation/use-navigation';
import { Box, VStack, HStack, Text, Icon, Button, Spinner, Grid, GridItem } from '@chakra-ui/react';
import { LuPlus, LuChevronDown, LuChevronRight, LuRefreshCw, LuPin, LuShare2, LuExpand, LuTerminal, LuMessageSquare } from 'react-icons/lu';
import type { LoadError } from '@/lib/types/errors';
import type { Attachment } from '@/lib/types';
import { AppState } from '@/lib/appState';
import dynamic from 'next/dynamic';
import ThinkingIndicator from './ThinkingIndicator';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { createConversation, sendMessage, queueMessage, clearQueuedMessages, updateAgentArgs, interruptChat, selectOptionalConversation, setActiveConversation, selectActiveConversation, type DebugMessage } from '@/store/chatSlice';
import { useConversation } from '@/lib/hooks/useConversation';
import { useContext } from '@/lib/hooks/useContext';
import { useConfigs } from '@/lib/hooks/useConfigs';
import { Tooltip } from '@/components/ui/tooltip';
import { toaster } from '@/components/ui/toaster';
import { clearChatAttachments, selectShowExpandedMessages, selectUnrestrictedMode } from '@/store/uiSlice';
import { selectAllowChatQueue } from '@/store/uiSlice';
import { buildChartAttachments } from '@/lib/chart/chart-attachments';
import ExampleQuestions from './message/ExampleQuestions';
import FileNotFound from '../FileNotFound';
import { deduplicateMessages } from './message/messageHelpers';
import SimpleChatMessage from './SimpleChatMessage';

import AgentTurnContainer from './AgentTurnContainer';
import { groupIntoTurns } from './message/groupIntoTurns';
import { StreamingProgressInline, StreamingProgressSticky } from './tools/StreamingProgress';
import { selectDatabase } from '@/lib/utils/database-selector';
import { preserveParams } from '@/lib/navigation/url-utils';
import { selectEffectiveUser } from '@/store/authSlice';
import { selectDevMode } from '@/store/uiSlice';
import { isAdmin } from '@/lib/auth/role-helpers';
import ToolCallListModal from './ToolCallListModal';
import { useNavigationGuard } from '@/lib/navigation/NavigationGuardProvider';

// next/dynamic with ssr:false prevents pdfjs-dist (browser-only, uses DOMMatrix at module init)
// from being evaluated during SSR prerendering. This is an intentional SSR boundary, not a
// circular dependency workaround.
// eslint-disable-next-line no-restricted-syntax
const ChatInput = dynamic(() => import('./ChatInput'), { ssr: false });

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

interface StreamingInfoBlockProps {
  streamingInfo: {
    thinkingText: string | null;
    toolCalls: string[];
    isAnswering: boolean;
    completedCount: number;
    totalCount: number;
    latestAction: string;
  };
  viewMode: 'compact' | 'detailed';
  showThinking: boolean;
  toggleShowThinking: () => void;
}

function StreamingInfoBlock({ streamingInfo, viewMode, showThinking, toggleShowThinking }: StreamingInfoBlockProps) {
  const { thinkingText, toolCalls, isAnswering, completedCount, totalCount, latestAction } = streamingInfo;

  if (isAnswering) return null;

  if (thinkingText && viewMode !== 'compact') {
    return (
      <Box my={2}>
        <HStack
          gap={1}
          cursor="pointer"
          onClick={toggleShowThinking}
          _hover={{ opacity: 0.8 }}
          color="fg.subtle"
          fontSize="sm"
          overflow="hidden"
          w="100%"
        >
          <Box flexShrink={0}>{showThinking ? <LuChevronDown size={16} /> : <LuChevronRight size={16} />}</Box>
          {!showThinking && (
            <Text fontFamily="mono" fontSize="sm" color="fg.subtle" fontStyle="italic" truncate>
              {thinkingText}
            </Text>
          )}
          {showThinking && (
            <Text fontFamily="mono" fontSize="sm" color="fg.subtle">Thinking</Text>
          )}
        </HStack>
        {showThinking && (
          <Box mt={1} pl={5} borderLeft="2px solid" borderColor="border.default">
            <Text color="fg.subtle" fontSize="sm" fontFamily="mono" fontStyle="italic" whiteSpace="pre-wrap">
              {thinkingText}
            </Text>
          </Box>
        )}
      </Box>
    );
  }

  if (toolCalls.length > 0) {
    if (viewMode === 'compact') {
      return <StreamingProgressInline completedCount={completedCount} totalCount={totalCount} latestAction={latestAction} />;
    }
    return (
      <HStack my={2} gap={2} flexWrap="wrap">
        {toolCalls.map((tool, i) => (
          <HStack key={i} px={2.5} py={1} borderRadius="full" borderWidth="1px" borderColor="accent.teal/30" bg="accent.teal/5" gap={1.5}>
            <Spinner size="xs" color="accent.teal" />
            <Text color="fg.muted" fontSize="xs" fontFamily="mono">{tool}</Text>
          </HStack>
        ))}
      </HStack>
    );
  }

  return null;
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
  const contextInfo = useContext(contextPath, contextVersion, true);
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
  const showExpandedMessages = useAppSelector(selectShowExpandedMessages);
  const viewMode = showExpandedMessages ? 'detailed' : 'compact';
  const [showToolInspector, setShowToolInspector] = useState(false)
  const [continueChatConfirmed, setContinueChatConfirmed] = useState(false)
  const [isPreparing, setIsPreparing] = useState(false)

  const effectiveUser = useAppSelector(selectEffectiveUser);
  const userIsAdmin = effectiveUser?.role ? isAdmin(effectiveUser.role) : false;
  const devMode = useAppSelector(selectDevMode);
  const queryResultsMap = useAppSelector(state => state.queryResults.results);
  const colorMode = useAppSelector(state => state.ui.colorMode) as 'light' | 'dark';
  const allowChatQueue = useAppSelector(selectAllowChatQueue);
  const unrestrictedMode = useAppSelector(selectUnrestrictedMode);

  // Case 1: existing conversation — follow fork chain from loaded conversation
  const conversations = useAppSelector(state => state.chat.conversations);
  const forkFollowedConversation = useMemo(() => {
    if (!providedConversationId || !loadedConversation) return null;
    let conv = loadedConversation;
    while (conv?.forkedConversationID) {
      conv = conversations[conv.forkedConversationID] || conv;
    }
    return conv;
  }, [providedConversationId, loadedConversation, conversations]);

  // Case 2: new conversation — find the active conversation (real positive ID from /api/chat/init)
  const activeConversationId = useAppSelector(selectActiveConversation);
  const activeConversation = useAppSelector(state =>
    activeConversationId ? state.chat.conversations[activeConversationId] : undefined
  );

  // When loading an existing conversation (providedConversationId set), don't fall back to
  // activeConversation — doing so causes the fork-follow useEffect to redirect back to
  // the most recent conversation before the target conversation finishes loading.
  const conversation = providedConversationId
    ? forkFollowedConversation
    : (forkFollowedConversation ?? activeConversation);

  const isNewConversation = !providedConversationId;
  const conversationID = conversation?.conversationID;

  // Pre-create a conversation on explore page mount so sends go directly to the existing path
  useEffect(() => {
    if (!isNewConversation) return;
    if (activeConversationId) return; // already have one
    let cancelled = false;
    fetch('/api/chat/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
      .then(res => res.json())
      .then(data => {
        if (cancelled || !data.conversationID) return;
        dispatch(createConversation({ conversationID: data.conversationID, agent: 'AnalystAgent' }));
      })
      .catch(err => console.error('[ChatInterface] Failed to pre-create conversation:', err));
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNewConversation, activeConversationId]);

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
    const msgs = deduplicateMessages(conversation);
    const ttu = msgs.find(m => (m as any).function?.name === 'TalkToUser');
    if (ttu) console.log('[ChatInterface] allMessages has TalkToUser, content length:', String((ttu as any).content || '').length, 'at', Date.now());
    return msgs;
  }, [conversation?.messages, conversation?.streamedCompletedToolCalls, conversation?.pending_tool_calls]);

  // Track when ChatInterface itself re-renders during streaming
  const streamedLen = conversation?.streamedCompletedToolCalls?.length ?? 0;
  const streamedTTUContent = (conversation?.streamedCompletedToolCalls ?? []).find((m: any) => m.function?.name === 'TalkToUser')?.content;
  if (conversation?.executionState === 'STREAMING') {
    console.log('[ChatInterface] RENDER during STREAMING, streamedLen:', streamedLen, 'TTU content len:', typeof streamedTTUContent === 'string' ? streamedTTUContent.length : 0, 'at', Date.now());
  }

  // Extract streaming info (thinking text + tool calls) — memoized to avoid JSON.parse loop on every render
  const streamingInfo = useMemo(() => {
    if (!conversation?.streamedCompletedToolCalls) return { thinkingText: null, toolCalls: [], isAnswering: false, completedCount: 0, totalCount: 0, latestAction: '' };

    // Native thinking streamed in real-time
    let thinkingText: string | null = null;
    if (conversation.streamedThinking) {
      thinkingText = conversation.streamedThinking;
    }

    const toolCalls: string[] = [];
    let latestAction = '';
    for (let i = conversation.streamedCompletedToolCalls.length - 1; i >= 0; i--) {
      const msg = conversation.streamedCompletedToolCalls[i];
      const toolName = msg.function?.name;
      if (toolName && toolName !== 'TalkToUser') {
        toolCalls.unshift(toolName);
        if (!latestAction) latestAction = toolName;
      }
    }

    // Check if the LLM is currently streaming the answer (last entry is TalkToUser)
    const lastEntry = conversation.streamedCompletedToolCalls[conversation.streamedCompletedToolCalls.length - 1];
    const isAnswering = lastEntry?.function?.name === 'TalkToUser';

    const completedCount = toolCalls.length;
    const pendingCount = conversation.pending_tool_calls?.filter(p => !p.result).length ?? 0;
    const totalCount = completedCount + pendingCount;

    return { thinkingText, toolCalls, isAnswering, completedCount, totalCount, latestAction };
  }, [conversation?.streamedCompletedToolCalls, conversation?.streamedThinking, conversation?.pending_tool_calls]);

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

  // Extract warning_type from the last agent result after the last user message
  const warningType = useMemo(() => {
    if (conversation?.executionState !== 'FINISHED') return null;
    const msgs = conversation.messages;
    const lastUserIdx = msgs.reduce((last, m, i) => m.role === 'user' ? i : last, -1);
    if (lastUserIdx < 0) return null;
    const agentResult = msgs.slice(lastUserIdx + 1).findLast(m => {
      const tc = m as import('@/store/chatSlice').CompletedToolCall;
      return tc.function?.name === conversation.agent;
    }) as import('@/store/chatSlice').CompletedToolCall | undefined;
    if (!agentResult) return null;
    const c = agentResult.content;
    if (typeof c === 'object' && c !== null) {
      return (c as Record<string, unknown>).warning_type as string ?? null;
    }
    return null;
  }, [conversation?.executionState, conversation?.messages, conversation?.agent]);

  // Check if conversation has exceeded the token limit
  const TOKEN_LIMIT = 250_000;
  const tokenLimitExceeded = useMemo(() => {
    if (!conversation?.messages) return false;
    const lastDebug = [...conversation.messages].reverse().find(m => m.role === 'debug') as DebugMessage | undefined;
    if (!lastDebug?.llmDebug?.length) return false;
    return lastDebug.llmDebug.some((llm: { total_tokens: number }) => llm.total_tokens > TOKEN_LIMIT);
  }, [conversation?.messages]);

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
  const isMedium = !isCompact && containerWidth > 0 && containerWidth < 1100;
  const colSpan = isCompact ? 12 : isMedium ? { base: 12, md: 8 } : { base: 12, md: 8, lg: 6 };
  const colStart = isCompact ? 1 : isMedium ? { base: 1, md: 3 } : { base: 1, md: 3, lg: 4 };


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

  // Re-check scroll position when any message changes (e.g. agent adds responses/suggestions)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    checkScrollPosition();
  }, [allMessages.length, checkScrollPosition]);

  // Track streaming answer text length for auto-scroll
  const streamingAnswerLength = useMemo(() => {
    if (!conversation?.streamedCompletedToolCalls) return 0;
    const talkToUser = conversation.streamedCompletedToolCalls.find(m => m.function?.name === 'TalkToUser');
    return typeof talkToUser?.content === 'string' ? talkToUser.content.length : 0;
  }, [conversation?.streamedCompletedToolCalls]);

  const prevStreamingAnswerLength = useRef(0);
  // Auto-scroll to bottom when streaming answer first appears or grows
  useEffect(() => {
    if (streamingAnswerLength > 0 && prevStreamingAnswerLength.current === 0) {
      // First chunk of streaming answer — scroll to show it
      scrollToBottom();
    }
    prevStreamingAnswerLength.current = streamingAnswerLength;
  }, [streamingAnswerLength]);

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

    // If agent is busy, queue immediately without async work
    if (conversationID && conversation) {
      const agentBusy = conversation.executionState === 'WAITING'
        || conversation.executionState === 'EXECUTING'
        || conversation.executionState === 'STREAMING';

      if (agentBusy) {
        if (!allowChatQueue) {
          return;
        }
        dispatch(queueMessage({
          conversationID,
          message: userInput,
          attachments: attachments.length > 0 ? attachments : undefined,
        }));
        return;
      }
    }

    // Simplify schema for agent.
    // null  = no active context → no restriction (agent can search full schema)
    // []    = context with empty whitelist → restrict to nothing
    // [...] = context with whitelisted tables → filter to those
    const simplifiedSchema = database?.schemas?.map(s => ({
      schema: s.schema,
      tables: s.tables.map(t => t.table)
    })) ?? null;

    // Render chart images for the current file and upload to S3.
    // Question: 1 image. Dashboard: one image per chart with data.
    // Show preparing indicator so user knows something is happening after pressing send.
    setIsPreparing(true);
    let allAttachments: Attachment[];
    let convId = conversationID;
    try {
      const fileAttachments = await buildChartAttachments(appState, queryResultsMap, colorMode);
      allAttachments = [...attachments, ...fileAttachments];

      // Resolve conversation — normally pre-created on mount, but fall back to inline creation
      // if the user sends before the pre-creation fetch completes (rare race condition).
      if (!convId) {
        const initRes = await fetch('/api/chat/init', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ firstMessage: userInput }),
        });
        const { conversationID: newId } = await initRes.json();
        if (!newId) throw new Error('Failed to get conversation ID from server');
        convId = newId as number;
        dispatch(createConversation({ conversationID: convId, agent: 'AnalystAgent' }));
      }
    } catch {
      setLocalError({ message: 'Failed to prepare message', code: 'UNKNOWN' });
      setIsPreparing(false);
      return;
    }
    setIsPreparing(false);

    if (!convId) return; // should not happen — caught above or pre-created

    // Clear any leftover queued messages (e.g., after interrupt)
    if (conversation?.queuedMessages?.length) {
      dispatch(clearQueuedMessages({ conversationID: convId }));
    }

    // Update agent_args with fresh appState before sending message
    dispatch(updateAgentArgs({
      conversationID: convId,
      agent_args: {
        connection_id: database?.databaseName || selectedDatabase || null,
        context_path: contextPath || null,
        context_version: contextVersion ?? null,
        schema: simplifiedSchema,
        context: markdown || '',
        app_state: appState,
        city: config.city,
        agent_name: config.branding.agentName || 'MinusX',
        unrestricted_mode: unrestrictedMode,
        ...(config.allowedVizTypes ? { allowed_viz_types: config.allowedVizTypes } : {}),
        ...(allAttachments.length > 0 ? { attachments: allAttachments } : {}),
      }
    }));

    // Send message
    dispatch(sendMessage({
      conversationID: convId,
      message: userInput,
      attachments: attachments.length > 0 ? attachments : undefined,
    }));
  };

  // Navigate when conversation forks (new conversation gets real ID, or conflict resolution)
  useEffect(() => {
    if (!conversation || container !== 'page') return;

    // Don't navigate if conversation is inactive (was cleared via "New Chat")
    if (!conversation.active) return;

    // For new conversations: navigate when a real conversation with messages exists
    if (isNewConversation && conversationID && conversationID > 0 && allMessages.length > 0) {
      console.log("[ChatInterface] New conversation created with ID:", conversationID);
      router.push(`/explore/${conversationID}`);
      return;
    }

    // For existing conversations: navigate if URL doesn't match current conversation ID
    if (!isNewConversation && conversationID && conversationID !== providedConversationId) {
      console.log("[ChatInterface] Conversation forked to:", conversationID);
      router.push(`/explore/${conversationID}`);
    }
  }, [conversationID, isNewConversation, providedConversationId, container, router, conversation, allMessages.length]);


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
            {userIsAdmin && devMode && allMessages.length > 0 && (
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
            {/* ViewModeToggle removed — always use compact */}
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

              {viewMode === 'detailed' ? (
                allMessages.map((msg, idx) => (
                    <SimpleChatMessage
                        key={`${msg.role}-${idx}-${(msg as any).tool_call_id || ''}`}
                        message={msg}
                        databaseName={selectedDatabase || ''}
                        isCompact={isCompact}
                        showThinking={showThinking}
                        toggleShowThinking={toggleShowThinking}
                        markdownContext={container === 'sidebar' ? 'sidebar' : 'mainpage'}
                        conversationID={conversationID}
                        readOnly={readOnly || needsContinueConfirmation}
                        viewMode={viewMode}
                    />
                ))
              ) : (
                groupIntoTurns(allMessages).map((turn, turnIdx) => (
                  <AgentTurnContainer
                    key={`turn-${turnIdx}`}
                    turn={turn}
                    isCompact={isCompact}
                    databaseName={selectedDatabase || ''}
                    showThinking={showThinking}
                    toggleShowThinking={toggleShowThinking}
                    markdownContext={container === 'sidebar' ? 'sidebar' : 'mainpage'}
                    readOnly={readOnly || needsContinueConfirmation}
                    conversationID={conversationID}
                    viewMode={viewMode}
                  />
                ))
              )}

              {/* Streaming info: show thinking text and tool calls while streaming (hide once answer is streaming) */}
              {isStreaming && (
                <StreamingInfoBlock
                  streamingInfo={streamingInfo}
                  viewMode={viewMode}
                  showThinking={showThinking}
                  toggleShowThinking={toggleShowThinking}
                />
              )}

              {/* Note: Pending user inputs are rendered via ToolCallDisplay in the message stream */}
            </GridItem></Grid>
          )}

          {/* Error Display */}
          {error && (() => {
            return (
              <Grid templateColumns={{ base: 'repeat(12, 1fr)', md: 'repeat(12, 1fr)' }} gap={2} w="100%">
                <GridItem colSpan={colSpan} colStart={colStart}>
                  <Box p={3} bg="accent.danger/10" borderLeft="3px solid" borderColor="accent.danger" borderRadius="md">
                    <Text color="accent.danger" fontSize="sm" fontFamily="mono">
                      {devMode
                        ? (typeof error === 'string' ? error : error?.message || 'An error occurred')
                        : 'An error occurred'}
                    </Text>
                    {conversationID && (
                      <Button mt={2} size="xs" variant="outline" colorPalette="red" aria-label="Try again"
                        onClick={() => dispatch(sendMessage({ conversationID, message: 'Continue' }))}>
                        Try again
                      </Button>
                    )}
                  </Box>
                </GridItem>
              </Grid>
            );
          })()}

          {/* Warning Display (backend-signalled warnings e.g. context_length, max_iterations) */}
          {warningType && (() => {
            const WARNING_CONFIG: Record<string, { msg: string; cta: string }> = {
              context_length: { msg: 'The output was too long. Do you want to continue?', cta: 'Continue' },
              max_iterations: { msg: 'Maximum steps reached. Please try a simpler request.', cta: 'Try again' },
            };
            const cfg = WARNING_CONFIG[warningType];
            if (!cfg) return null;
            return (
              <Grid templateColumns={{ base: 'repeat(12, 1fr)', md: 'repeat(12, 1fr)' }} gap={2} w="100%">
                <GridItem colSpan={colSpan} colStart={colStart}>
                  <Box p={3} bg="accent.warning/10" borderLeft="3px solid" borderColor="accent.warning" borderRadius="md">
                    <Text color="accent.warning" fontSize="sm" fontFamily="mono">{cfg.msg}</Text>
                    {conversationID && (
                      <Button mt={2} size="xs" variant="outline" colorPalette="yellow" aria-label={cfg.cta}
                        onClick={() => dispatch(sendMessage({ conversationID, message: cfg.cta }))}>
                        {cfg.cta}
                      </Button>
                    )}
                  </Box>
                </GridItem>
              </Grid>
            );
          })()}

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

      {/* Sticky streaming progress badge above input */}
      {isStreaming && viewMode === 'compact' && !streamingInfo.isAnswering && streamingInfo.totalCount > 0 && (
        <Box display="flex" justifyContent="center" pb={1}>
          <StreamingProgressSticky
            completedCount={streamingInfo.completedCount}
            totalCount={streamingInfo.totalCount}
          />
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

          {(isAgentRunning || isStreaming) && (
            <Grid templateColumns={{ base: 'repeat(12, 1fr)', md: 'repeat(12, 1fr)' }}
                gap={2}
                w="100%"
            >
              <GridItem colSpan={colSpan} colStart={colStart}>
                <ThinkingIndicator waitingForInput={isWaitingForUserInput} onStop={handleStopAgent} queuedMessages={conversation?.queuedMessages || []} />
              </GridItem>
            </Grid>
          )}

{tokenLimitExceeded && !isAgentRunning && !isStreaming ? (
            <HStack justify="center" py={2} px={4} gap={3} borderTop="1px solid" borderColor="border.muted" fontFamily="mono">
              <Text fontSize="xs"><Text as="span" fontWeight="semibold">Conversation too long.</Text>{' '}<Text as="span" color="fg.muted">Long conversations degrade agent performance. Please start a new chat.</Text></Text>
              <Button size="xs" bg="accent.teal" color="white" fontFamily="mono" _hover={{ bg: 'accent.teal', opacity: 0.9 }} onClick={handleNewChat} flexShrink={0}><Icon as={LuPlus} boxSize={4} mr={1} />New Chat</Button>
            </HStack>
          ) : (
<Box width="100%">
            <ChatInput
              onSend={handleSendMessage}
              onStop={handleStopAgent}
              isAgentRunning={isAgentRunning || isStreaming}
              allowChatQueue={allowChatQueue}
              isPreparing={isPreparing}
              disabled={isLoading}
              databaseName={selectedDatabase || ''}
              onDatabaseChange={handleDatabaseChange}
              container={container}
              isCompact={isCompact}
              colSpan={colSpan}
              colStart={colStart}
              connectionsLoading={connectionsLoading}
              contextsLoading={contextsLoading}
              selectedContextPath={contextPath}
              selectedVersion={contextVersion}
              onContextChange={onContextChange}
              whitelistedSchemas={databases}
              prefillText={!isAgentRunning && !isStreaming && conversation?.wasInterrupted && conversation?.queuedMessages?.length
                ? conversation.queuedMessages.map(qm => qm.message).join('\n')
                : undefined}
            />
          </Box>
          )}
        </Box>
      )}
    </VStack>
  );
}
