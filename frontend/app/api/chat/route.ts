import { NextRequest, NextResponse } from 'next/server';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import {
  getOrCreateConversation,
  appendLogToConversation
} from '@/lib/conversations';
import { ToolCall, ConversationLogEntry } from '@/lib/types';
import {
  ChatRequest,
  CompletedToolCallFromPython,
  PythonChatRequest,
  PythonChatResponse,
  LLMCallDetail
} from '@/lib/chat-orchestration';
// Import tool handlers first to register them
import './tool-handlers.server';
import { orchestratePendingTools } from './orchestrator';
import { pythonBackendFetch } from '@/lib/api/python-backend-client';
import { trackLLMCallEvents } from '@/lib/analytics/file-analytics.server';
import { resolveHomeFolderSync } from '@/lib/mode/path-resolver';
import { UserInterruptError } from '@/lib/errors/user-interrupt-error';

/**
 * Chat response to frontend
 */
interface ChatResponse {
  conversationID: number;            // File ID (changed from string)
  log_index: number;
  pending_tool_calls: ToolCall[];                         // Can be non-empty if tools pending
  completed_tool_calls: CompletedToolCallFromPython[];    // Flat list from Python - frontend can group by run_id if needed
  credits?: number | null;                                // Optional
  error?: string | null;
}

/**
 * Call Python backend /api/chat endpoint
 */
async function callPythonBackend(request: PythonChatRequest): Promise<PythonChatResponse> {
  const response = await pythonBackendFetch('/api/chat', {
    method: 'POST',
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(300000) // 5 minute timeout
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Python backend error: ${response.status} - ${errorText}`);
  }

  return response.json();
}

/**
 * POST /api/chat
 * Main chat endpoint for conversation management
 */
export async function POST(request: NextRequest) {
  let fileId: number | null = null;
  let body: ChatRequest | undefined;

  // Declare variables outside try block so they're accessible in catch
  let currentConversationID = 0;
  let currentLogIndex = 0;
  let accumulatedCompletedToolCalls: CompletedToolCallFromPython[] = [];

  try {
    // Parse request body
    body = await request.json();

    if (!body) {
      throw new Error('Invalid request body');
    }

    // Get effective user
    const user = await getEffectiveUser();

    if (!user || !user.companyId) {
      return NextResponse.json(
        {
          conversationID: 0,
          log_index: 0,
          pending_tool_calls: [],
          completed_tool_calls: [],
          error: 'No company ID found for user'
        } as ChatResponse,
        { status: 401 }
      );
    }

    // Step 1: Get or create conversation file (pass first message for naming)
    const { fileId: convFileId, content: conversation } = await getOrCreateConversation(
      body.conversationID ?? null,  // null to create new
      user,
      body.user_message ?? undefined  // Pass first message for naming
    );
    fileId = convFileId;

    // Step 2: Load conversation log up to log_index (default to full log)
    const initial_log_index = body.log_index ?? conversation.log.length;
    const log: ConversationLogEntry[] = conversation.log.slice(0, initial_log_index);

    // Step 3: Setup loop variables
    let completed_tool_calls = body.completed_tool_calls?.map(tuple => tuple[1]) || [];
    let user_message: string | null = body.user_message || null;
    let accumulatedLogDiff: ConversationLogEntry[] = [];
    accumulatedCompletedToolCalls = [];  // Use outer scope variable
    let accumulatedLLMCalls: Record<string, LLMCallDetail> = {};
    let pythonResponse: PythonChatResponse;
    currentConversationID = convFileId;  // Use outer scope variable - Start with created/loaded file ID
    let currentFileId = fileId;
    currentLogIndex = initial_log_index;  // Use outer scope variable
    let finalPendingToolCalls: ToolCall[] = [];

    // Step 5: Execute agent and tools in a loop
    while (true) {
      // Resolve home folder with mode for agent context
      const resolvedHomeFolder = resolveHomeFolderSync(user.mode, user.home_folder || '');

      // Call Python backend
      const requestPayload = {
        log: [...log, ...accumulatedLogDiff],
        user_message,
        completed_tool_calls,
        agent: body.agent || 'DefaultAgent',
        agent_args: {
          ...(body.agent_args || {}),
          home_folder: resolvedHomeFolder  // Add resolved home folder to agent args
        }
      };
      pythonResponse = await callPythonBackend(requestPayload);

      // Accumulate logDiff and completed tool calls
      accumulatedLogDiff.push(...pythonResponse.logDiff);
      accumulatedCompletedToolCalls.push(...pythonResponse.completed_tool_calls);

      // Accumulate LLM calls
      if (pythonResponse.llm_calls) {
        accumulatedLLMCalls = { ...accumulatedLLMCalls, ...pythonResponse.llm_calls };
      }

      // Check for interruption before saving
      if (request.signal.aborted) {
        console.log('[CHAT] Request aborted - marking pending tools as interrupted');

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
        currentConversationID = appendResult.conversationID;
        currentFileId = appendResult.fileId;
        currentLogIndex += accumulatedLogDiff.length;

        throw new UserInterruptError();
      }

      // Append to conversation (may fork if conflict detected)
      const appendResult = await appendLogToConversation(
        currentFileId,
        pythonResponse.logDiff,
        currentLogIndex,
        user
      );

      // Update variables with potentially new conversationID and fileId
      currentConversationID = appendResult.conversationID;
      currentFileId = appendResult.fileId;
      currentLogIndex += pythonResponse.logDiff.length;

      // Track LLM call analytics in DuckDB (fire-and-forget)
      // IMPORTANT: Use UPDATED currentConversationID (may have changed due to forking)
      if (pythonResponse.llm_calls && Object.keys(pythonResponse.llm_calls).length > 0) {
        trackLLMCallEvents(pythonResponse.llm_calls, currentConversationID, user.companyId).catch(
          (err: unknown) => console.error('[LLM Analytics] Failed to track:', err)
        );
      }

      // Clear user_message after first call (subsequent calls are tool completions only)
      user_message = null;

      // No more pending tools - we're done
      if (pythonResponse.pending_tool_calls.length === 0) {
        break;
      }

      // Orchestrate Next.js backend tool execution
      const result = await orchestratePendingTools(
        pythonResponse.pending_tool_calls,
        currentFileId,
        currentLogIndex,
        user,
        request.signal  // Pass abort signal
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

    // Return response - conversationID may have changed if forked
    return NextResponse.json({
      conversationID: currentConversationID,
      log_index: currentLogIndex,
      pending_tool_calls: finalPendingToolCalls,  // Includes spawned frontend tools
      completed_tool_calls: accumulatedCompletedToolCalls,
      credits: null,
      error: pythonResponse.error
    } as ChatResponse);

  } catch (error: any) {
    // Handle user interruption gracefully
    if (error instanceof UserInterruptError) {
      console.log('[CHAT] User interrupted - returning gracefully');

      // Log already saved before throwing, return response with correct log_index
      return NextResponse.json({
        conversationID: currentConversationID,
        log_index: currentLogIndex,  // IMPORTANT: Return actual log index after save
        pending_tool_calls: [],
        completed_tool_calls: accumulatedCompletedToolCalls,
        error: 'Interrupted by user'
      } as ChatResponse);
    }

    // Handle other errors
    console.error('Chat API error:', error);

    return NextResponse.json(
      {
        conversationID: body?.conversationID || 0,
        log_index: 0,
        pending_tool_calls: [],
        completed_tool_calls: [],
        credits: null,
        error: error.message || 'Unknown error occurred'
      } as ChatResponse,
      { status: 500 }
    );
  }
}
