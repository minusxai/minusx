'use client';

import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { loadConversation, selectConversation } from '@/store/chatSlice';
import { parseLogToMessages } from '@/lib/conversations-client';
import { FilesAPI } from '@/lib/data/files';
import type { ConversationFileContent, ConversationLogEntry, TaskLogEntry } from '@/lib/types';
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
        // Fetch file from database via FilesAPI
        const result = await FilesAPI.loadFile(conversationId);

        if (!result.data || !result.data.content) {
          throw new Error('Conversation content is missing');
        }

        const content = result.data.content as ConversationFileContent;

        // Parse log into messages
        const messages = parseLogToMessages(content.log);

        // Extract agent and agent_args from first task in log
        const firstTask = content.log.find((entry): entry is TaskLogEntry => entry._type === 'task');
        const agent = firstTask?.agent || 'DefaultAgent';
        const agent_args = firstTask?.args || {};

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
            agent,
            agent_args
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
