import { createListenerMiddleware, isAnyOf } from '@reduxjs/toolkit';
import { IS_TEST } from '@/lib/constants';
import type { RootState, AppDispatch } from './store';
import {
  createConversation,
  sendMessage,
  queueMessage,
  clearQueuedMessages,
  flushQueuedMessages,
  editAndForkMessage,
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
import { selectAllowChatQueue, selectQueueStrategy } from './uiSlice';
import { UserInputException } from '@/lib/api/user-input-exception';
import { generateUniqueId } from '@/lib/utils/id-generator';
import { captureError } from '@/lib/messaging/capture-error';

// AbortController registry for managing conversation interruption
// Key is conversation._id (stable internal ID that never changes)
// eslint-disable-next-line no-restricted-syntax -- client-side Redux listener; AbortControllers are ephemeral, no data leakage
const abortControllers = new Map<string, AbortController>();

// API base URL - defaults to relative path in browser, absolute in Node/tests
const API_BASE_URL = typeof window === 'undefined'
  ? 'http://localhost:3000'  // Node.js test environment
  : '';  // Browser - use relative URLs

// Create listener middleware
export const chatListenerMiddleware = createListenerMiddleware();

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
 * Listen for createConversation action → Call /api/chat/stream (with SSE) or /api/chat (in tests)
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

    // Use non-streaming endpoint in test environment for simplicity
    const useStreaming = !IS_TEST;

    try {
      // In test env, negative IDs signal a new conversation — send null so the API creates it
      const testConversationID = !useStreaming && conversationID < 0 ? null : conversationID;

      if (!useStreaming) {
        // Non-streaming path (for tests)
        const response = await fetch(`${API_BASE_URL}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversationID: testConversationID,
            log_index: conversation.log_index,
            user_message: message,
            agent: conversation.agent,
            agent_args: conversation.agent_args
          }),
          signal: abortController.signal
        });

        const data = await response.json();

        if (data.error) {
          listenerApi.dispatch(setError({ conversationID, error: data.error }));
          return;
        }

        // Update conversation with results
        listenerApi.dispatch(updateConversation({
          conversationID,
          newConversationID: data.conversationID,
          log_index: data.log_index,
          completed_tool_calls: data.completed_tool_calls,
          pending_tool_calls: data.pending_tool_calls,
          debug: data.debug,
          request_id: data.request_id,
        }));
        return;
      }

      // Streaming path (production) — conversationID is always a real positive ID
      const response = await fetch(`${API_BASE_URL}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationID,
          log_index: conversation.log_index,
          user_message: message,
          agent: conversation.agent,
          agent_args: conversation.agent_args
        }),
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
      let errorData: any = null;

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

            if (event === 'streaming_event') {
              if (data.type === 'StreamedContent') {
                console.log('[chatListener] Dispatching StreamedContent at', Date.now());
              }
              listenerApi.dispatch(addStreamingMessage(data));
              // Yield to the macrotask queue so React 18 can render each chunk
              // progressively. Without this, React batches all streaming dispatches
              // (microtask context) and renders everything at once after the stream ends.
              if (data.type === 'StreamedContent') {
                await new Promise<void>(resolve => setTimeout(resolve, 0));
                console.log('[chatListener] Resumed after setTimeout at', Date.now());
              }
            } else if (event === 'done') {
              doneEventData = data;
            } else if (event === 'error') {
              errorData = data;
            } else if (event === 'user_input_request') {
              listenerApi.dispatch(addUserInputRequest({
                conversationID,
                tool_call_id: data.tool_call_id,
                userInput: data.user_input
              }));
            }
          }
        }

        // Handle done event after stream completes
        if (doneEventData) {
          const realConversationID = doneEventData.conversationID || conversationID;
          listenerApi.dispatch(clearStreamingContent({ conversationID: realConversationID }));
          listenerApi.dispatch(updateConversation({
            conversationID,
            newConversationID: doneEventData.conversationID,
            log_index: doneEventData.log_index,
            completed_tool_calls: doneEventData.completed_tool_calls,
            pending_tool_calls: doneEventData.pending_tool_calls,
            debug: doneEventData.debug,
          }));
        }

        if (errorData) {
          throw new Error(errorData.error);
        }
      } finally {
        reader.releaseLock();
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('[chatListener] Request aborted by user');
        return;
      }

      console.error('[chatListener] Error in createConversation:', error);
      void captureError('chatListener:createConversation', error, { conversationID: String(conversationID) });
      listenerApi.dispatch(setError({
        conversationID,
        error: error.message || 'Failed to send message'
      }));
    } finally {
      if (conversation._id) {
        abortControllers.delete(conversation._id);
      }
    }
  }
});

/**
 * Listen for sendMessage action → Call /api/chat/stream (with SSE) or /api/chat (in tests)
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

    // Use non-streaming endpoint in test environment for simplicity
    const useStreaming = !IS_TEST;

    try {
      // In test env, negative IDs signal a new conversation — send null so the API creates it
      const testConversationID = !useStreaming && conversationID < 0 ? null : conversationID;

      if (!useStreaming) {
        // Non-streaming path (for tests)
        const response = await fetch(`${API_BASE_URL}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversationID: testConversationID,
            log_index: conversation.log_index,
            user_message: message,
            agent: conversation.agent,
            agent_args: conversation.agent_args
          }),
          signal: abortController.signal
        });

        const data = await response.json();

        if (data.error) {
          listenerApi.dispatch(setError({ conversationID, error: data.error }));
          return;
        }

        // Update conversation with results
        listenerApi.dispatch(updateConversation({
          conversationID,
          newConversationID: data.conversationID,
          log_index: data.log_index,
          completed_tool_calls: data.completed_tool_calls,
          pending_tool_calls: data.pending_tool_calls,
          debug: data.debug,
          request_id: data.request_id,
        }));
        return;
      }

      // Streaming path (production) — conversationID is always a real positive ID

      const response = await fetch(`${API_BASE_URL}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationID,
          log_index: conversation.log_index,
          user_message: message,
          agent: conversation.agent,
          agent_args: conversation.agent_args
        }),
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
      let errorData: any = null;

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

            switch (event) {
              case 'streaming_event':
                // Skip streaming events if aborted
                if (abortController.signal.aborted) {
                  console.log('[sendMessage] Skipping streaming event - aborted');
                  break;
                }

                // Dispatch streaming event to build streamedCompletedToolCalls
                if (data.type === 'StreamedContent') {
                  console.log('[chatListener] Dispatching StreamedContent at', Date.now());
                }
                listenerApi.dispatch(addStreamingMessage(data));
                // Yield to the macrotask queue so React 18 can render each chunk
                // progressively. Without this, React batches all streaming dispatches
                // (microtask context) and renders everything at once after the stream ends.
                if (data.type === 'StreamedContent') {
                  await new Promise<void>(resolve => setTimeout(resolve, 0));
                  console.log('[chatListener] Resumed after setTimeout at', Date.now());
                }
                break;

              case 'done':
                // Always process done event (for cleanup)
                doneEventData = data;
                break;

              case 'error':
                // Save error but continue reading to get done event
                errorData = data;
                break;

              default:
                console.warn('Unknown SSE event:', event);
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      // Process done event if we have it
      if (doneEventData) {
        // Use real conversation ID for clearing streaming (it might have forked)
        const realConversationID = doneEventData.conversationID || conversationID;

        // Clear streaming state on the correct conversation
        listenerApi.dispatch(clearStreamingContent({ conversationID: realConversationID }));

        // Update conversation with final results
        listenerApi.dispatch(updateConversation({
          conversationID,
          newConversationID: doneEventData.conversationID,
          log_index: doneEventData.log_index,
          completed_tool_calls: doneEventData.completed_tool_calls,
          pending_tool_calls: doneEventData.pending_tool_calls,
          debug: doneEventData.debug,
          request_id: doneEventData.request_id,
        }));

        // Cleanup AbortController (using stable _id)
        abortControllers.delete(conversation._id);
      }

      // Now throw error if we had one (after processing done event)
      if (errorData) {
        throw new Error(errorData.error);
      }

      // If we didn't get done event and no error, that's a problem
      if (!doneEventData) {
        throw new Error('Stream ended without done event');
      }

    } catch (error: any) {
      if (error.name === 'AbortError') return;
      void captureError('chatListener:sendMessage', error, { conversationID: String(conversationID) });
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
 * Listen for editAndForkMessage → call /api/chat with log_index set to the fork point.
 * The editAndForkMessage action already set conversation.log_index = logIndex before this runs.
 */
chatListenerMiddleware.startListening({
  actionCreator: editAndForkMessage,
  effect: async (action, listenerApi) => {
    const { conversationID, message } = action.payload;
    const state = listenerApi.getState() as RootState;
    const conversation = selectConversation(state, conversationID);

    if (!conversation) return;

    const abortController = new AbortController();
    abortControllers.set(conversation._id, abortController);

    const useStreaming = !IS_TEST;

    try {
      // In test env, negative IDs signal a new conversation — send null so the API creates it
      const testConversationID = !useStreaming && conversationID < 0 ? null : conversationID;

      if (!useStreaming) {
        const response = await fetch(`${API_BASE_URL}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversationID: testConversationID,
            log_index: conversation.log_index,  // Set to fork point by the action
            user_message: message,
            agent: conversation.agent,
            agent_args: conversation.agent_args
          }),
          signal: abortController.signal
        });

        const data = await response.json();

        if (data.error) {
          listenerApi.dispatch(setError({ conversationID, error: data.error }));
          return;
        }

        listenerApi.dispatch(updateConversation({
          conversationID,
          newConversationID: data.conversationID,
          log_index: data.log_index,
          completed_tool_calls: data.completed_tool_calls,
          pending_tool_calls: data.pending_tool_calls,
          debug: data.debug,
          request_id: data.request_id,
        }));
        return;
      }

      // Streaming path
      const response = await fetch(`${API_BASE_URL}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationID,
          log_index: conversation.log_index,
          user_message: message,
          agent: conversation.agent,
          agent_args: conversation.agent_args
        }),
        signal: abortController.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      let doneEventData: any = null;
      let errorData: any = null;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split('\n\n');
          buffer = events.pop() || '';

          for (const eventChunk of events) {
            if (!eventChunk.trim()) continue;
            const parsed = parseSSEChunk(eventChunk);
            if (!parsed) continue;

            const { event, data } = parsed;
            if (event === 'streaming_event') {
              if (data.type === 'StreamedContent') {
                console.log('[chatListener] Dispatching StreamedContent at', Date.now());
              }
              listenerApi.dispatch(addStreamingMessage(data));
              // Yield to the macrotask queue so React 18 can render each chunk
              // progressively. Without this, React batches all streaming dispatches
              // (microtask context) and renders everything at once after the stream ends.
              if (data.type === 'StreamedContent') {
                await new Promise<void>(resolve => setTimeout(resolve, 0));
                console.log('[chatListener] Resumed after setTimeout at', Date.now());
              }
            } else if (event === 'done') {
              doneEventData = data;
            } else if (event === 'error') {
              errorData = data;
            } else if (event === 'user_input_request') {
              listenerApi.dispatch(addUserInputRequest({
                conversationID,
                tool_call_id: data.tool_call_id,
                userInput: data.user_input
              }));
            }
          }
        }

        if (doneEventData) {
          const realConversationID = doneEventData.conversationID || conversationID;
          listenerApi.dispatch(clearStreamingContent({ conversationID: realConversationID }));
          listenerApi.dispatch(updateConversation({
            conversationID,
            newConversationID: doneEventData.conversationID,
            log_index: doneEventData.log_index,
            completed_tool_calls: doneEventData.completed_tool_calls,
            pending_tool_calls: doneEventData.pending_tool_calls,
            debug: doneEventData.debug,
            request_id: doneEventData.request_id,
          }));
          abortControllers.delete(conversation._id);
        }

        if (errorData) throw new Error(errorData.error);
        if (!doneEventData) throw new Error('Stream ended without done event');

      } finally {
        reader.releaseLock();
      }
    } catch (error: any) {
      if (error.name === 'AbortError') return;
      void captureError('chatListener:editAndFork', error, { conversationID: String(conversationID) });
      listenerApi.dispatch(setError({ conversationID, error: error.message || 'Unknown error' }));
      listenerApi.dispatch(clearStreamingContent({ conversationID }));
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

    // Use non-streaming endpoint in test environment for simplicity
    const useStreaming = !IS_TEST;

    // All tools done - send results to backend
    try {
      const completed_tool_calls = conversation.pending_tool_calls.map(p => [
        p.toolCall,
        p.result!
      ]);

      // Include queued user messages if mid-turn strategy
      const queueStrategy = selectQueueStrategy(listenerApi.getState() as RootState);
      const queuedMessages = conversation.queuedMessages;
      const shouldFlushMidTurn = selectAllowChatQueue(listenerApi.getState() as RootState) && queueStrategy === 'mid-turn' && queuedMessages && queuedMessages.length > 0;
      const userMessage = shouldFlushMidTurn
        ? queuedMessages.map(qm => qm.message).join('\n\n')
        : null;
      if (shouldFlushMidTurn) {
        listenerApi.dispatch(flushQueuedMessages({ conversationID }));
      }

      if (!useStreaming) {
        // Non-streaming path (for tests)
        const response = await fetch(`${API_BASE_URL}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversationID,
            log_index: conversation.log_index,
            user_message: userMessage,
            completed_tool_calls,
            agent: conversation.agent,
            agent_args: conversation.agent_args
          }),
          signal: abortController.signal
        });

        const data = await response.json();

        if (data.error) {
          listenerApi.dispatch(setError({ conversationID, error: data.error }));
          return;
        }

        // Update conversation - may have more pending tools
        listenerApi.dispatch(updateConversation({
          conversationID,
          newConversationID: data.conversationID,
          log_index: data.log_index,
          completed_tool_calls: data.completed_tool_calls,
          pending_tool_calls: data.pending_tool_calls,
          debug: data.debug,
          request_id: data.request_id,
        }));
        return;
      }

      // Streaming path (production)
      const response = await fetch(`${API_BASE_URL}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationID,
          log_index: conversation.log_index,
          user_message: userMessage,
          completed_tool_calls,
          agent: conversation.agent,
          agent_args: conversation.agent_args
        }),
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
      let errorData: any = null;

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

            switch (event) {
              case 'streaming_event':
                // Skip streaming events if aborted
                if (abortController.signal.aborted) {
                  console.log('[sendMessage] Skipping streaming event - aborted');
                  break;
                }

                // Dispatch streaming event to build streamedCompletedToolCalls
                if (data.type === 'StreamedContent') {
                  console.log('[chatListener] Dispatching StreamedContent at', Date.now());
                }
                listenerApi.dispatch(addStreamingMessage(data));
                // Yield to the macrotask queue so React 18 can render each chunk
                // progressively. Without this, React batches all streaming dispatches
                // (microtask context) and renders everything at once after the stream ends.
                if (data.type === 'StreamedContent') {
                  await new Promise<void>(resolve => setTimeout(resolve, 0));
                  console.log('[chatListener] Resumed after setTimeout at', Date.now());
                }
                break;

              case 'done':
                // Always process done event (for cleanup)
                doneEventData = data;
                break;

              case 'error':
                // Save error but continue reading to get done event
                errorData = data;
                break;

              default:
                console.warn('Unknown SSE event:', event);
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      // Process done event if we have it
      if (doneEventData) {
        // Use real conversation ID for clearing streaming (it might have forked)
        const realConversationID = doneEventData.conversationID || conversationID;

        // Clear streaming state on the correct conversation
        listenerApi.dispatch(clearStreamingContent({ conversationID: realConversationID }));

        // Update conversation with final results
        listenerApi.dispatch(updateConversation({
          conversationID,
          newConversationID: doneEventData.conversationID,
          log_index: doneEventData.log_index,
          completed_tool_calls: doneEventData.completed_tool_calls,
          pending_tool_calls: doneEventData.pending_tool_calls,
          debug: doneEventData.debug,
          request_id: doneEventData.request_id,
        }));

        // Cleanup AbortController (using stable _id)
        abortControllers.delete(conversation._id);
      }

      // Now throw error if we had one (after processing done event)
      if (errorData) {
        throw new Error(errorData.error);
      }

      // If we didn't get done event and no error, that's a problem
      if (!doneEventData) {
        throw new Error('Stream ended without done event');
      }

    } catch (error: any) {
      if (error.name === 'AbortError') return;
      void captureError('chatListener:completeToolCall', error, { conversationID: String(conversationID) });
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

    // Helper: run one pending tool call
    const runOne = async (pendingTool: (typeof realConversation.pending_tool_calls)[number]) => {
      try {
        console.log(`[chatListener] Executing tool: ${pendingTool.toolCall.function.name}`);

        // Dynamic import to avoid circular dependencies:
        // tool-handlers → store → chatListener → tool-handlers (circular)
        // eslint-disable-next-line no-restricted-syntax
        const { executeToolCall } = await import('@/lib/api/tool-handlers');

        // Get database from agent_args
        const database = {
          databaseName: conversation.agent_args.connection_id,
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
    };

    // Only eligible tools: not yet complete, not waiting for user input
    const eligible = realConversation.pending_tool_calls.filter(t =>
      !t.result && !t.userInputs?.some(ui => ui.result === undefined)
    );

    // Group by fileId: same fileId → serial; different fileId → parallel
    const groups = new Map<string, typeof eligible>();
    for (const tool of eligible) {
      const toolArgs = tool.toolCall.function.arguments || {};
      const key = toolArgs.fileId != null ? String(toolArgs.fileId) : `_${tool.toolCall.id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(tool);
    }

    // Run groups in parallel; within each group, sequential
    await Promise.all(
      Array.from(groups.values()).map(async (group) => {
        for (const tool of group) {
          await runOne(tool);
        }
      })
    );
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

/**
 * Listen for conversation finishing with queued messages → auto-send them
 * Fires on both updateConversation (conversation just finished) and queueMessage
 * (message queued while conversation already finished).
 */
chatListenerMiddleware.startListening({
  matcher: isAnyOf(updateConversation, queueMessage),
  effect: async (action: any, listenerApi) => {
    const state = listenerApi.getState() as RootState;
    if (!selectAllowChatQueue(state)) return;
    // Use newConversationID if forked (updateConversation), otherwise conversationID
    const effectiveId = action.payload.newConversationID || action.payload.conversationID;
    const conversation = selectConversation(state, effectiveId);

    if (!conversation || conversation.executionState !== 'FINISHED') return;
    if (!conversation.queuedMessages || conversation.queuedMessages.length === 0) return;

    // Don't auto-send if this was an interrupt — prefill the input instead
    if (conversation.wasInterrupted) return;

    // Concatenate all queued messages into one
    const combinedMessage = conversation.queuedMessages.map(qm => qm.message).join('\n\n');
    // Merge attachments from all queued messages
    const allAttachments = conversation.queuedMessages.flatMap(qm => qm.attachments || []);

    // Clear the queue first, then send
    listenerApi.dispatch(clearQueuedMessages({ conversationID: effectiveId }));
    listenerApi.dispatch(sendMessage({
      conversationID: effectiveId,
      message: combinedMessage,
      attachments: allAttachments.length > 0 ? allAttachments : undefined,
    }));
  }
});
