'use client';

import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { loadConversation, selectConversation } from '@/store/chatSlice';
import { parseLogToMessages, parsePiConversation } from '@/lib/conversations-utils';
import { FilesAPI } from '@/lib/data/files';
import { ConversationsAPI } from '@/lib/data/conversations';
import { derivePendingToolCalls } from '@/lib/data/conversation-log';
import type { ConversationFileContent, TaskLogEntry } from '@/lib/types';
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
        // Chat v3: conversations are dedicated rows. Try the v3 endpoint first; a 404 means this is
        // an old v1/v2 file-conversation, so fall back to FilesAPI below.
        let v3detail = null;
        try { v3detail = await ConversationsAPI.get(conversationId); } catch { /* not a v3 conversation */ }
        if (v3detail) {
          const piLog = v3detail.messages.map((m) => m.content) as unknown as ConversationLog;
          const errors = v3detail.errors.map((e) => ({
            source: e.source, message: e.message,
            timestamp: Date.parse(e.createdAt) || Date.now(),
            ...(e.details ? { details: e.details } : {}),
            ...(e.parentPiId ? { parent_id: e.parentPiId } : {}),
          }));
          const { messages, agent, agent_args } = parsePiConversation(piLog, errors as never);
          const paused = v3detail.conversation.runStatus === 'paused';
          const pending = paused ? derivePendingToolCalls(piLog) : [];
          dispatch(loadConversation({
            conversation: {
              _id: crypto.randomUUID(),
              conversationID: conversationId,
              log_index: piLog.length,
              messages,
              executionState: paused ? 'EXECUTING' : 'FINISHED',
              pending_tool_calls: pending.map((p) => ({
                toolCall: { id: p.id, type: 'function' as const, function: { name: p.name, arguments: p.arguments } },
                result: undefined,
              })),
              streamedCompletedToolCalls: [],
              streamedThinking: '',
              agent,
              agent_args,
              version: 3,
            },
            setAsActive: false,
          }));
          setIsLoading(false);
          return;
        }

        // Fetch file from database via FilesAPI
        const result = await FilesAPI.loadFile(conversationId);

        if (!result.data || !result.data.content) {
          throw new Error('Conversation content is missing');
        }

        const content = result.data.content as ConversationFileContent;

        // File version from meta: 2 = v2 (JS engine), absent = legacy v1 (→ 1).
        // Drives the "legacy chat can't be continued" UI (isLegacyChatInV2).
        const version = (result.data.meta as { version?: number } | null | undefined)?.version ?? 1;

        // v2 conversations are served as the orchestrator pi ConversationLog (no read-path
        // down-translation); parse them pi-natively. v1 stays on the legacy task-log parse.
        let messages: any[];
        let agent: string;
        let agent_args: Record<string, any>;
        if (version >= 2) {
          ({ messages, agent, agent_args } = parsePiConversation(content.log as unknown as ConversationLog));
        } else {
          messages = parseLogToMessages(content.log);
          const firstTask = content.log.find((entry): entry is TaskLogEntry => entry._type === 'task');
          agent = firstTask?.agent || 'DefaultAgent';
          agent_args = (firstTask?.args as Record<string, any>) || {};
        }

        // Dispatch to Redux for caching
        dispatch(loadConversation({
          conversation: {
            _id: crypto.randomUUID(),  // Generate stable internal ID
            conversationID: conversationId,
            log_index: content.log.length,
            messages,
            executionState: 'FINISHED',
            pending_tool_calls: [],
            streamedCompletedToolCalls: [],
            streamedThinking: '',
            agent,
            agent_args,
            version,
          },
          setAsActive: false  // Don't activate when loading from URL
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
