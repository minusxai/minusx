// Legacy chat data source — wraps `useConversation` + `chatSlice` selectors +
// existing dispatch actions into the `ChatDataSource` contract.
//
// This is a passthrough: it MUST preserve current behavior bit-for-bit. The
// goal is to give ChatInterface a single object to consume so the v=2 source
// (`v2.ts`) can be swapped in without touching the render code.

'use client';

import { useCallback, useEffect, useMemo } from 'react';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import {
  selectOptionalConversation,
  selectActiveConversation,
  createConversation,
  sendMessage,
  queueMessage,
  clearQueuedMessages,
  updateAgentArgs,
  interruptChat,
  setActiveConversation,
  editAndForkMessage,
} from '@/store/chatSlice';
import { useConversation } from '@/lib/hooks/useConversation';
import { useClearChat } from '@/components/explore/slash-commands';
import type { Attachment } from '@/lib/types';
import type { ChatDataSource } from './types';

/**
 * Returns a `ChatDataSource` backed by the legacy chat slice. Handles the full
 * conversation resolution — useConversation lookup, fork-follow chain,
 * active-conversation fallback, and the `/api/chat/init` pre-create dance —
 * so ChatInterface just consumes the result.
 */
export function useLegacyChatData(
  conversationId: number | undefined,
  options?: { enabled?: boolean },
): ChatDataSource {
  // When `enabled === false`, this hook is a no-op shell — useful when both
  // adapters must be called for rules-of-hooks but only one is active.
  const enabled = options?.enabled ?? true;
  const dispatch = useAppDispatch();
  const { conversation: loadedConversation, isLoading, error: loadError } = useConversation(conversationId);

  // Fork-follow chain: walks `forkedConversationID` from the loaded
  // conversation forward (mirrors ChatInterface's prior logic verbatim).
  const conversations = useAppSelector((state) => state.chat.conversations);
  const forkFollowedConversation = useMemo(() => {
    if (!conversationId || !loadedConversation) return null;
    let conv = loadedConversation;
    while (conv?.forkedConversationID) {
      conv = conversations[conv.forkedConversationID] || conv;
    }
    return conv;
  }, [conversationId, loadedConversation, conversations]);

  // Active-conversation fallback for new sessions (no providedConversationId).
  const activeConversationId = useAppSelector(selectActiveConversation);
  const activeConversation = useAppSelector((state) =>
    activeConversationId ? state.chat.conversations[activeConversationId] : undefined,
  );

  // When loading an existing conversation, don't fall back to the active
  // conversation (the fork-follow useEffect would redirect away mid-load).
  const conversation = conversationId
    ? forkFollowedConversation ?? undefined
    : (forkFollowedConversation ?? activeConversation);

  // Live conversation in case the resolved object came from useConversation
  // (DB) — the live Redux entry has streaming/queue state.
  const liveConversationID = conversation?.conversationID;
  const liveConversation = useAppSelector((s) =>
    liveConversationID ? selectOptionalConversation(s, liveConversationID) : undefined,
  );
  const finalConversation = liveConversation ?? conversation ?? undefined;
  const conversationID = finalConversation?.conversationID;

  // Pre-create a conversation on mount when this is a new session — sends go
  // directly to the existing path. Mirrors ChatInterface's prior useEffect.
  const isNewConversation = !conversationId;
  useEffect(() => {
    if (!enabled) return;
    if (!isNewConversation) return;
    if (activeConversationId) return; // already have one
    let cancelled = false;
    fetch('/api/chat/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled || !data.conversationID) return;
        dispatch(createConversation({ conversationID: data.conversationID, agent: 'AnalystAgent' }));
      })
      .catch((err) => console.error('[chat-data-source/legacy] pre-create failed:', err));
    return () => {
      cancelled = true;
    };
  }, [dispatch, isNewConversation, activeConversationId, enabled]);

  const clearChat = useClearChat();

  const send = useCallback(
    async ({
      message,
      attachments,
      agentArgs,
    }: {
      message: string;
      attachments?: Attachment[];
      agentArgs?: Record<string, unknown>;
    }) => {
      let convId = conversationID;
      if (!convId) {
        // Inline pre-create fallback (race: user sends before pre-create resolves).
        const initRes = await fetch('/api/chat/init', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ firstMessage: message }),
        });
        const { conversationID: newId } = (await initRes.json()) as { conversationID?: number };
        if (!newId) throw new Error('Failed to get conversation ID from server');
        convId = newId;
        dispatch(createConversation({ conversationID: convId, agent: 'AnalystAgent' }));
      }
      if (agentArgs) dispatch(updateAgentArgs({ conversationID: convId, agent_args: agentArgs }));
      dispatch(sendMessage({ conversationID: convId, message, attachments }));
    },
    [dispatch, conversationID],
  );

  const stop = useCallback(() => {
    if (conversationID !== undefined) dispatch(interruptChat({ conversationID }));
  }, [dispatch, conversationID]);

  const newChat = useCallback(() => {
    clearChat();
  }, [clearChat]);

  const queue = useCallback(
    ({ message, attachments }: { message: string; attachments?: Attachment[] }) => {
      if (conversationID === undefined) return;
      dispatch(queueMessage({ conversationID, message, attachments }));
    },
    [dispatch, conversationID],
  );

  const clearQueue = useCallback(() => {
    if (conversationID !== undefined) dispatch(clearQueuedMessages({ conversationID }));
  }, [dispatch, conversationID]);

  const editAndFork = useCallback(
    ({ logIndex, message }: { logIndex: number; message: string }) => {
      if (conversationID === undefined) return;
      dispatch(editAndForkMessage({ conversationID, logIndex, message }));
    },
    [dispatch, conversationID],
  );

  const setActive = useCallback(() => {
    if (conversationID !== undefined) dispatch(setActiveConversation(conversationID));
  }, [dispatch, conversationID]);

  return useMemo<ChatDataSource>(
    () => ({
      conversation: finalConversation,
      isLoading,
      loadError,
      conversationID,
      isNewConversation,
      capabilities: {
        queueMessages: true,
        interrupt: true,
        editAndFork: true,
        setActive: true,
        contextSelector: true,
        databaseSelector: true,
        slashCommands: true,
        skillMentions: true,
        fork: true,
        agentArgs: true,
      },
      send,
      stop,
      newChat,
      queue,
      clearQueue,
      editAndFork,
      setActive,
    }),
    [
      finalConversation,
      isLoading,
      loadError,
      conversationID,
      isNewConversation,
      send,
      stop,
      newChat,
      queue,
      clearQueue,
      editAndFork,
      setActive,
    ],
  );
}
