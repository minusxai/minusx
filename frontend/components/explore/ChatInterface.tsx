'use client';

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from '@/lib/navigation/use-navigation';
import { Box, VStack, HStack, Text, Icon, Button, Spinner, Grid, GridItem } from '@chakra-ui/react';
import { LuPlus, LuChevronDown, LuChevronRight, LuRefreshCw, LuPin, LuShare2, LuExpand, LuMessageSquare } from 'react-icons/lu';
import type { LoadError } from '@/lib/types/errors';
import type { AgentSkillSelection, AgentUserSkillCatalogItem, Attachment, SkillMention } from '@/lib/types';
import type { ContextSizeEstimate } from '@/lib/chat/context-size-estimate';
import { ContextSizePanel, type ContextSizePanelState } from './ContextSizePanel';
import { useClearChat, useSlashCommands, tryExecuteSlashCommand } from './slash-commands';
import { AppState } from '@/lib/appState';
import dynamic from 'next/dynamic';
import ThinkingIndicator from './ThinkingIndicator';
import { useAppDispatch, useAppSelector, useAppStore } from '@/store/hooks';
import { createConversation, sendMessage, queueMessage, clearQueuedMessages, updateAgentArgs, interruptChat, setActiveConversation, setConversationTitle, selectActiveConversation, selectForkChainTail, type DebugMessage } from '@/store/chatSlice';
import { useConversation } from '@/lib/hooks/useConversation';
import { ConversationsAPI } from '@/lib/data/conversations';
import { useUseChatV2, isLegacyChatInV2 } from '@/lib/chat-v2/use-chat-v2';
import { useContext } from '@/lib/hooks/useContext';
import { useConfigs } from '@/lib/hooks/useConfigs';
import { Tooltip } from '@/components/ui/tooltip';
import { toaster } from '@/components/ui/toaster';
import { selectChatAttachments, selectShowExpandedMessages, selectUnrestrictedMode, setSidebarPendingSlashCommand } from '@/store/uiSlice';
import { selectAllowChatQueue } from '@/store/uiSlice';
import { captureFileViewBlob } from '@/lib/screenshot/capture';
import { AGENT_IMAGE_MAX_PX } from '@/lib/screenshot/constants';
import { uploadBlobOrEmbed } from '@/lib/object-store/client';
import { facetHash } from '@/lib/projection/facets';
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
import { selectDisableAppStateImages } from '@/store/configsSlice';
import { isAdmin } from '@/lib/auth/role-helpers';
import ToolDebugBar from './ToolDebugBar';
import { useNavigationGuard } from '@/lib/navigation/NavigationGuardProvider';

// next/dynamic with ssr:false prevents pdfjs-dist (browser-only, uses DOMMatrix at module init)
// from being evaluated during SSR prerendering. This is an intentional SSR boundary, not a
// circular dependency workaround.
// eslint-disable-next-line no-restricted-syntax
const ChatInput = dynamic(() => import('./ChatInput'), { ssr: false });

// Cross-turn capture cache: skip re-shooting when nothing visible changed (key matches).
let lastFileShot: { key: string; url: string } | null = null;

/**
 * Attach a SINGLE screenshot of the current file to the app-state image facet (replacing the old
 * per-chart image series). The projection pass dedups it across turns via the stable `key` (file id
 * + a hash of what's rendered), so an unchanged view is never re-sent. Best-effort: on any failure
 * (or non-file page / opt-out) the app state is returned unchanged.
 */
async function appStateWithFileScreenshot(
  appState: AppState | null | undefined,
  colorMode: 'light' | 'dark',
  disabled: boolean,
): Promise<AppState | null | undefined> {
  if (disabled || typeof document === 'undefined') return appState;
  if (!appState || appState.type !== 'file' || !appState.state?.fileState?.id) return appState;
  const fs = appState.state.fileState;
  const key = `file:${fs.id}:${facetHash({ markup: fs.markup, qr: appState.state.queryResults, colorMode })}`;
  try {
    let url: string;
    if (lastFileShot?.key === key) {
      url = lastFileShot.url;
    } else {
      const blob = await captureFileViewBlob(fs.id, { colorMode, maxWidth: AGENT_IMAGE_MAX_PX, format: 'jpeg' });
      url = await uploadBlobOrEmbed(blob, 'file.jpg', 'image/jpeg');
      lastFileShot = { key, url };
    }
    return { ...appState, state: { ...appState.state, fileState: { ...fs, image: { key, url } } } };
  } catch {
    return appState;
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
  /** Custom empty-state prompts (e.g. story-specific questions). Falls back to generic defaults. */
  suggestedPrompts?: string[];
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
  suggestedPrompts,
}: ChatInterfaceProps) {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const isExplorePage = !appState || (appState.type !== 'file' && appState.type !== 'folder');

  // Load context using useContext hook (reuse existing hook)
  const contextInfo = useContext(contextPath, contextVersion, true);
  const { databases, contextLoading } = contextInfo;
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
       
      setSelectedDatabase(storedConnectionId);
    }
  }, [storedConnectionId]);

  // Auto-select database when context loads (if none selected) — intentional setState in effect
  useEffect(() => {
    if (!selectedDatabase && databases.length > 0) {
      // Prefer databases with schemas loaded for auto-select so the user starts with a working connection.
      const dbsWithSchemas = databases.filter(db => db.schemas.length > 0);
      const autoSelected = selectDatabase(dbsWithSchemas.length > 0 ? dbsWithSchemas : databases, null);
       
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

  // Legacy (v1) chat opened in v2 mode: the v2 engine can't continue it (the
  // forked agent gets no context), so we show its read-only history but replace
  // the input with a "New Chat" CTA. See isLegacyChatInV2.
  const useChatV2Mode = useUseChatV2();
  const isLegacyChat = isLegacyChatInV2(useChatV2Mode, providedConversationId, loadedConversation?.version);

  const [showThinking, setShowThinking] = useState<boolean>(false)
  const showExpandedMessages = useAppSelector(selectShowExpandedMessages);
  const viewMode = showExpandedMessages ? 'detailed' : 'compact';
  const [continueChatConfirmed, setContinueChatConfirmed] = useState(false)
  const [isPreparing, setIsPreparing] = useState(false)

  const effectiveUser = useAppSelector(selectEffectiveUser);
  const userIsAdmin = effectiveUser?.role ? isAdmin(effectiveUser.role) : false;
  const devMode = useAppSelector(selectDevMode);
  const allowChatQueue = useAppSelector(selectAllowChatQueue);
  const chatAttachments = useAppSelector(selectChatAttachments);
  const sidebarPendingSlashCommand = useAppSelector(state => state.ui.sidebarPendingSlashCommand);
  // queryResultsMap / colorMode / disableAppStateImages / unrestrictedMode are
  // ONLY needed inside handleSendMessage. Read them on demand via useAppStore
  // instead of subscribing — otherwise this parent re-renders every time any
  // unrelated query result lands or the user toggles colorMode.
  const store = useAppStore();

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

  // Case 1: existing conversation — follow fork chain from loaded conversation.
  // selectForkChainTail is memoized: when state.chat.conversations changes due
  // to an unrelated streaming dispatch, the result ref stays stable so this
  // useAppSelector skips the re-render. (Previously this subscribed to the
  // entire conversations map and re-rendered on every chunk.)
  const forkChainStartID = loadedConversation?.forkedConversationID;
  const forkChainTail = useAppSelector(state => selectForkChainTail(state, forkChainStartID));
  const forkFollowedConversation = useMemo(() => {
    if (!providedConversationId || !loadedConversation) return null;
    // No fork → the loaded conversation is itself the tail.
    return loadedConversation.forkedConversationID
      ? (forkChainTail ?? loadedConversation)
      : loadedConversation;
  }, [providedConversationId, loadedConversation, forkChainTail]);

  // Case 2: new conversation — find the active conversation (real positive ID from /api/conversations)
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

  // AI-generated conversation title (shown in the header). Existing conversations
  // carry it from the full load (useConversation) — zero extra cost. A brand-new
  // conversation gets its title generated server-side after the first turn, so we
  // fetch the cheap title row EXACTLY ONCE then (never per turn, never if we
  // already have it). Only the generated title is shown (the raw first message is
  // already the first bubble).
  const conversationTitle = conversation?.title ?? null;
  const turnFinished = conversation?.executionState === 'FINISHED';
  const titleFetchedFor = useRef<number | null>(null);
  useEffect(() => {
    if (!conversationID || conversationID <= 0) return;
    if (conversationTitle) return;                          // already have it (load or prior fetch)
    if (!turnFinished) return;                              // title is generated once a turn finishes
    if (titleFetchedFor.current === conversationID) return; // fetch at most once per conversation
    titleFetchedFor.current = conversationID;
    ConversationsAPI.getTitle(conversationID)
      .then((t) => { if (t) dispatch(setConversationTitle({ conversationID, title: t })); })
      .catch(() => { /* best-effort: header just stays untitled */ });
  }, [conversationID, conversationTitle, turnFinished, dispatch]);

  // Pre-create a conversation on explore page mount so sends go directly to the existing path
  useEffect(() => {
    if (!isNewConversation) return;
    if (activeConversationId) return; // already have one
    let cancelled = false;
    // Chat v3: conversations are dedicated rows (not files). Create via /api/conversations and tag
    // the Redux conversation version:3 so the listener uses the v3 turns+stream engine.
    fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
      .then(res => res.json())
      .then(data => {
        if (cancelled || !data.id) return;
        dispatch(createConversation({ conversationID: data.id, agent: 'AnalystAgent', version: 3 }));
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
  const TOKEN_LIMIT = 150_000;
  const tokenLimitExceeded = useMemo(() => {
    if (!conversation?.messages) return false;
    // Gate only makes sense once there's accumulated history to shed by starting
    // over. On a single-query conversation a fresh chat would re-run the same
    // query and hit the same size, so don't lock the user out.
    const userMessageCount = conversation.messages.filter(m => m.role === 'user').length;
    if (userMessageCount < 2) return false;
    const lastDebug = [...conversation.messages].reverse().find(m => m.role === 'debug') as DebugMessage | undefined;
    if (!lastDebug?.llmDebug?.length) return false;
    return lastDebug.llmDebug.some((llm: { total_tokens: number }) => llm.total_tokens > TOKEN_LIMIT);
  }, [conversation?.messages]);

  // Get error from conversation or use local state for client-side errors
  const [localError, setLocalError] = useState<LoadError | null>(null);
  // Only show runtime/execution errors here (not loadError - that's shown in dedicated section above)
  const error = conversation?.error || localError;
  const [contextSizePanel, setContextSizePanel] = useState<ContextSizePanelState | null>(null);
  const contextSizeAbortRef = useRef<AbortController | null>(null);
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

  // Compute layout based on container width and mode.
  // Memoized so the colSpan/colStart object identities are stable across renders,
  // letting React.memo'd children (ExampleQuestions) skip when nothing relevant changed.
  const isCompact = container === 'sidebar' || (containerWidth > 0 && containerWidth < 900);
  const isMedium = !isCompact && containerWidth > 0 && containerWidth < 1100;
  const colSpan = useMemo(
    () => isCompact ? 12 : isMedium ? { base: 12, md: 8 } : { base: 12, md: 8, lg: 6 },
    [isCompact, isMedium],
  );
  const colStart = useMemo(
    () => isCompact ? 1 : isMedium ? { base: 1, md: 3 } : { base: 1, md: 3, lg: 4 },
    [isCompact, isMedium],
  );


  // Clear errors when navigating between conversations — intentional setState in effect
  const prevProvidedIdRef = useRef(providedConversationId);
  useEffect(() => {
    const prevId = prevProvidedIdRef.current;
    prevProvidedIdRef.current = providedConversationId;

    // Clear errors when going from one conversation to another
    if (prevId !== providedConversationId) {
       
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
     
    checkScrollPosition();
  }, [userMessageCount]);

  // Re-check scroll position when any message changes (e.g. agent adds responses/suggestions)
  useEffect(() => {
     
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

  const clearChat = useClearChat(container);
  const handleNewChat = () => {
    setLocalError(null);
    clearChat();
  };

  const handleStopAgent = () => {
    if (conversationID) {
      dispatch(interruptChat({ conversationID }));
    }
  };

  const closeContextSizePanel = useCallback(() => {
    contextSizeAbortRef.current?.abort();
    contextSizeAbortRef.current = null;
    setContextSizePanel(null);
  }, []);

  const buildAgentArgsForMessage = useCallback((userInput: string, allAttachments: Attachment[] = []) => {
    const selectedSkillMentions = getSkillsFromMessage(userInput);
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

    const LARGE_APP_STATE_THRESHOLD = 200_000; //~50k tokens
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

    // POINTERS ONLY — the server resolves the actual context docs, catalog,
    // library, and schema from these (see buildServerAgentArgs). Shipping the
    // resolved content here would be redundant (the server recomputes it anyway)
    // and untrustworthy (the browser could tamper with it).
    return {
      connection_id: database?.databaseName || selectedDatabase || null,
      context_path: contextPath || null,
      context_version: contextVersion ?? null,
      context_file_id: contextInfo.contextId ?? null,
      app_state: appState,
      city: config.city,
      agent_name: config.branding.agentName || 'MinusX',
      unrestricted_mode: selectUnrestrictedMode(store.getState()),
      skills: {
        selected: agentSelectedSkills,
        user_catalog: uniqueUserCatalog,
      },
      ...(config.allowedVizTypes ? { allowed_viz_types: config.allowedVizTypes } : {}),
      ...(allAttachments.length > 0 ? { attachments: allAttachments } : {}),
    };
  }, [
    appState,
    chatSkills,
    config.allowedVizTypes,
    config.branding.agentName,
    config.city,
    contextInfo.contextId,
    contextPath,
    contextVersion,
    database,
    getSkillsFromMessage,
    selectedDatabase,
    store,
    uniqueSkills,
  ]);

  const handleContextSize = useCallback(async () => {
    if (connectionsLoading || contextsLoading) {
      setContextSizePanel({ status: 'error', error: 'Still loading connections and context' });
      return;
    }
    if (!conversationID) {
      setContextSizePanel({ status: 'error', error: 'Preparing chat. Try again in a moment.' });
      return;
    }

    contextSizeAbortRef.current?.abort();
    const controller = new AbortController();
    contextSizeAbortRef.current = controller;
    setContextSizePanel({ status: 'loading' });

    try {
      // Mirror the SEND path: attach the file screenshot to the app-state image facet so the
      // estimate's preview context carries the same image the real request would. The projection
      // pass dedups it across turns (unchanged view → not re-sent → 0 image tokens), so the count
      // is faithful — including respecting the "disable app-state images" opt-out.
      const sizeState = store.getState();
      const colorMode = sizeState.ui.colorMode as 'light' | 'dark';
      const disableAppStateImages = selectDisableAppStateImages(sizeState);
      const agentArgs = buildAgentArgsForMessage(' ', chatAttachments);
      agentArgs.app_state = await appStateWithFileScreenshot(appState, colorMode, disableAppStateImages);

      const res = await fetch('/api/chat/context-size', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          conversationID,
          user_message: ' ',
          source: container === 'sidebar' ? 'side_chat' : 'explore',
          agent: 'AnalystAgent',
          agent_args: agentArgs,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error?.message || data.error || 'Failed to estimate context size');
      }
      // Cached tokens from the LAST turn (usage.cacheRead) — surfaced so the panel can show how
      // much of the prefix the provider actually served from cache. Read off the most recent debug
      // message's last LLM call.
      const lastDebug = [...(conversation?.messages ?? [])].reverse().find(m => m.role === 'debug') as DebugMessage | undefined;
      const lastCall = lastDebug?.llmDebug?.[lastDebug.llmDebug.length - 1];
      const cachedTokens = lastCall?.cache_read_tokens ?? 0;
      setContextSizePanel({ status: 'ready', estimate: data as ContextSizeEstimate, cachedTokens });
    } catch (err) {
      if (controller.signal.aborted) return;
      setContextSizePanel({
        status: 'error',
        error: err instanceof Error ? err.message : 'Failed to estimate context size',
      });
    } finally {
      if (contextSizeAbortRef.current === controller) {
        contextSizeAbortRef.current = null;
      }
    }
  }, [buildAgentArgsForMessage, chatAttachments, connectionsLoading, contextsLoading, conversationID, container, conversation, appState, store]);

  const { availableCommands, handleCommandExecute } = useSlashCommands({ appState, container, onContextSize: handleContextSize });

  useEffect(() => {
    if (container !== 'sidebar') return;
    if (!sidebarPendingSlashCommand) return;
    if (sidebarPendingSlashCommand === 'view-context-size' && (!conversationID || connectionsLoading || contextsLoading)) return;

    const command = availableCommands.find(cmd => cmd.name === sidebarPendingSlashCommand);
    dispatch(setSidebarPendingSlashCommand(null));

    if (!command) {
      toaster.create({ title: `Unknown command: /${sidebarPendingSlashCommand}`, type: 'error' });
      return;
    }
    if (command.disabled) {
      toaster.create({ title: command.disabledReason || `/${command.name} is unavailable`, type: 'info' });
      return;
    }
    handleCommandExecute(command);
  }, [
    availableCommands,
    connectionsLoading,
    contextsLoading,
    container,
    conversationID,
    dispatch,
    handleCommandExecute,
    sidebarPendingSlashCommand,
  ]);

  // Stable callback wrapper for memo'd children (e.g. ExampleQuestions, ChatInput).
  // handleSendMessage closes over many stateful values and is recreated each
  // render — passing it directly to memo'd children defeats their memo, AND it
  // also DESTABILISES children whose memo comparator IGNORES callback identity
  // (ChatInput / LexicalMentionEditor's `chatInputPropsEqual` and
  // `lexicalEditorPropsEqual` both strip onSend/onSubmit from the comparison).
  // In that case the comparator skips the re-render but the child keeps holding
  // the FIRST onSend ever passed — the editor's KEY_ENTER_COMMAND useEffect (deps
  // `[editor, onSubmit]`) never re-runs, so Enter invokes a closure that captured
  // `input=''` from mount and short-circuits handleSend, while Lexical still clears
  // the editor afterwards. The user sees "message disappears, nothing sent".
  // The ref lets every memo'd child hold one unchanging callback identity while
  // still invoking the latest impl. Regression test:
  // components/__tests__/chat-input-stable-onsend.ui.test.tsx.
  const sendMessageRef = useRef<((userInput: string, attachments?: Attachment[]) => Promise<void>) | null>(null);
  const stableSendMessage = useCallback((userInput: string, attachments: Attachment[] = []) => {
    void sendMessageRef.current?.(userInput, attachments);
  }, []);

  const handleSendMessage = async (userInput: string, attachments: Attachment[] = []) => {
    if (!userInput.trim()) return;

    // Safety net: intercept slash commands typed directly without dropdown
    if (tryExecuteSlashCommand(userInput, availableCommands, handleCommandExecute)) return;

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

    // Capture a SINGLE screenshot of the current file → app-state image facet (replaces the old
    // per-chart series). Show preparing indicator so the user knows something is happening.
    setIsPreparing(true);
    const allAttachments: Attachment[] = [...attachments];
    let appStateForSend: AppState | null | undefined = appState;
    let convId = conversationID;
    try {
      // Pull handler-only state here so the component doesn't subscribe to it.
      const sendState = store.getState();
      const colorMode = sendState.ui.colorMode as 'light' | 'dark';
      const disableAppStateImages = selectDisableAppStateImages(sendState);
      appStateForSend = await appStateWithFileScreenshot(appState, colorMode, disableAppStateImages);

      // Resolve conversation — normally pre-created on mount, but fall back to inline creation
      // if the user sends before the pre-creation fetch completes (rare race condition).
      if (!convId) {
        const initRes = await fetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ firstMessage: userInput }),
        });
        const { id: newId } = await initRes.json();
        if (!newId) throw new Error('Failed to get conversation ID from server');
        convId = newId as number;
        dispatch(createConversation({ conversationID: convId, agent: 'AnalystAgent', version: 3 }));
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

    // Update agent_args with fresh appState before sending message. Inject the screenshot-bearing
    // app state (image facet) so the projection pass can render + dedup it.
    const agentArgs = buildAgentArgsForMessage(userInput, allAttachments);
    agentArgs.app_state = appStateForSend;
    dispatch(updateAgentArgs({ conversationID: convId, agent_args: agentArgs }));

    // Send message
    dispatch(sendMessage({
      conversationID: convId,
      message: userInput,
      attachments: attachments.length > 0 ? attachments : undefined,
    }));
  };
  // Keep the ref pointing at the freshest closure so stableSendMessage always
  // calls the up-to-date implementation.
  sendMessageRef.current = handleSendMessage;

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
            {conversationTitle && (
              <Text
                fontSize="sm"
                fontFamily="mono"
                fontWeight="600"
                color="fg.muted"
                truncate
                maxW="360px"
                title={conversationTitle}
              >
                {conversationTitle}
              </Text>
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
              onPromptClick={stableSendMessage}
              container={container}
              colSpan={colSpan}
              colStart={colStart}
              customPrompts={suggestedPrompts}
            />
          ) : (
            <Grid templateColumns={{ base: 'repeat(12, 1fr)', md: 'repeat(12, 1fr)' }}
                gap={2} w="100%">
            <GridItem colSpan={colSpan} colStart={colStart}>

              {viewMode === 'detailed' ? (
                (() => {
                  let lastUserLogIndex: number | undefined;
                  // Find the last TalkToUser message index so we only show suggested questions on it
                  const lastTalkToUserIdx = allMessages.reduce((acc, msg: any, idx) => msg.role === 'tool' && msg.function?.name === 'TalkToUser' ? idx : acc, -1);
                  return allMessages.map((msg, idx) => {
                    if (msg.role === 'user' && (msg as any).logIndex !== undefined) {
                      lastUserLogIndex = (msg as any).logIndex;
                    }
                    return (
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
                          userMessageLogIndex={msg.role !== 'user' ? lastUserLogIndex : undefined}
                          isLastAssistantMessage={idx === lastTalkToUserIdx}
                      />
                    );
                  });
                })()
              ) : (
                groupIntoTurns(allMessages).map((turn, turnIdx, turns) => (
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
                    isLastTurn={turnIdx === turns.length - 1}
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
                        onClick={() => dispatch(sendMessage({ conversationID, message: cfg.cta }))}>
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

      {/* Legacy (v1) chat in v2 mode: can't be continued — show history read-only
          and offer a New Chat instead of the input. */}
      {!readOnly && !loadError && isLegacyChat && (
        <HStack
          position="sticky"
          bottom={0}
          bg="bg.canvas"
          justify="center"
          py={3}
          px={4}
          gap={3}
          zIndex={10}
          borderTop="1px solid"
          borderColor="border.muted"
          fontFamily="mono"
        >
          <Text fontSize="xs">
            <Text as="span" fontWeight="semibold">Legacy chat.</Text>{' '}
            <Text as="span" color="fg.muted">Older chats can&apos;t be continued — start a new chat.</Text>
          </Text>
          <Button
            size="xs"
            bg="accent.teal"
            color="white"
            fontFamily="mono"
            aria-label="Start a new chat"
            _hover={{ bg: 'accent.teal', opacity: 0.9 }}
            onClick={handleNewChat}
            flexShrink={0}
          >
            <Icon as={LuPlus} boxSize={4} mr={1} />New Chat
          </Button>
        </HStack>
      )}

      {/* Input - Sticky at bottom (hidden in readOnly mode and for legacy chats) */}
      {!readOnly && !loadError && !needsContinueConfirmation && !isLegacyChat && (
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

          {contextSizePanel && (
            <ContextSizePanel
              state={contextSizePanel}
              onClose={closeContextSizePanel}
              colSpan={colSpan}
              colStart={colStart}
            />
          )}

{tokenLimitExceeded && !isAgentRunning && !isStreaming ? (
            <HStack aria-label="conversation too long warning" justify="center" py={2} px={4} gap={3} borderTop="1px solid" borderColor="border.muted" fontFamily="mono">
              <Text fontSize="xs"><Text as="span" fontWeight="semibold">Conversation too long.</Text>{' '}<Text as="span" color="fg.muted">Long conversations degrade agent performance. Please start a new chat.</Text></Text>
              <Button size="xs" bg="accent.teal" color="white" fontFamily="mono" _hover={{ bg: 'accent.teal', opacity: 0.9 }} onClick={handleNewChat} flexShrink={0}><Icon as={LuPlus} boxSize={4} mr={1} />New Chat</Button>
            </HStack>
          ) : (
<Box width="100%">
            <ChatInput
              onSend={stableSendMessage}
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
              availableSkills={chatSkills}
              availableCommands={availableCommands}
              onCommandExecute={handleCommandExecute}
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
