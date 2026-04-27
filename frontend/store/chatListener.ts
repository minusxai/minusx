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

export const chatListenerMiddleware = createListenerMiddleware();

// ---------------------------------------------------------------------------
// SSE parsing
// ---------------------------------------------------------------------------

function parseSSEChunk(chunk: string): { event: string; data: any } | null {
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

// ---------------------------------------------------------------------------
// Shared streaming helpers
// ---------------------------------------------------------------------------

interface SSEStreamResult {
  doneData: any;
  errorData: any;
}

/**
 * XHR-based SSE streaming for /api/chat/stream.
 *
 * Uses XMLHttpRequest instead of fetch() because Next.js/React patches the
 * global fetch() to buffer entire responses before resolving, which breaks
 * SSE — the browser receives all bytes at once only after the stream closes.
 * XHR's onprogress fires incrementally as each chunk arrives.
 *
 * Streaming events are serialised through processingChain so React renders
 * each chunk in order (the setTimeout(0) yield in handleStreamingEvent needs
 * to complete before the next dispatch).
 */
function streamChatSSE(
  logLabel: string,
  body: object,
  signal: AbortSignal,
  onStreamingEvent: (data: any) => Promise<void>,
  onUserInputRequest: (data: any) => void,
): Promise<SSEStreamResult> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    console.log(`[chat/stream ${logLabel}] → request start`);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE_URL}/api/chat/stream`);
    xhr.setRequestHeader('Content-Type', 'application/json');

    let offset = 0;
    let buffer = '';
    let doneData: any = null;
    let errorData: any = null;
    let processingChain = Promise.resolve();

    const onAbort = () => xhr.abort();
    signal.addEventListener('abort', onAbort, { once: true });

    xhr.onreadystatechange = () => {
      if (xhr.readyState === 2) {
        console.log(`[chat/stream ${logLabel}] ← headers received (${Date.now() - t0}ms)`, { status: xhr.status });
      }
    };

    xhr.onprogress = () => {
      const newText = xhr.responseText.slice(offset);
      offset = xhr.responseText.length;

      buffer += newText;
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() || '';

      for (const chunk of chunks) {
        if (!chunk.trim()) continue;
        const parsed = parseSSEChunk(chunk);
        if (!parsed) continue;

        const { event, data } = parsed;

        if (event === 'streaming_event') {
          const captured = data;
          processingChain = processingChain.then(() => onStreamingEvent(captured));
        } else if (event === 'done') {
          doneData = data;
        } else if (event === 'error') {
          errorData = data;
        } else if (event === 'user_input_request') {
          onUserInputRequest(data);
        }
      }
    };

    xhr.onload = () => {
      signal.removeEventListener('abort', onAbort);
      // Wait for all queued async streaming-event handlers before resolving
      processingChain.then(() => resolve({ doneData, errorData }));
    };

    xhr.onerror = () => {
      signal.removeEventListener('abort', onAbort);
      reject(new Error('Network error'));
    };

    xhr.onabort = () => {
      signal.removeEventListener('abort', onAbort);
      const err = new Error('The operation was aborted.');
      err.name = 'AbortError';
      reject(err);
    };

    xhr.send(JSON.stringify(body));
  });
}

/**
 * Dispatch a streaming event and yield to the macrotask queue for
 * StreamedContent/StreamedThinking so React 18 renders each chunk
 * progressively instead of batching everything at once.
 */
async function handleStreamingEvent(data: any, dispatch: AppDispatch, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  dispatch(addStreamingMessage(data));
  if (data.type === 'StreamedContent' || data.type === 'StreamedThinking') {
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
}

/** Apply the done event: clear streaming state and update conversation. */
function applyDoneEvent(
  doneData: any,
  conversationID: number,
  stableId: string,
  dispatch: AppDispatch,
): void {
  const realConversationID = doneData.conversationID || conversationID;
  dispatch(clearStreamingContent({ conversationID: realConversationID }));
  dispatch(updateConversation({
    conversationID,
    newConversationID: doneData.conversationID,
    log_index: doneData.log_index,
    completed_tool_calls: doneData.completed_tool_calls,
    pending_tool_calls: doneData.pending_tool_calls,
    debug: doneData.debug,
    request_id: doneData.request_id,
  }));
  abortControllers.delete(stableId);
}

/**
 * Handle a stream error in a catch block.
 * Returns true if the error was an abort (caller should return early).
 */
function handleStreamError(
  error: any,
  captureLabel: string,
  conversationID: number,
  stableId: string,
  dispatch: AppDispatch,
): boolean {
  if (error.name === 'AbortError') return true;
  void captureError(captureLabel, error, { conversationID: String(conversationID) });
  dispatch(setError({ conversationID, error: error.message || 'Unknown error' }));
  dispatch(clearStreamingContent({ conversationID }));
  abortControllers.delete(stableId);
  return false;
}

/** Non-streaming path used in test environments (fetch to /api/chat). */
async function fetchChatNonStreaming(
  body: object,
  conversationID: number,
  signal: AbortSignal,
  dispatch: AppDispatch,
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const data = await response.json();
  if (data.error) {
    dispatch(setError({ conversationID, error: data.error }));
    return;
  }
  dispatch(updateConversation({
    conversationID,
    newConversationID: data.conversationID,
    log_index: data.log_index,
    completed_tool_calls: data.completed_tool_calls,
    pending_tool_calls: data.pending_tool_calls,
    debug: data.debug,
    request_id: data.request_id,
  }));
}

// ---------------------------------------------------------------------------
// Listeners
// ---------------------------------------------------------------------------

/**
 * createConversation → /api/chat/stream
 * Used for new conversations with the initial message.
 */
chatListenerMiddleware.startListening({
  actionCreator: createConversation,
  effect: async (action, listenerApi) => {
    const { conversationID, message } = action.payload;
    if (!message) return;

    const state = listenerApi.getState() as RootState;
    const conversation = selectConversation(state, conversationID);
    if (!conversation) return;

    const dispatch = listenerApi.dispatch as AppDispatch;
    const abortController = new AbortController();
    abortControllers.set(conversation._id, abortController);

    try {
      if (IS_TEST) {
        const testConversationID = conversationID < 0 ? null : conversationID;
        await fetchChatNonStreaming(
          { conversationID: testConversationID, log_index: conversation.log_index, user_message: message, agent: conversation.agent, agent_args: conversation.agent_args },
          conversationID, abortController.signal, dispatch,
        );
        return;
      }

      const { doneData, errorData } = await streamChatSSE(
        '#1 createConversation',
        { conversationID, log_index: conversation.log_index, user_message: message, agent: conversation.agent, agent_args: conversation.agent_args },
        abortController.signal,
        (data) => handleStreamingEvent(data, dispatch, abortController.signal),
        (data) => dispatch(addUserInputRequest({ conversationID, tool_call_id: data.tool_call_id, userInput: data.user_input })),
      );
      if (!doneData) throw new Error('Stream ended without done event');
      if (errorData) throw new Error(errorData.error);
      applyDoneEvent(doneData, conversationID, conversation._id, dispatch);
    } catch (error: any) {
      if (handleStreamError(error, 'chatListener:createConversation', conversationID, conversation._id, dispatch)) return;
    }
  }
});

/**
 * sendMessage → /api/chat/stream
 * Used for adding messages to existing conversations.
 */
chatListenerMiddleware.startListening({
  actionCreator: sendMessage,
  effect: async (action, listenerApi) => {
    const { conversationID, message } = action.payload;
    const state = listenerApi.getState() as RootState;
    const conversation = selectConversation(state, conversationID);
    if (!conversation) return;

    const dispatch = listenerApi.dispatch as AppDispatch;
    const abortController = new AbortController();
    abortControllers.set(conversation._id, abortController);

    try {
      if (IS_TEST) {
        const testConversationID = conversationID < 0 ? null : conversationID;
        await fetchChatNonStreaming(
          { conversationID: testConversationID, log_index: conversation.log_index, user_message: message, agent: conversation.agent, agent_args: conversation.agent_args },
          conversationID, abortController.signal, dispatch,
        );
        return;
      }

      const { doneData, errorData } = await streamChatSSE(
        '#2 sendMessage',
        { conversationID, log_index: conversation.log_index, user_message: message, agent: conversation.agent, agent_args: conversation.agent_args },
        abortController.signal,
        (data) => handleStreamingEvent(data, dispatch, abortController.signal),
        (data) => dispatch(addUserInputRequest({ conversationID, tool_call_id: data.tool_call_id, userInput: data.user_input })),
      );
      if (!doneData) throw new Error('Stream ended without done event');
      if (errorData) throw new Error(errorData.error);
      applyDoneEvent(doneData, conversationID, conversation._id, dispatch);
    } catch (error: any) {
      if (handleStreamError(error, 'chatListener:sendMessage', conversationID, conversation._id, dispatch)) return;
    }
  }
});

/**
 * editAndForkMessage → /api/chat/stream
 * Calls /api/chat with log_index set to the fork point.
 * The editAndForkMessage action already set conversation.log_index = logIndex before this runs.
 */
chatListenerMiddleware.startListening({
  actionCreator: editAndForkMessage,
  effect: async (action, listenerApi) => {
    const { conversationID, message } = action.payload;
    const state = listenerApi.getState() as RootState;
    const conversation = selectConversation(state, conversationID);
    if (!conversation) return;

    const dispatch = listenerApi.dispatch as AppDispatch;
    const abortController = new AbortController();
    abortControllers.set(conversation._id, abortController);

    try {
      if (IS_TEST) {
        const testConversationID = conversationID < 0 ? null : conversationID;
        await fetchChatNonStreaming(
          { conversationID: testConversationID, log_index: conversation.log_index, user_message: message, agent: conversation.agent, agent_args: conversation.agent_args },
          conversationID, abortController.signal, dispatch,
        );
        return;
      }

      const { doneData, errorData } = await streamChatSSE(
        '#3 editAndFork',
        { conversationID, log_index: conversation.log_index, user_message: message, agent: conversation.agent, agent_args: conversation.agent_args },
        abortController.signal,
        (data) => handleStreamingEvent(data, dispatch, abortController.signal),
        (data) => dispatch(addUserInputRequest({ conversationID, tool_call_id: data.tool_call_id, userInput: data.user_input })),
      );
      if (!doneData) throw new Error('Stream ended without done event');
      if (errorData) throw new Error(errorData.error);
      applyDoneEvent(doneData, conversationID, conversation._id, dispatch);
    } catch (error: any) {
      if (handleStreamError(error, 'chatListener:editAndFork', conversationID, conversation._id, dispatch)) return;
    }
  }
});

/**
 * completeToolCall → /api/chat/stream
 * Fires when all pending frontend tools are done; resumes the conversation.
 */
chatListenerMiddleware.startListening({
  actionCreator: completeToolCall,
  effect: async (action, listenerApi) => {
    const { conversationID } = action.payload;
    const state = listenerApi.getState() as RootState;
    const conversation = selectConversation(state, conversationID);
    if (!conversation) return;
    if (conversation.executionState !== 'EXECUTING') return;

    const allCompleted = selectAllToolsCompleted(state, conversationID);
    if (!allCompleted) return;

    const dispatch = listenerApi.dispatch as AppDispatch;
    let abortController = abortControllers.get(conversation._id);
    if (!abortController) {
      abortController = new AbortController();
      abortControllers.set(conversation._id, abortController);
    }

    try {
      const completed_tool_calls = conversation.pending_tool_calls.map(p => [p.toolCall, p.result!]);

      const queueStrategy = selectQueueStrategy(listenerApi.getState() as RootState);
      const queuedMessages = conversation.queuedMessages;
      const shouldFlushMidTurn = selectAllowChatQueue(listenerApi.getState() as RootState) && queueStrategy === 'mid-turn' && queuedMessages && queuedMessages.length > 0;
      const userMessage = shouldFlushMidTurn ? queuedMessages.map(qm => qm.message).join('\n\n') : null;
      if (shouldFlushMidTurn) {
        dispatch(flushQueuedMessages({ conversationID }));
      }

      if (IS_TEST) {
        await fetchChatNonStreaming(
          { conversationID, log_index: conversation.log_index, user_message: userMessage, completed_tool_calls, agent: conversation.agent, agent_args: conversation.agent_args },
          conversationID, abortController.signal, dispatch,
        );
        return;
      }

      const { doneData, errorData } = await streamChatSSE(
        '#4 toolResults',
        { conversationID, log_index: conversation.log_index, user_message: userMessage, completed_tool_calls, agent: conversation.agent, agent_args: conversation.agent_args },
        abortController.signal,
        (data) => handleStreamingEvent(data, dispatch, abortController!.signal),
        (data) => dispatch(addUserInputRequest({ conversationID, tool_call_id: data.tool_call_id, userInput: data.user_input })),
      );
      if (!doneData) throw new Error('Stream ended without done event');
      if (errorData) throw new Error(errorData.error);
      applyDoneEvent(doneData, conversationID, conversation._id, dispatch);
    } catch (error: any) {
      if (handleStreamError(error, 'chatListener:completeToolCall', conversationID, conversation._id, dispatch)) return;
    }
  }
});

/**
 * updateConversation | setUserInputResult → Execute pending frontend tools automatically.
 */
chatListenerMiddleware.startListening({
  matcher: isAnyOf(updateConversation, setUserInputResult),
  effect: async (action: any, listenerApi) => {
    const conversationID = action.payload.conversationID;
    const state = listenerApi.getState() as RootState;
    const conversation = selectConversation(state, conversationID);

    if (!conversation) return;

    const realConversationID = conversation.forkedConversationID || conversationID;

    const realConversation = realConversationID !== conversationID
      ? selectConversation(state, realConversationID)
      : conversation;

    if (!realConversation) return;

    const runOne = async (pendingTool: (typeof realConversation.pending_tool_calls)[number]) => {
      try {
        console.log(`[chatListener] Executing tool: ${pendingTool.toolCall.function.name}`);

        // Dynamic import to avoid circular dependencies:
        // tool-handlers → store → chatListener → tool-handlers (circular)
        // eslint-disable-next-line no-restricted-syntax
        const { executeToolCall } = await import('@/lib/api/tool-handlers');

        const database = {
          databaseName: conversation.agent_args.connection_id,
          schemas: conversation.agent_args.schema || []
        };

        const state = listenerApi.getState() as RootState;

        const result = await executeToolCall(
          pendingTool.toolCall,
          database,
          listenerApi.dispatch as AppDispatch,
          undefined,
          state,
          pendingTool.userInputs
        );

        listenerApi.dispatch(completeToolCall({
          conversationID: realConversationID,
          tool_call_id: pendingTool.toolCall.id,
          result: {
            ...result,
            created_at: new Date().toISOString()
          } as any
        }));

      } catch (error: any) {
        if (error instanceof UserInputException) {
          console.log(`[chatListener] Tool requests user input:`, error.props);
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
 * interruptChat → Abort the active conversation stream.
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
 * updateConversation | queueMessage → Auto-send queued messages when conversation finishes.
 */
chatListenerMiddleware.startListening({
  matcher: isAnyOf(updateConversation, queueMessage),
  effect: async (action: any, listenerApi) => {
    const state = listenerApi.getState() as RootState;
    if (!selectAllowChatQueue(state)) return;
    const effectiveId = action.payload.newConversationID || action.payload.conversationID;
    const conversation = selectConversation(state, effectiveId);

    if (!conversation || conversation.executionState !== 'FINISHED') return;
    if (!conversation.queuedMessages || conversation.queuedMessages.length === 0) return;
    if (conversation.wasInterrupted) return;

    const combinedMessage = conversation.queuedMessages.map(qm => qm.message).join('\n\n');
    const allAttachments = conversation.queuedMessages.flatMap(qm => qm.attachments || []);

    listenerApi.dispatch(clearQueuedMessages({ conversationID: effectiveId }));
    listenerApi.dispatch(sendMessage({
      conversationID: effectiveId,
      message: combinedMessage,
      attachments: allAttachments.length > 0 ? allAttachments : undefined,
    }));
  }
});
