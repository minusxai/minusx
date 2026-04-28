import { NextRequest } from 'next/server';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import {
  getOrCreateConversation,
  appendLogToConversation
} from '@/lib/conversations';
import { extractDebugMessages } from '@/lib/conversations-utils';
import { ToolCall, ConversationLogEntry } from '@/lib/types';
import type { DebugMessage } from '@/store/chatSlice';
import { pythonBackendFetch } from '@/lib/api/python-backend-client';
import { resolveHomeFolderSync } from '@/lib/mode/path-resolver';
import {
  ChatRequest,
  CompletedToolCallFromPython,
  LLMCallDetail
} from '@/lib/chat-orchestration';
// Import tool handlers first to register them
import '../tool-handlers.server';
import { orchestratePendingTools, ToolExecutionResult } from '../orchestrator';
import { appEventRegistry, AppEvents } from '@/lib/app-event-registry';
import { UserInterruptError } from '@/lib/errors/user-interrupt-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * SSE Event types
 */
// Python backend events (no conversationID)
type PythonStreamingEvent = {
  type: 'StreamedContent' | 'StreamedThinking' | 'ToolCreated' | 'ToolCompleted';
  payload: { chunk: string } | ToolCall | CompletedToolCallFromPython;
};

// Frontend events (with conversationID added by Next.js)
type StreamingEvent = PythonStreamingEvent & { conversationID: number };

type SSEEvent =
  | PythonStreamingEvent
  | StreamingEvent
  | { type: 'done', logDiff: ConversationLogEntry[], pending_tool_calls: ToolCall[], completed_tool_calls: CompletedToolCallFromPython[], llm_calls?: Record<string, LLMCallDetail>, debug?: DebugMessage[], timestamp: string }
  | { type: 'error', error: string, timestamp: string };

/**
 * Format SSE event
 */
function formatSSE(event: string, data: any): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Safely write to a TransformStream writer, ignoring errors from client disconnect
 */
async function safeWrite(writer: WritableStreamDefaultWriter<Uint8Array>, encoder: TextEncoder, event: string, data: any): Promise<void> {
  try {
    await writer.write(encoder.encode(formatSSE(event, data)));
  } catch {
    // Writer already closed (client disconnected) - silently ignore
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
 * Core streaming logic — runs in a background async task after the Response is returned.
 * Using TransformStream + async IIFE pattern to avoid Next.js App Router buffering
 * the ReadableStream until the route handler completes.
 */
async function processStream(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  encoder: TextEncoder,
  body: ChatRequest,
  user: NonNullable<Awaited<ReturnType<typeof getEffectiveUser>>>,
  signal: AbortSignal
): Promise<void> {
  const _t0_stream = Date.now();

  // Declare variables outside try block so they're accessible in catch
  let currentConversationID = 0;
  let currentLogIndex = 0;
  let accumulatedCompletedToolCalls: CompletedToolCallFromPython[] = [];
  let accumulatedLogDiff: ConversationLogEntry[] = [];

  try {
    const _t2_conv = Date.now();

    // Get or create conversation (pass first message for auto-naming)
    const { fileId, content: conversation } = await getOrCreateConversation(
      body.conversationID ?? null,
      user,
      body.user_message ?? undefined
    );
    const conversationID = fileId;
    currentConversationID = conversationID;
    console.log(`[chat/stream] getOrCreateConversation: ${Date.now() - _t2_conv}ms`);

    // Load log
    const initial_log_index = body.log_index ?? conversation.log.length;
    const log: ConversationLogEntry[] = conversation.log.slice(0, initial_log_index);

    // Setup loop variables
    let completed_tool_calls = body.completed_tool_calls?.map(tuple => tuple[1]) || [];
    let user_message: string | null = body.user_message || null;
    accumulatedLogDiff = [];
    accumulatedCompletedToolCalls = [];
    let accumulatedLLMCalls: Record<string, LLMCallDetail> = {};
    let currentFileId = fileId;
    currentLogIndex = initial_log_index;
    let finalPendingToolCalls: ToolCall[] = [];

    // Automatic execution loop
    while (true) {
      // Call Python backend (streaming)
      const resolvedHomeFolder = resolveHomeFolderSync(user.mode, user.home_folder || '');
      const requestPayload = {
        log: [...log, ...accumulatedLogDiff],
        user_message,
        completed_tool_calls,
        agent: body.agent || 'DefaultAgent',
        agent_args: {
          ...(body.agent_args || {}),
          home_folder: resolvedHomeFolder,
          role: user.role,
        }
      };

      // Consume Python stream and forward events
      let pythonDoneEvent: SSEEvent | null = null;
      let pythonErrorEvent: SSEEvent | null = null;

      let firstPythonEvent = true;
      const _t0_python = Date.now();
      for await (const event of consumePythonStream('/api/chat/stream', requestPayload)) {
        if (firstPythonEvent) {
          console.log(`[chat/stream route] first Python event after ${Date.now() - _t0_python}ms (total from handler start: ${Date.now() - _t0_stream}ms)`, { type: event.type });
          firstPythonEvent = false;
        }
        // Check for abort before processing event - if aborted, stop forwarding events
        // but continue consuming the stream to get the done event
        if (signal.aborted) {
          if (event.type === 'done') {
            pythonDoneEvent = event;
          }
          continue;
        }

        if (event.type === 'done') {
          pythonDoneEvent = event;
          // Don't forward done event yet - we may have more work
        } else if (event.type === 'error') {
          // Python backend error - treat as terminal event
          pythonErrorEvent = event;
          await safeWrite(writer, encoder, 'error', event);
          break;
        } else {
          // Forward streaming events to frontend with conversationID added
          const eventWithConversationID: StreamingEvent = {
            ...(event as PythonStreamingEvent),
            conversationID: currentConversationID
          };
          await safeWrite(writer, encoder, 'streaming_event', eventWithConversationID);
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
      if (signal.aborted) {
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
      if (pythonDoneEvent.llm_calls && Object.keys(pythonDoneEvent.llm_calls).length > 0) {
        appEventRegistry.publish(AppEvents.LLM_CALL, {
          llmCalls: pythonDoneEvent.llm_calls,
          conversationId: currentConversationID,
          mode: user.mode,
          userId: user.userId,
          userEmail: user.email,
          userRole: user.role,
        });
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
        {
          signal: signal,
          callbacks: {
            onToolCompleted: (tool: ToolCall, result: ToolExecutionResult) => {
              const event: StreamingEvent = {
                conversationID: currentConversationID,
                type: 'ToolCompleted',
                payload: {
                  role: 'tool',
                  tool_call_id: result.tool_call_id,
                  content: result.content,
                  run_id: '',
                  function: tool.function,
                  details: result.details,
                  created_at: new Date().toISOString()
                } as CompletedToolCallFromPython
              };
              void safeWrite(writer, encoder, 'streaming_event', event);
            }
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
          completed_tool_calls = result.completedTools;
        } else {
          finalPendingToolCalls = allPendingTools;
          break;
        }
      } else if (result.completedTools.length > 0) {
        completed_tool_calls = result.completedTools;
      } else {
        break;
      }
    }

    // Send final done event
    await safeWrite(writer, encoder, 'done', {
      type: 'done',
      conversationID: currentConversationID,
      log_index: currentLogIndex,
      pending_tool_calls: finalPendingToolCalls,
      completed_tool_calls: accumulatedCompletedToolCalls,
      debug: extractDebugMessages(accumulatedLogDiff),
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    if (error instanceof UserInterruptError) {
      await safeWrite(writer, encoder, 'done', {
        type: 'done',
        conversationID: currentConversationID,
        log_index: currentLogIndex,
        pending_tool_calls: [],
        completed_tool_calls: accumulatedCompletedToolCalls,
        debug: extractDebugMessages(accumulatedLogDiff),
        timestamp: new Date().toISOString()
      });
      return;
    }

    console.error('[CHAT STREAM] Error:', error);
    if (user) {
      appEventRegistry.publish(AppEvents.ERROR, {
        source: 'nextjs_stream',
        message: error.message || 'Stream error',
        mode: user.mode,
        context: { route: '/api/chat/stream' },
      });
    }
    await safeWrite(writer, encoder, 'error', {
      type: 'error',
      error: error.message || 'Unknown error',
      timestamp: new Date().toISOString()
    });
    await safeWrite(writer, encoder, 'done', {
      type: 'done',
      conversationID: currentConversationID,
      log_index: currentLogIndex,
      pending_tool_calls: [],
      completed_tool_calls: accumulatedCompletedToolCalls,
      debug: extractDebugMessages(accumulatedLogDiff),
      timestamp: new Date().toISOString()
    });
  } finally {
    try { await writer.close(); } catch { /* already closed */ }
  }
}

/**
 * POST /api/chat/stream
 * Streaming chat endpoint with Server-Sent Events.
 *
 * Uses TransformStream + async IIFE pattern: the Response is returned immediately
 * with the readable end, while the writable end is populated in a background task.
 * This prevents Next.js App Router from buffering the entire ReadableStream before
 * sending it to the client.
 */
export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();

  // Parse body and authenticate HERE, while the request context is still active.
  // getEffectiveUser() calls headers() from next/headers, which is tied to the
  // request lifecycle. If called from a background task after POST() returns,
  // the request context is gone and headers() hangs indefinitely — causing the
  // browser's await fetch() to block for the entire stream duration.
  const body: ChatRequest = await request.json();
  const user = await getEffectiveUser();

  if (!user) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();

  // Ping flushes response headers to the client immediately.
  writer.write(encoder.encode(': ping\n\n'));

  processStream(writer, encoder, body, user, request.signal).catch(err => {
    console.error('[chat/stream] Unhandled processStream error:', err);
    void writer.close().catch(() => {});
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Content-Encoding': 'identity',
    }
  });
}
