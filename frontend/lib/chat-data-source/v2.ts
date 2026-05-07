// V=2 chat data source — wraps `chatV2Slice` + `chatV2LogToMessages` to
// produce the same `chatSlice.Conversation` shape ChatInterface consumes.
//
// Bootstrap: send() POSTs `/api/chat/v2/new` if no chatId yet, then dispatches
// `sendChatV2Message`. The chatV2Listener handles the rest (streaming via
// XHR, executing the bridge for frontend tool calls, replacing the log on
// `done`). Streaming events overlay onto the rendered messages via the
// normalizer's `streamingEvents` argument.

'use client';

import { useCallback, useEffect, useMemo } from 'react';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { useFile } from '@/lib/hooks/file-state-hooks';
import {
  loadChatV2,
  selectChatV2,
  sendChatV2Message,
  setActiveChat,
} from '@/store/chatV2Slice';
import {
  chatV2LogToMessages,
  chatV2TotalTokens,
} from '@/lib/chat-v2/log-to-messages';
import type {
  ConversationLog,
  ConversationLogEntry,
  PendingToolCall,
  StreamEvent,
} from '@/orchestrator/types';
import type { Conversation } from '@/store/chatSlice';
import type { Attachment } from '@/lib/types';
import { useRouter } from '@/lib/navigation/use-navigation';
import { preserveParams } from '@/lib/navigation/url-utils';
import { useClearChat } from '@/components/explore/slash-commands';
import type { ChatDataSource } from './types';

interface ChatFileContent {
  log: ConversationLog;
}

const TOKEN_LIMIT = 250_000;

/**
 * Returns a `ChatDataSource` backed by the chatV2 slice. `fileId === undefined`
 * means we're on a new-chat (draft) surface — `send()` will POST
 * `/api/chat/v2/new` to create the file before dispatching the message.
 */
export function useV2ChatData(
  fileId: number | undefined,
  options?: { enabled?: boolean },
): ChatDataSource {
  const enabled = options?.enabled ?? true;
  const dispatch = useAppDispatch();
  const router = useRouter();
  const numericId = fileId ?? 0;
  // Skip useFile when there's no file id (new chat at /explore?v=2) — loading
  // file id 0 would 404. Pass `skip: true` so the hook is a no-op.
  const { fileState: file } = useFile(numericId > 0 ? numericId : undefined, {
    skip: numericId <= 0,
  }) ?? {};

  const chatState = useAppSelector((s) => selectChatV2(s, numericId));

  // Hydrate the slice from the file content on first load — same pattern
  // ChatV2Container had previously.
  useEffect(() => {
    if (!enabled) return;
    if (file && !file.loading && numericId > 0) {
      const content = file.content as unknown as ChatFileContent | undefined;
      if (content?.log) {
        dispatch(loadChatV2({ chatId: numericId, log: content.log }));
        dispatch(setActiveChat({ chatId: numericId }));
      }
    }
  }, [file, numericId, dispatch, enabled]);

  const log: ConversationLog =
    chatState?.log ?? (file?.content as unknown as ChatFileContent | undefined)?.log ?? [];
  const streamingEvents: StreamEvent[] = chatState?.streamingEvents ?? [];
  const executionState = chatState?.executionState ?? 'idle';
  const error = chatState?.error;

  // Map v=2 executionState → legacy executionState union the renderer expects.
  // Renderer treats WAITING/EXECUTING/STREAMING as "agent busy"; FINISHED idle.
  const legacyExecutionState: Conversation['executionState'] =
    executionState === 'running'
      ? 'STREAMING'
      : executionState === 'pending'
        ? 'EXECUTING'
        : executionState === 'error'
          ? 'FINISHED'
          : executionState === 'finished'
            ? 'FINISHED'
            : 'FINISHED';

  // Render-time normalization — streaming events overlay onto the log so
  // mid-turn partial assistant text appears in the message stream.
  const messages = useMemo(
    () => chatV2LogToMessages(log, streamingEvents),
    [log, streamingEvents],
  );

  // Map v=2 pending tool calls to the chatSlice shape so ToolCallDisplay's
  // pending-user-input handling continues to work (it reads
  // conversation.pending_tool_calls.toolCall.id).
  const pendingToolCalls = useMemo(() => {
    const v2pending: PendingToolCall[] = chatState?.pendingToolCalls ?? [];
    return v2pending.map((p) => ({
      toolCall: {
        id: p.id,
        type: 'function' as const,
        function: { name: p.name, arguments: p.parameters },
      },
      result: undefined,
      userInputs: undefined,
    }));
  }, [chatState?.pendingToolCalls]);

  const conversation: Conversation | undefined = useMemo(() => {
    if (numericId <= 0) return undefined;
    return {
      _id: `chatv2-${numericId}`,
      conversationID: numericId,
      log_index: log.length,
      executionState: legacyExecutionState,
      messages: messages as Conversation['messages'],
      pending_tool_calls: pendingToolCalls,
      agent: 'WebAnalystAgent',
      // v=2 doesn't use agent_args — the AgentInvocation arguments and the
      // server-side setupOrchestration carry equivalent context. Empty object
      // keeps the renderer happy (it only reads agent_args.app_state for the
      // continue-chat banner, which v=2 doesn't surface).
      agent_args: {},
      streamedCompletedToolCalls: [],
      streamedThinking: '',
      queuedMessages: [],
      wasInterrupted: false,
      active: true,
      ...(error ? { error } : {}),
    };
  }, [numericId, log.length, legacyExecutionState, messages, pendingToolCalls, error]);

  // Capabilities — v=2 doesn't have queue/interrupt/editAndFork yet, but it
  // does compute a token-limit warning from log-derived usage.
  const tokenLimitExceeded = useMemo(() => chatV2TotalTokens(log) > TOKEN_LIMIT, [log]);
  void tokenLimitExceeded; // surfaced via conversation.executionState in future

  const clearChat = useClearChat();

  const send = useCallback(
    async ({
      message,
    }: {
      message: string;
      attachments?: Attachment[];
      // v=2 ignores legacy agentArgs — context is built server-side from the
      // user's effective whitelist + context docs.
      agentArgs?: Record<string, unknown>;
    }) => {
      let chatId = numericId;
      if (!chatId) {
        const res = await fetch('/api/chat/v2/new', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        if (!res.ok) throw new Error(`/api/chat/v2/new failed: ${res.status}`);
        const data = (await res.json()) as { chatId: number; error?: string };
        if (!data.chatId) throw new Error(data.error ?? 'no chatId returned');
        chatId = data.chatId;
        // Navigate before dispatching so the chat-detail surface mounts and
        // subscribes to streamingEvents in time.
        router.push(preserveParams(`/explore/${chatId}`));
      }
      dispatch(sendChatV2Message({ chatId, message }));
    },
    [dispatch, numericId, router],
  );

  const newChat = useCallback(() => {
    clearChat();
    router.push(preserveParams('/explore'));
  }, [clearChat, router]);

  return useMemo<ChatDataSource>(
    () => ({
      conversation,
      isLoading: !!file?.loading,
      loadError: undefined,
      conversationID: numericId > 0 ? numericId : undefined,
      isNewConversation: !fileId,
      capabilities: {
        queueMessages: false,
        interrupt: false,
        editAndFork: false,
        setActive: false,
        contextSelector: false,
        databaseSelector: false,
        slashCommands: false,
        skillMentions: false,
        fork: false,
        agentArgs: false,
      },
      send,
      newChat,
    }),
    [conversation, file?.loading, numericId, send, newChat],
  );
}

// Helper for projecting v=2 streaming events into rendered messages outside
// of the data source — used by tests and any caller that wants the raw view.
export { chatV2LogToMessages };
export type { ConversationLog, ConversationLogEntry };
