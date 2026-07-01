'use client';

import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { loadConversation, selectConversation } from '@/store/chatSlice';
import { parsePiConversation } from '@/lib/conversations-utils';
import { ConversationsAPI } from '@/lib/data/conversations';
import { derivePendingToolCalls, isAwaitingUserInput } from '@/lib/data/conversation-log';
import type { ConversationLog } from '@/orchestrator/types';
import type { LoadError } from '@/lib/types/errors';
import { createLoadErrorFromException } from '@/lib/types/errors';

/**
 * Hook for loading and caching conversations
 * Checks Redux first (cache), only fetches from database if not cached
 *
 * @param conversationId - File ID of conversation, or undefined for new conversation
 * @returns Conversation state, loading state, and error state
 */
export function useConversation(conversationId?: number) {
  const dispatch = useDispatch();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<LoadError | null>(null);
  const [attempted, setAttempted] = useState<number | null>(null);

  // Check Redux first (cache)
  const conversation = useSelector((state: any) =>
    selectConversation(state, conversationId)
  );

  // Compute derived loading state: loading if we need to fetch
  const needsToLoad = !!conversationId && !conversation && attempted !== conversationId;
  const effectiveIsLoading = isLoading || needsToLoad;

  // Only fetch if NOT in Redux and conversationId is provided
  useEffect(() => {
    async function loadFromDB() {
      // Skip if no ID, already in Redux, currently loading, or already attempted this ID
      if (!conversationId || conversation || isLoading || attempted === conversationId) {
        return;
      }

      setIsLoading(true);
      setError(null);
      setAttempted(conversationId);

      try {
        // Conversations are v3-only (dedicated rows). A 404 means it doesn't exist (or is an
        // un-migrated legacy file — run the backfill to surface it); we show a clean not-found,
        // never fall back to file-conversations.
        let v3detail = null;
        try { v3detail = await ConversationsAPI.get(conversationId); } catch { /* not found */ }
        if (!v3detail) {
          throw new Error(`Conversation ${conversationId} not found`);
        }

        const piLog = v3detail.messages.map((m) => m.content) as unknown as ConversationLog;
        const errors = v3detail.errors.map((e) => ({
          source: e.source, message: e.message,
          timestamp: Date.parse(e.createdAt) || Date.now(),
          ...(e.details ? { details: e.details } : {}),
          ...(e.parentPiId ? { parent_id: e.parentPiId } : {}),
        }));
        const { messages, agent, agent_args } = parsePiConversation(piLog, errors as never);
        // A `paused` run handed its pending tools to a browser tab. On cold load that tab is gone, so
        // only present the run as live EXECUTING when it's awaiting USER INPUT (Clarify/Navigate/…),
        // which the UI renders as a resumable prompt. A run paused on AUTO-EXECUTING tools (or with no
        // pending) is orphaned — nothing will drive it here — so load it as FINISHED instead of a
        // forever-spinning "executing" with a Stop button that reappears on every refresh.
        const paused = v3detail.conversation.runStatus === 'paused';
        const pending = paused ? derivePendingToolCalls(piLog) : [];
        const resumable = paused && isAwaitingUserInput(pending);
        dispatch(loadConversation({
          conversation: {
            _id: crypto.randomUUID(),
            conversationID: conversationId,
            log_index: piLog.length,
            messages,
            executionState: resumable ? 'EXECUTING' : 'FINISHED',
            pending_tool_calls: (resumable ? pending : []).map((p) => ({
              toolCall: { id: p.id, type: 'function' as const, function: { name: p.name, arguments: p.arguments } },
              result: undefined,
            })),
            streamedCompletedToolCalls: [],
            streamedThinking: '',
            agent,
            agent_args,
            version: 3,
            // Carry the AI-generated title from the load (free — already fetched).
            // Only the generated title; the raw first message is already a bubble.
            title: v3detail.conversation.meta?.titleGenerated && v3detail.conversation.title?.trim()
              ? v3detail.conversation.title
              : undefined,
          },
          setAsActive: false,
        }));
      } catch (err: any) {
        console.error('Failed to load conversation:', err);
        const loadError = createLoadErrorFromException(err);
        setError(loadError);
      } finally {
        setIsLoading(false);
      }
    }

    loadFromDB();
  }, [conversationId, conversation, isLoading, attempted, dispatch]);

  return {
    conversation,
    isLoading: effectiveIsLoading,
    error
  };
}
