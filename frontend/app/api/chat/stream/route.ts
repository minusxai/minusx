import { NextRequest } from 'next/server';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import {
  getOrCreateConversation,
  appendLogToConversation
} from '@/lib/conversations';
import { ToolCall, ConversationLogEntry } from '@/lib/types';
import { pythonBackendFetch } from '@/lib/api/python-backend-client';
import {
  ChatRequest,
  CompletedToolCallPayload,
  CompletedToolCallFromPython,
  LLMCallDetail
} from '@/lib/chat-orchestration';
// Import tool handlers first to register them
import '../tool-handlers.server';
import { orchestratePendingTools } from '../orchestrator';
import { trackLLMCallEvents } from '@/lib/analytics/file-analytics.server';
import { UserInterruptError } from '@/lib/errors/user-interrupt-error';

/**
 * SSE Event types
 */
// Python backend events (no conversationID)
type PythonStreamingEvent = {
  type: 'StreamedContent' | 'ToolCreated' | 'ToolCompleted';
  payload: { chunk: string } | ToolCall | CompletedToolCallFromPython;
};

// Frontend events (with conversationID added by Next.js)
type StreamingEvent =
  | (PythonStreamingEvent & { conversationID: number })
  | { conversationID: number; type: 'NewConversation'; payload: { name: string } };

type SSEEvent =
  | PythonStreamingEvent
  | StreamingEvent
  | { type: 'done', logDiff: ConversationLogEntry[], pending_tool_calls: ToolCall[], completed_tool_calls: CompletedToolCallFromPython[], llm_calls?: Record<string, LLMCallDetail>, timestamp: string }
  | { type: 'error', error: string, timestamp: string };

/**
 * Format SSE event
 */
function formatSSE(event: string, data: any): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Safely enqueue to controller, handling closed controller gracefully
 */
function safeEnqueue(controller: ReadableStreamDefaultController, encoder: TextEncoder, event: string, data: any): void {
  try {
    controller.enqueue(encoder.encode(formatSSE(event, data)));
  } catch (e) {
    // Controller already closed by client (page refresh, navigation, abort) - silently ignore
    // This is expected behavior when the client disconnects
  }
}

/**
 * Parse SSE chunk from Python backend
 */
function parseSSEChunk(chunk: string): SSEEvent | null {
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
      return JSON.parse(data) as SSEEvent;
    } catch (e) {
      console.error('Failed to parse SSE data:', e);
      return null;
    }
  }

  return null;
}

/**
 * Stream Python backend SSE and forward events
 * Uses pythonBackendFetch to automatically include company ID header
 */
async function* consumePythonStream(
  endpoint: string,
  requestPayload: any
): AsyncGenerator<SSEEvent, void, unknown> {
  const response = await pythonBackendFetch(endpoint, {
    method: 'POST',
    body: JSON.stringify(requestPayload),
    signal: AbortSignal.timeout(300000) // 5 minute timeout for streaming
  });

  if (!response.ok) {
    throw new Error(`Python backend error: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Split on double newlines (SSE event separator)
      const events = buffer.split('\n\n');
      buffer = events.pop() || ''; // Keep incomplete event in buffer

      for (const eventChunk of events) {
        if (eventChunk.trim()) {
          const event = parseSSEChunk(eventChunk);
          if (event) {
            yield event;
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * POST /api/chat/stream
 * Streaming chat endpoint with Server-Sent Events
 */
export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // Declare variables outside try block so they're accessible in catch
      let currentConversationID = 0;
      let currentLogIndex = 0;
      let accumulatedCompletedToolCalls: CompletedToolCallFromPython[] = [];

      try {
        // Parse request
        const body: ChatRequest = await request.json();
        const user = await getEffectiveUser();

        if (!user || !user.companyId) {
          safeEnqueue(controller, encoder, 'error', {
            type: 'error',
            error: 'No company ID found for user',
            timestamp: new Date().toISOString()
          });
          controller.close();
          return;
        }

        // Get or create conversation (pass first message for auto-naming)
        const isNewConversation = !body.conversationID;
        const { fileId, content: conversation } = await getOrCreateConversation(
          body.conversationID ?? null,
          user,
          body.user_message ?? undefined
        );
        const conversationID = fileId;
        currentConversationID = conversationID;  // Initialize outer scope variable

        // If new conversation, emit event immediately so frontend can update Redux
        if (isNewConversation) {
          const newConversationEvent: StreamingEvent = {
            conversationID,
            type: 'NewConversation',
            payload: {
              name: conversation.metadata.name
            }
          };
          safeEnqueue(controller, encoder, 'streaming_event', newConversationEvent);
        }

        // Load log
        const initial_log_index = body.log_index ?? conversation.log.length;
        const log: ConversationLogEntry[] = conversation.log.slice(0, initial_log_index);

        // Setup loop variables
        let completed_tool_calls = body.completed_tool_calls?.map(tuple => tuple[1]) || [];
        let user_message: string | null = body.user_message || null;
        let accumulatedLogDiff: ConversationLogEntry[] = [];
        accumulatedCompletedToolCalls = [];  // Use outer scope variable
        let accumulatedLLMCalls: Record<string, LLMCallDetail> = {};
        let currentFileId = fileId;
        currentLogIndex = initial_log_index;  // Initialize outer scope variable
        let finalPendingToolCalls: ToolCall[] = [];

        // Automatic execution loop
        while (true) {
          // Call Python backend (streaming)
          const requestPayload = {
            log: [...log, ...accumulatedLogDiff],
            user_message,
            completed_tool_calls,
            agent: body.agent || 'DefaultAgent',
            agent_args: body.agent_args || {}
          };

          // Consume Python stream and forward events (company ID header added automatically)
          let pythonDoneEvent: SSEEvent | null = null;
          let pythonErrorEvent: SSEEvent | null = null;

          for await (const event of consumePythonStream('/api/chat/stream', requestPayload)) {
            // Check for abort before processing event - if aborted, stop forwarding events
            // but continue consuming the stream to get the done event
            if (request.signal.aborted) {
              if (event.type === 'done') {
                pythonDoneEvent = event;
              }
              // Skip forwarding events if aborted to avoid "Controller is already closed" error
              continue;
            }

            if (event.type === 'done') {
              pythonDoneEvent = event;
              // Don't forward done event yet - we may have more work
            } else if (event.type === 'error') {
              // Python backend error - treat as terminal event
              pythonErrorEvent = event;
              safeEnqueue(controller, encoder, 'error', event);
              // Break immediately - no more processing after error
              break;
            } else {
              // Forward streaming events to frontend with conversationID added
              const eventWithConversationID: StreamingEvent = {
                ...(event as PythonStreamingEvent),
                conversationID: currentConversationID
              };
              safeEnqueue(controller, encoder, 'streaming_event', eventWithConversationID);
            }
          }

          // If Python sent an error, throw it to be caught by outer catch block
          if (pythonErrorEvent) {
            throw new Error(`Python backend error: ${(pythonErrorEvent as any).error || 'Unknown error'}`);
          }

          if (!pythonDoneEvent || pythonDoneEvent.type !== 'done') {
            throw new Error('Python stream ended without done event');
          }

          // Accumulate results
          accumulatedLogDiff.push(...pythonDoneEvent.logDiff);
          accumulatedCompletedToolCalls.push(...pythonDoneEvent.completed_tool_calls);

          // Accumulate LLM calls
          if (pythonDoneEvent.llm_calls) {
            accumulatedLLMCalls = { ...accumulatedLLMCalls, ...pythonDoneEvent.llm_calls };
          }

          // Check for interruption before saving
          if (request.signal.aborted) {
            // Call Python to mark pending tools as interrupted
            const closeResponse = await pythonBackendFetch('/api/chat/close', {
              method: 'POST',
              body: JSON.stringify({
                log: [...log, ...accumulatedLogDiff]
              })
            });

            if (closeResponse.ok) {
              const { logDiff: interruptedLogDiff } = await closeResponse.json();
              accumulatedLogDiff.push(...interruptedLogDiff);
            }

            // Save accumulated log (includes interrupted tools)
            const appendResult = await appendLogToConversation(
              currentFileId,
              accumulatedLogDiff,
              currentLogIndex,
              user
            );
            currentConversationID = appendResult.fileId;
            currentFileId = appendResult.fileId;
            currentLogIndex += accumulatedLogDiff.length;

            throw new UserInterruptError();
          }

          // Append to conversation (may fork)
          const appendResult = await appendLogToConversation(
            currentFileId,
            pythonDoneEvent.logDiff,
            currentLogIndex,
            user
          );

          currentConversationID = appendResult.fileId;
          currentFileId = appendResult.fileId;
          currentLogIndex += pythonDoneEvent.logDiff.length;

          // Track LLM call analytics in DuckDB (fire-and-forget)
          // IMPORTANT: Use UPDATED currentConversationID (may have changed due to forking)
          if (pythonDoneEvent.llm_calls && Object.keys(pythonDoneEvent.llm_calls).length > 0) {
            trackLLMCallEvents(pythonDoneEvent.llm_calls, currentConversationID, user.companyId).catch(
              (err: unknown) => console.error('[LLM Analytics] Failed to track:', err)
            );
          }

          // Clear user_message after first call
          user_message = null;

          // No more pending tools - we're done
          if (pythonDoneEvent.pending_tool_calls.length === 0) {
            break;
          }

          // Orchestrate Next.js backend tool execution
          const result = await orchestratePendingTools(
            pythonDoneEvent.pending_tool_calls,
            currentFileId,
            currentLogIndex,
            user,
            request.signal,  // Pass abort signal
            {
              // Emit SSE events for completed tools
              onToolCompleted: (tool: ToolCall, toolResult: CompletedToolCallPayload) => {
                const event: StreamingEvent = {
                  conversationID: currentConversationID,
                  type: 'ToolCompleted',
                  payload: {
                    role: 'tool',
                    tool_call_id: toolResult.tool_call_id,
                    content: toolResult.content,
                    run_id: '',
                    function: tool.function,
                    created_at: new Date().toISOString()
                  } as CompletedToolCallFromPython
                };
                safeEnqueue(controller, encoder, 'streaming_event', event);
              }
            }
          );

          // Update state from orchestration result
          currentFileId = result.updatedFileId;
          currentLogIndex = result.updatedLogIndex;
          currentConversationID = result.updatedFileId;
          accumulatedLogDiff.push(...result.logEntries);

          // Combine remaining pending tools and spawned tools for frontend execution
          const allPendingTools = [...result.remainingPendingTools, ...result.spawnedTools];

          // Handle pending tools and completed tools
          if (allPendingTools.length > 0) {
            if (result.completedTools.length > 0) {
              // We have both completed and pending tools
              // Continue loop to send completed tools to Python first
              completed_tool_calls = result.completedTools;
              // Don't break yet - we'll handle pending tools on next iteration
            } else {
              // No completed tools, just pending - break immediately
              finalPendingToolCalls = allPendingTools;
              break;
            }
          } else if (result.completedTools.length > 0) {
            // No pending tools, but we have completed tools
            // Continue loop to send them to Python
            completed_tool_calls = result.completedTools;
          } else {
            // No completed tools and no pending tools - done
            break;
          }
        }

        // Send final done event
        safeEnqueue(controller, encoder, 'done', {
          type: 'done',
          conversationID: currentConversationID,
          log_index: currentLogIndex,
          pending_tool_calls: finalPendingToolCalls,
          completed_tool_calls: accumulatedCompletedToolCalls,
          timestamp: new Date().toISOString()
        });
        controller.close();

      } catch (error: any) {
        // Handle user interruption gracefully
        if (error instanceof UserInterruptError) {
          // Log already saved before throwing, just return done event
          safeEnqueue(controller, encoder, 'done', {
            type: 'done',
            conversationID: currentConversationID,
            log_index: currentLogIndex,
            pending_tool_calls: [],
            completed_tool_calls: accumulatedCompletedToolCalls,
            timestamp: new Date().toISOString()
          });
          controller.close();
          return;
        }

        // Handle other errors
        console.error('[CHAT STREAM] Error:', error);
        safeEnqueue(controller, encoder, 'error', {
          type: 'error',
          error: error.message || 'Unknown error',
          timestamp: new Date().toISOString()
        });
        // Also send a done event so frontend knows stream is complete
        safeEnqueue(controller, encoder, 'done', {
          type: 'done',
          conversationID: currentConversationID,
          log_index: currentLogIndex,
          pending_tool_calls: [],
          completed_tool_calls: accumulatedCompletedToolCalls,
          timestamp: new Date().toISOString()
        });
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no' // Disable buffering in nginx and other reverse proxies
    }
  });
}
