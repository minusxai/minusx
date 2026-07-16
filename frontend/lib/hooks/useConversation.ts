'use client';

import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { loadConversation, selectConversation, setRemoteSession, setUserInputResult } from '@/store/chatSlice';
import { selectDevMode } from '@/store/uiSlice';
import { parsePiConversation } from '@/lib/conversations-utils';
import { loadConversationDetail } from '@/store/conversation-log-cache';
import { derivePendingToolCalls, isColdReopenResumable } from '@/lib/data/conversation-log';
import { clearStaleClarifyAnswers, seedPendingClarifyInputs } from '@/lib/chat/clarify-answer-stash';
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
  // Conversations V2 (/conversations-v2.md): non-dev loads get the slim display view;
  // dev mode loads the verbatim log (per-turn appState for the inspector, full tool I/O).
  const devMode = useSelector(selectDevMode);

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
        try { v3detail = await loadConversationDetail(conversationId, devMode ? 'full' : 'display'); } catch { /* not found */ }
        if (!v3detail) {
          throw new Error(`Conversation ${conversationId} not found`);
        }

        const piLog = v3detail.piLog as ConversationLog;
        const errors = v3detail.errors.map((e) => ({
          source: e.source, message: e.message,
          timestamp: Date.parse(e.createdAt) || Date.now(),
          ...(e.details ? { details: e.details } : {}),
          ...(e.parentPiId ? { parent_id: e.parentPiId } : {}),
        }));
        const { messages, agent, agent_args } = parsePiConversation(piLog, errors as never);
        // A `paused` run handed its pending tools to a browser tab. On cold load that tab is gone, so
        // only present the run as live EXECUTING when it's paused on a Clarify (a pure question we can
        // re-surface as an answerable prompt). Everything else — auto-executing tools (nothing will
        // drive them) AND side-effectful confirmations like Navigate/PublishAll (a stale "Allow?"/
        // "Publish?" must not re-appear on an old chat) — loads as FINISHED, so there's no phantom Stop
        // button spinning forever on a reopened chat. See isColdReopenResumable.
        const paused = v3detail.conversation.runStatus === 'paused';
        const pending = paused ? derivePendingToolCalls(piLog) : [];
        const resumable = paused && isColdReopenResumable(pending);
        const pendingList = resumable ? pending : [];

        // Drop stale Clarify stashes (committed / expired) for this conversation before reading them.
        clearStaleClarifyAnswers(conversationId, new Set(pendingList.map((p) => p.id)));

        // A cold-loaded pending tool has no `userInputs`, so a reopened Clarify would render a DEAD
        // "Waiting for response…" card (unanswerable). seedPendingClarifyInputs seeds a userInputs
        // entry from the tool args so the prompt is answerable again, and — if the user had already
        // answered before the reload (stashed client-side) — carries that answer + queues it for replay
        // so the run auto-resumes instead of re-asking. ClarifyFrontend only: replaying Navigate/
        // PublishAll would fire side effects (router.push / publish modal) on reopen.
        const { pendingToolCalls, replays } = seedPendingClarifyInputs(conversationId, pendingList, () => crypto.randomUUID());

        dispatch(loadConversation({
          conversation: {
            _id: crypto.randomUUID(),
            conversationID: conversationId,
            log_index: piLog.length,
            messages,
            executionState: resumable ? 'EXECUTING' : 'FINISHED',
            pending_tool_calls: pendingToolCalls as never,
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

        // Remote Agent Session in progress (this tab may be a refresh / a second tab): re-raise the
        // flag, which hard-freezes the input and starts the observer stream (banner, live remote
        // activity, frontend-tool execution). See REMOTE_AGENT_SESSIONS.md §9.4 E6.
        if (v3detail.conversation.runStatus === 'remote') {
          dispatch(setRemoteSession({
            conversationID: conversationId,
            active: true,
            ...(v3detail.conversation.meta?.remoteSession?.expiresAt
              ? { expiresAt: v3detail.conversation.meta.remoteSession.expiresAt as string }
              : {}),
          }));
        }

        // Kick the auto-exec listener for any replayed answers: setUserInputResult fires the listener
        // (loadConversation does not), which re-runs ClarifyFrontend with the seeded result → resumes
        // the turn → server commits the toolResult. clearStaleClarifyAnswers drops the stash next load.
        for (const r of replays) {
          dispatch(setUserInputResult({ conversationID: conversationId, tool_call_id: r.toolCallId, userInputId: r.userInputId, result: r.result }));
        }
      } catch (err: any) {
        console.error('Failed to load conversation:', err);
        const loadError = createLoadErrorFromException(err);
        setError(loadError);
      } finally {
        setIsLoading(false);
      }
    }

    loadFromDB();
  }, [conversationId, conversation, isLoading, attempted, dispatch, devMode]);

  return {
    conversation,
    isLoading: effectiveIsLoading,
    error
  };
}
