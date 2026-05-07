'use client';

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from '@/lib/navigation/use-navigation';
import { Box, VStack, HStack, Text, Icon, Button, Spinner, Grid, GridItem } from '@chakra-ui/react';
import { LuPlus, LuChevronDown, LuChevronRight, LuRefreshCw, LuPin, LuShare2, LuExpand, LuMessageSquare } from 'react-icons/lu';
import type { LoadError } from '@/lib/types/errors';
import type { AgentSkillSelection, AgentUserSkillCatalogItem, Attachment, SkillMention } from '@/lib/types';
import { useSlashCommands, tryExecuteSlashCommand } from './slash-commands';
import { AppState } from '@/lib/appState';
import ChatInputBar from './ChatInputBar';
import { useAppSelector } from '@/store/hooks';
import { type DebugMessage } from '@/store/chatSlice';
import type { ChatDataSource } from '@/lib/chat-data-source/types';
import { useContext } from '@/lib/hooks/useContext';
import { useConfigs } from '@/lib/hooks/useConfigs';
import { Tooltip } from '@/components/ui/tooltip';
import { toaster } from '@/components/ui/toaster';
import { selectShowExpandedMessages, selectUnrestrictedMode } from '@/store/uiSlice';
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
import ToolDebugBar from './ToolDebugBar';
import { useNavigationGuard } from '@/lib/navigation/NavigationGuardProvider';

interface ChatInterfaceProps {
  /** Data source — legacy or v=2. Caller constructs via useLegacyChatData / useV2ChatData. */
  dataSource: ChatDataSource;
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
  dataSource,
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
  const isExplorePage = !appState || (appState.type !== 'file' && appState.type !== 'folder');

  // Conversation state comes from the data source. Adapter handles fork-follow,
  // active-conversation fallback, /api/chat/init pre-create (legacy), or
  // /api/chat/v2/new (v=2). ChatInterface is purely a renderer over this state.
  const { conversation, conversationID, isLoading, loadError, isNewConversation } = dataSource;
  // Used in a few storedConnectionId / storedContextPath selectors and the
  // navigation effect — it represents the live id, not the originally-passed
  // one (the data source handles fork-follow internally).
  const providedConversationId = conversationID;

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

  const [showThinking, setShowThinking] = useState<boolean>(false)
  const showExpandedMessages = useAppSelector(selectShowExpandedMessages);
  const viewMode = showExpandedMessages ? 'detailed' : 'compact';
  const [continueChatConfirmed, setContinueChatConfirmed] = useState(false)
  const [isPreparing, setIsPreparing] = useState(false)

  const effectiveUser = useAppSelector(selectEffectiveUser);
  const userIsAdmin = effectiveUser?.role ? isAdmin(effectiveUser.role) : false;
  const devMode = useAppSelector(selectDevMode);
  const queryResultsMap = useAppSelector(state => state.queryResults.results);
  const colorMode = useAppSelector(state => state.ui.colorMode) as 'light' | 'dark';
  const allowChatQueue = useAppSelector(selectAllowChatQueue);
  const unrestrictedMode = useAppSelector(selectUnrestrictedMode);

  const chatSkills = contextInfo.availableSkills;

  const uniqueSkills = useCallback((skills: SkillMention[]) => {
    const seen = new Set<string>();
    return skills.filter(skill => {
      const key = `${skill.source}:${skill.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, []);

  const getSkillsFromMessage = useCallback((message: string) => {
    const refs: SkillMention[] = [];
    for (const match of message.matchAll(/@(\{.+?\})/g)) {
      try {
        const data = JSON.parse(match[1]);
        if (data?.type !== 'skill' || !data.name || !data.source) {
          continue;
        }
        const skill = chatSkills.find(candidate =>
          candidate.source === data.source && candidate.name === data.name
        );
        if (skill) {
          refs.push(skill);
        }
      } catch {}
    }
    return uniqueSkills(refs);
  }, [chatSkills, uniqueSkills]);

  // `conversation`, `conversationID`, `isNewConversation`, and bootstrap
  // effects all live in the data source now (legacy or v=2). ChatInterface
  // is purely a renderer over this state.

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
    return deduplicateMessages(conversation);
  }, [conversation?.messages, conversation?.streamedCompletedToolCalls, conversation?.pending_tool_calls]);

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
    const el = scrollContainerRef.current;
    if (!el) return;
    // JSDOM in tests doesn't implement scrollTo — guard so the test env
    // doesn't throw.
    if (typeof el.scrollTo !== 'function') return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
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
    dataSource.newChat();
  };

  const handleStopAgent = () => {
    dataSource.stop?.();
  };

  const { availableCommands, handleCommandExecute } = useSlashCommands({ appState, container });

  const handleSendMessage = async (userInput: string, attachments: Attachment[] = []) => {
    if (!userInput.trim()) return;

    // Safety net: intercept slash commands typed directly without dropdown.
    // Skip when the data source doesn't support slash commands (e.g. v=2).
    if (
      dataSource.capabilities.slashCommands &&
      tryExecuteSlashCommand(userInput, availableCommands, handleCommandExecute)
    ) {
      return;
    }

    // Skill mention extraction — only meaningful for sources that support it.
    const selectedSkillMentions = dataSource.capabilities.skillMentions
      ? getSkillsFromMessage(userInput)
      : [];

    // Block sending if connections or contexts are still loading. Only
    // applies when the source uses the context selector (legacy) — v=2
    // bootstraps its own context server-side.
    if (
      dataSource.capabilities.contextSelector &&
      (connectionsLoading || contextsLoading)
    ) {
      setLocalError({
        message: 'Still loading connections and context...',
        code: 'UNKNOWN'
      });
      return;
    }

    setLocalError(null);

    // If agent is busy, queue immediately without async work. Skipped when
    // queueing isn't supported by the source.
    if (dataSource.capabilities.queueMessages && conversationID && conversation) {
      const agentBusy = conversation.executionState === 'WAITING'
        || conversation.executionState === 'EXECUTING'
        || conversation.executionState === 'STREAMING';

      if (agentBusy) {
        if (!allowChatQueue) return;
        dataSource.queue?.({
          message: userInput,
          attachments: attachments.length > 0 ? attachments : undefined,
        });
        return;
      }
    }

    // Build agent_args (legacy only — carries app_state, schema, skills,
    // attachments, etc.). v=2 builds equivalent context server-side via
    // setupOrchestration so we skip the whole block.
    let agentArgs: Record<string, unknown> | undefined;
    let allAttachments: Attachment[] = attachments;

    if (dataSource.capabilities.agentArgs) {
      // Render chart images for the current file and upload to S3.
      // Show preparing indicator so user knows something is happening after pressing send.
      setIsPreparing(true);
      try {
        const fileAttachments = await buildChartAttachments(appState, queryResultsMap, colorMode);
        allAttachments = [...attachments, ...fileAttachments];
      } catch {
        setLocalError({ message: 'Failed to prepare message', code: 'UNKNOWN' });
        setIsPreparing(false);
        return;
      }
      setIsPreparing(false);

      // Clear any leftover queued messages (e.g., after interrupt) before send.
      if (conversation?.queuedMessages?.length) {
        dataSource.clearQueue?.();
      }

      // Simplify schema for agent.
      // null  = no active context → no restriction
      // []    = context with empty whitelist → restrict to nothing
      // [...] = context with whitelisted tables → filter to those
      const simplifiedSchema = database?.schemas?.map(s => ({
        schema: s.schema,
        tables: s.tables.map(t => t.table)
      })) ?? null;

      const uniqueSelectedSkills = uniqueSkills(selectedSkillMentions);
      const selectedUserNames = new Set(
        uniqueSelectedSkills
          .filter((skill): skill is Extract<SkillMention, { source: 'user' }> => skill.source === 'user')
          .map(skill => skill.name)
      );
      const agentSelectedSkills: AgentSkillSelection[] = uniqueSelectedSkills.map(skill => {
        if (skill.source === 'system') {
          return { type: 'system', name: skill.name };
        }
        return {
          type: 'user',
          name: skill.name,
          description: skill.description || '',
          content: skill.content || '',
        };
      });
      // Auto-inject large_file skill when app state is very large
      const LARGE_APP_STATE_THRESHOLD = 200_000; // characters
      const appStateSize = appState ? JSON.stringify(appState).length : 0;
      if (appStateSize > LARGE_APP_STATE_THRESHOLD && !agentSelectedSkills.some(s => s.name === 'large_file')) {
        agentSelectedSkills.push({ type: 'system', name: 'large_file' });
      }

      const uniqueUserCatalog: AgentUserSkillCatalogItem[] = uniqueSkills(chatSkills)
        .filter((skill): skill is Extract<SkillMention, { source: 'user' }> => skill.source === 'user')
        .filter(skill => !selectedUserNames.has(skill.name))
        .map(skill => ({
          name: skill.name,
          description: skill.description || '',
        }));

      agentArgs = {
        connection_id: database?.databaseName || selectedDatabase || null,
        context_path: contextPath || null,
        context_version: contextVersion ?? null,
        schema: simplifiedSchema,
        context: markdown || '',
        app_state: appState,
        city: config.city,
        agent_name: config.branding.agentName || 'MinusX',
        unrestricted_mode: unrestrictedMode,
        skills: {
          selected: agentSelectedSkills,
          user_catalog: uniqueUserCatalog,
        },
        ...(config.allowedVizTypes ? { allowed_viz_types: config.allowedVizTypes } : {}),
        ...(allAttachments.length > 0 ? { attachments: allAttachments } : {}),
      };
    }

    // Send via the data source. The adapter handles bootstrap (legacy:
    // /api/chat/init pre-create; v=2: /api/chat/v2/new), updates agent_args
    // if applicable, and dispatches the appropriate listener-driven action.
    try {
      await dataSource.send({
        message: userInput,
        attachments: allAttachments.length > 0 ? allAttachments : undefined,
        agentArgs,
      });
    } catch (err) {
      setLocalError({
        message: err instanceof Error ? err.message : 'Failed to send message',
        code: 'UNKNOWN',
      });
    }
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


  // Handler for setting conversation as active (legacy only)
  const handleSetAsActive = () => {
    dataSource.setActive?.();
  };

  // Determine if current conversation is active
  const isConversationActive = conversation?.active === true;

  // "Set as Active" button (only shown for non-active conversations, legacy only)
  const setAsActiveButton = dataSource.capabilities.setActive && providedConversationId && !isConversationActive && conversation && (
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

      {userIsAdmin && devMode && <ToolDebugBar messages={allMessages} />}

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
                        onClick={() => dataSource.send({ message: 'Continue' })}>
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
            const WARNING_CONFIG: Record<string, { msg: string; label: string; cta: string }> = {
              context_length: { msg: 'The output was too long. Do you want to continue?', label: 'Continue', cta: 'Continue with the previous request. Break the previous request down and proceed part by part and not all at once' },
              max_iterations: { msg: 'Maximum steps reached. Please try a simpler request.', label: 'Try again', cta: 'Try again' },
            };
            const cfg = WARNING_CONFIG[warningType];
            if (!cfg) return null;
            return (
              <Grid templateColumns={{ base: 'repeat(12, 1fr)', md: 'repeat(12, 1fr)' }} gap={2} w="100%">
                <GridItem colSpan={colSpan} colStart={colStart}>
                  <Box p={3} bg="accent.warning/10" borderLeft="3px solid" borderColor="accent.warning" borderRadius="md">
                    <Text color="accent.warning" fontSize="sm" fontFamily="mono">{cfg.msg}</Text>
                    {conversationID && (
                      <Button mt={2} size="xs" variant="outline" colorPalette="yellow" aria-label={cfg.label}
                        onClick={() => dataSource.send({ message: cfg.cta })}>
                        {cfg.label}
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
        <ChatInputBar
          onSend={handleSendMessage}
          onStop={handleStopAgent}
          onNewChat={handleNewChat}
          isAgentRunning={isAgentRunning}
          isStreaming={isStreaming}
          isWaitingForUserInput={isWaitingForUserInput}
          isPreparing={isPreparing}
          isLoading={isLoading}
          tokenLimitExceeded={tokenLimitExceeded}
          queuedMessages={conversation?.queuedMessages || []}
          wasInterrupted={!!conversation?.wasInterrupted}
          allowChatQueue={allowChatQueue}
          selectedDatabase={selectedDatabase}
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
          availableSkills={chatSkills}
          availableCommands={availableCommands}
          onCommandExecute={handleCommandExecute}
        />
      )}
    </VStack>
  );
}
