import { createListenerMiddleware, isAnyOf } from '@reduxjs/toolkit';
import type { RootState, AppDispatch } from './store';
import {
  createConversation,
  sendMessage,
  updateConversation,
  completeToolCall,
  setError,
  selectConversation,
  selectAllToolsCompleted,
  addStreamingMessage,
  clearStreamingContent,
  interruptChat,
  setUserInputResult,
  addUserInputRequest
} from './chatSlice';
import { UserInputException } from '@/lib/api/user-input-exception';
import { generateUniqueId } from '@/lib/utils/id-generator';

// AbortController registry for managing conversation interruption
// Key is conversation._id (stable internal ID that never changes)
const abortControllers = new Map<string, AbortController>();

// API base URL - defaults to relative path in browser, absolute in Node/tests
const API_BASE_URL = typeof window === 'undefined'
  ? 'http://localhost:3000'  // Node.js test environment
  : '';  // Browser - use relative URLs

// Create listener middleware
export const chatListenerMiddleware = createListenerMiddleware();

/**
 * Call chat API with automatic fallback from streaming to non-streaming
 * Returns { success, data, error }
 */
interface ChatAPIRequest {
  conversationID: number | null;
  log_index: number;
  user_message: string | null;
  completed_tool_calls?: any[];
  agent: string;
  agent_args: any;
}

interface ChatAPIResult {
  success: boolean;
  data?: any;
  error?: string;
  usedFallback?: boolean;
}

async function callChatAPIWithFallback(
  request: ChatAPIRequest,
  abortController: AbortController,
  onStreamingEvent?: (data: any) => void
): Promise<ChatAPIResult> {
  const useStreaming = process.env.NODE_ENV !== 'test';

  // Try streaming first (if enabled)
  if (useStreaming) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: abortController.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let doneEventData: any = null;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Split on double newlines (SSE event separator)
          const events = buffer.split('\n\n');
          buffer = events.pop() || '';

          for (const eventChunk of events) {
            if (!eventChunk.trim()) continue;

            const parsed = parseSSEChunk(eventChunk);
            if (!parsed) continue;

            const { event, data } = parsed;

            if (event === 'streaming_event' && onStreamingEvent) {
              onStreamingEvent(data);
            } else if (event === 'done') {
              doneEventData = data;
            } else if (event === 'error') {
              throw new Error(data.error);
            }
          }
        }

        if (!doneEventData) {
          throw new Error('Stream ended without done event');
        }

        return { success: true, data: doneEventData };
      } finally {
        reader.releaseLock();
      }
    } catch (streamError: any) {
      // If aborted by user, don't fallback
      if (streamError.name === 'AbortError') {
        throw streamError;
      }

      console.warn('[chatListener] Streaming failed, falling back to non-streaming:', streamError.message);

      // Fall through to non-streaming fallback
    }
  }

  // Non-streaming fallback (or test mode)
  try {
    const response = await fetch(`${API_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: abortController.signal
    });

    const data = await response.json();

    if (data.error) {
      return { success: false, error: data.error };
    }

    return {
      success: true,
      data: data,
      usedFallback: useStreaming  // Only true if we fell back from streaming
    };
  } catch (fallbackError: any) {
    return {
      success: false,
      error: fallbackError.message || 'Failed to send message'
    };
  }
}

/**
 * Parse SSE chunk
 */
function parseSSEChunk(chunk: string): any | null {
  const lines = chunk.trim().split('\n');
  let event = '';
  let data = '';

  for (const line of lines) {
    if (line.startsWith('event:')) {
      event = line.substring(6).trim();
    } else if (line.startsWith('data:')) {
      data = line.substring(5).trim();
    }
  }

  if (event && data) {
    try {
      return { event, data: JSON.parse(data) };
    } catch (e) {
      console.error('Failed to parse SSE data:', e);
      return null;
    }
  }

  return null;
}

/**
 * Listen for createConversation action → Call chat API with streaming + fallback
 * Used for new conversations with the initial message
 */
chatListenerMiddleware.startListening({
  actionCreator: createConversation,
  effect: async (action, listenerApi) => {
    const { conversationID, message } = action.payload;

    // Only trigger API call if message is provided
    if (!message) return;

    const state = listenerApi.getState() as RootState;
    const conversation = selectConversation(state, conversationID);

    if (!conversation) return;

    // Create AbortController for this conversation (keyed by stable _id)
    const abortController = new AbortController();
    abortControllers.set(conversation._id, abortController);

    try {
      // Send null for negative IDs (temporary/virtual)
      const apiConversationID = conversationID < 0 ? null : conversationID;

      // Call API with automatic fallback
      const result = await callChatAPIWithFallback(
        {
          conversationID: apiConversationID,
          log_index: conversation.log_index,
          user_message: message,
          agent: conversation.agent,
          agent_args: conversation.agent_args
        },
        abortController,
        (data) => {
          // Handle streaming events
          if (data.type === 'NewConversation' || data.type === 'StreamedContent' ||
              data.type === 'ToolCreated' || data.type === 'ToolCompleted') {
            listenerApi.dispatch(addStreamingMessage(data));
          }
        }
      );

      if (!result.success) {
        listenerApi.dispatch(setError({ conversationID, error: result.error || 'Unknown error' }));
        return;
      }

      // Clear streaming content before final update
      listenerApi.dispatch(clearStreamingContent({ conversationID }));

      // Update conversation with results
      listenerApi.dispatch(updateConversation({
        conversationID,
        newConversationID: result.data.conversationID,
        log_index: result.data.log_index,
        completed_tool_calls: result.data.completed_tool_calls,
        pending_tool_calls: result.data.pending_tool_calls
      }));

      // Log fallback usage for monitoring
      if (result.usedFallback) {
        console.warn('[chatListener] Used non-streaming fallback for createConversation');
      }

    } catch (error: any) {
      // Don't show error if request was aborted (user clicked stop)
      if (error.name === 'AbortError') {
        console.log('[chatListener] Request aborted by user');
        return;
      }

      console.error('[chatListener] Error in createConversation:', error);
      listenerApi.dispatch(setError({
        conversationID,
        error: error.message || 'Failed to send message'
      }));
    } finally {
      // Clean up abort controller
      if (conversation._id) {
        abortControllers.delete(conversation._id);
      }
    }
  }
});

/**
 * Listen for sendMessage action → Call chat API with streaming + fallback
 * Used for adding messages to existing conversations
 */
chatListenerMiddleware.startListening({
  actionCreator: sendMessage,
  effect: async (action, listenerApi) => {
    const { conversationID, message } = action.payload;
    const state = listenerApi.getState() as RootState;
    const conversation = selectConversation(state, conversationID);

    if (!conversation) return;

    // Create AbortController for this conversation (keyed by stable _id)
    const abortController = new AbortController();
    abortControllers.set(conversation._id, abortController);

    try {
      // Send null for negative IDs (temporary/virtual)
      const apiConversationID = conversationID < 0 ? null : conversationID;

      // Call API with automatic fallback
      const result = await callChatAPIWithFallback(
        {
          conversationID: apiConversationID,
          log_index: conversation.log_index,
          user_message: message,
          agent: conversation.agent,
          agent_args: conversation.agent_args
        },
        abortController,
        (data) => {
          // Handle streaming events (skip if aborted)
          if (!abortController.signal.aborted) {
            listenerApi.dispatch(addStreamingMessage(data));
          }
        }
      );

      if (!result.success) {
        listenerApi.dispatch(setError({ conversationID, error: result.error || 'Unknown error' }));
        listenerApi.dispatch(clearStreamingContent({ conversationID }));
        return;
      }

      // Use real conversation ID for clearing streaming (it might have forked)
      const realConversationID = result.data.conversationID || conversationID;

      // Clear streaming state
      listenerApi.dispatch(clearStreamingContent({ conversationID: realConversationID }));

      // Update conversation with final results
      listenerApi.dispatch(updateConversation({
        conversationID,
        newConversationID: result.data.conversationID,
        log_index: result.data.log_index,
        completed_tool_calls: result.data.completed_tool_calls,
        pending_tool_calls: result.data.pending_tool_calls
      }));

      // Log fallback usage for monitoring
      if (result.usedFallback) {
        console.warn('[chatListener] Used non-streaming fallback for sendMessage');
      }

      // Cleanup AbortController (using stable _id)
      abortControllers.delete(conversation._id);

    } catch (error: any) {
      // Don't show error if request was aborted (user clicked stop)
      if (error.name === 'AbortError') {
        console.log('[chatListener] Request aborted by user');
        return;
      }

      listenerApi.dispatch(setError({
        conversationID,
        error: error.message || 'Unknown error'
      }));
      // Clear streaming state on error
      listenerApi.dispatch(clearStreamingContent({ conversationID }));
      // Cleanup AbortController (using stable _id)
      abortControllers.delete(conversation._id);
    }
  }
});

/**
 * Listen for tool completions → Continue conversation if all tools done
 */
chatListenerMiddleware.startListening({
  actionCreator: completeToolCall,
  effect: async (action, listenerApi) => {
    const { conversationID } = action.payload;
    const state = listenerApi.getState() as RootState;
    const conversation = selectConversation(state, conversationID);

    if (!conversation) return;
    if (conversation.executionState !== 'EXECUTING') return;

    // Check if all tools completed
    const allCompleted = selectAllToolsCompleted(state, conversationID);
    if (!allCompleted) return;

    // Get or create AbortController for this conversation (keyed by stable _id)
    let abortController = abortControllers.get(conversation._id);
    if (!abortController) {
      abortController = new AbortController();
      abortControllers.set(conversation._id, abortController);
    }

    try {
      // All tools done - send results to backend
      const completed_tool_calls = conversation.pending_tool_calls.map(p => [
        p.toolCall,
        p.result!
      ]);

      // Call API with automatic fallback
      const result = await callChatAPIWithFallback(
        {
          conversationID,
          log_index: conversation.log_index,
          user_message: null,
          completed_tool_calls,
          agent: conversation.agent,
          agent_args: conversation.agent_args
        },
        abortController,
        (data) => {
          // Handle streaming events (skip if aborted)
          if (!abortController.signal.aborted) {
            listenerApi.dispatch(addStreamingMessage(data));
          }
        }
      );

      if (!result.success) {
        listenerApi.dispatch(setError({ conversationID, error: result.error || 'Unknown error' }));
        listenerApi.dispatch(clearStreamingContent({ conversationID }));
        return;
      }

      // Use real conversation ID for clearing streaming (it might have forked)
      const realConversationID = result.data.conversationID || conversationID;

      // Clear streaming state
      listenerApi.dispatch(clearStreamingContent({ conversationID: realConversationID }));

      // Update conversation with final results
      listenerApi.dispatch(updateConversation({
        conversationID,
        newConversationID: result.data.conversationID,
        log_index: result.data.log_index,
        completed_tool_calls: result.data.completed_tool_calls,
        pending_tool_calls: result.data.pending_tool_calls
      }));

      // Log fallback usage for monitoring
      if (result.usedFallback) {
        console.warn('[chatListener] Used non-streaming fallback for completeToolCall');
      }

      // Cleanup AbortController (using stable _id)
      abortControllers.delete(conversation._id);

    } catch (error: any) {
      // Don't show error if request was aborted (user clicked stop)
      if (error.name === 'AbortError') {
        console.log('[chatListener] Request aborted by user');
        return;
      }

      listenerApi.dispatch(setError({
        conversationID,
        error: error.message || 'Unknown error'
      }));
      // Clear streaming state on error
      listenerApi.dispatch(clearStreamingContent({ conversationID }));
      // Cleanup AbortController (using stable _id)
      abortControllers.delete(conversation._id);
    }
  }
});

/**
 * Listen for updateConversation OR setUserInputResult → Execute frontend tools automatically
 * Uses isAnyOf to avoid code duplication
 */
chatListenerMiddleware.startListening({
  matcher: isAnyOf(updateConversation, setUserInputResult),
  effect: async (action: any, listenerApi) => {
    const conversationID = action.payload.conversationID;
    const state = listenerApi.getState() as RootState;
    const conversation = selectConversation(state, conversationID);

    if (!conversation) return;

    const realConversationID = conversation.forkedConversationID || conversationID;

    // If forked, get the real conversation
    const realConversation = realConversationID !== conversationID
      ? selectConversation(state, realConversationID)
      : conversation;

    if (!realConversation) return;

    // Execute all pending tools automatically
    for (const pendingTool of realConversation.pending_tool_calls) {
      // Skip if already completed
      if (pendingTool.result) continue;

      // Skip if waiting for user input
      const hasIncompleteUserInputs = pendingTool.userInputs?.some(
        ui => ui.result === undefined
      );
      if (hasIncompleteUserInputs) {
        console.log(`[chatListener] Tool ${pendingTool.toolCall.id} waiting for user input`);
        continue;
      }

      try {
        console.log(`[chatListener] Executing tool: ${pendingTool.toolCall.function.name}`);

        // Dynamic import to avoid circular dependencies
        const { executeToolCall } = await import('@/lib/api/tool-handlers');

        // Get database and pageDetails from agent_args
        const { connection_id, file_id, page_type } = conversation.agent_args;
        const database = {
          databaseName: connection_id,
          schemas: conversation.agent_args.schema || []
        };

        // Get current Redux state for tools that need it
        const state = listenerApi.getState() as RootState;

        // Execute tool with user inputs in context
        const result = await executeToolCall(
          pendingTool.toolCall,
          database,
          listenerApi.dispatch as AppDispatch,
          undefined,  // signal
          state,  // Redux state
          pendingTool.userInputs  // User inputs for this tool
        );

        // Mark as completed (add created_at timestamp)
        listenerApi.dispatch(completeToolCall({
          conversationID: realConversationID,
          tool_call_id: pendingTool.toolCall.id,
          result: {
            ...result,
            created_at: new Date().toISOString()
          } as any
        }));

      } catch (error: any) {
        // Check if tool is requesting user input
        if (error instanceof UserInputException) {
          console.log(`[chatListener] Tool requests user input:`, error.props);

          // Add user input request to Redux
          listenerApi.dispatch(addUserInputRequest({
            conversationID: realConversationID,
            tool_call_id: pendingTool.toolCall.id,
            userInput: {
              id: generateUniqueId(),
              props: error.props,
              result: undefined,
              providedAt: undefined
            }
          }));
        } else {
          // Other error - mark tool as failed
          console.error(`[chatListener] Tool execution failed:`, error);
          listenerApi.dispatch(completeToolCall({
            conversationID: realConversationID,
            tool_call_id: pendingTool.toolCall.id,
            result: {
              role: 'tool',
              tool_call_id: pendingTool.toolCall.id,
              content: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : String(error)
              }),
              created_at: new Date().toISOString()
            }
          }));
        }
      }
    }
  }
});

/**
 * Listen for interruptChat action → Abort active conversation
 */
chatListenerMiddleware.startListening({
  actionCreator: interruptChat,
  effect: async (action, listenerApi) => {
    const { conversationID } = action.payload;
    const state = listenerApi.getState() as RootState;
    const conversation = selectConversation(state, conversationID);

    if (!conversation) {
      console.warn(`[interruptChat] Conversation ${conversationID} not found`);
      return;
    }

    // Get AbortController by stable _id (works regardless of conversationID changes)
    const abortController = abortControllers.get(conversation._id);

    if (abortController) {
      console.log(`[interruptChat] Aborting conversation ${conversationID} (_id: ${conversation._id})`);
      abortController.abort();
    } else {
      console.warn(`[interruptChat] No AbortController found for conversation ${conversationID}`);
    }
  }
});
