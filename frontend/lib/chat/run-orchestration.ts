/**
 * Server-side chat orchestration loop.
 *
 * Extracted from /api/chat/route.ts so job handlers (e.g. report-handler.ts)
 * can run a full agent execution without going through HTTP.
 *
 * Caller is responsible for importing tool handlers before calling this:
 *   import '@/app/api/chat/tool-handlers.server';
 */
import 'server-only';
import { getOrCreateConversation, appendLogToConversation } from '@/lib/conversations';
import { pythonBackendFetch } from '@/lib/api/python-backend-client';
import { orchestratePendingTools } from '@/app/api/chat/orchestrator';
import { resolveHomeFolderSync } from '@/lib/mode/path-resolver';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { ConversationLogEntry } from '@/lib/types';
import type { PythonChatRequest, PythonChatResponse, CompletedToolCallPayload } from '@/lib/chat-orchestration';

export interface RunOrchestrationParams {
  agent: string;
  agent_args: Record<string, any>;
  user: EffectiveUser;
  userMessage?: string;
  /** Timeout in ms for each Python backend call. Default 5 min. */
  timeoutMs?: number;
}

export interface RunOrchestrationResult {
  conversationId: number;
  log: ConversationLogEntry[];
}

async function callPythonBackend(request: PythonChatRequest, timeoutMs: number): Promise<PythonChatResponse> {
  const response = await pythonBackendFetch('/api/chat', {
    method: 'POST',
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Python backend error: ${response.status} - ${errorText}`);
  }
  return response.json();
}

/**
 * Run a full agent orchestration loop (Python LLM calls + Next.js tool execution).
 *
 * Creates a new conversation, drives the Python↔Next.js loop to completion,
 * and returns the conversation ID + full accumulated log.
 *
 * Note: frontend-only tools (those that throw FrontendToolException) cannot
 * be handled here. If the agent requires them the loop will break early.
 */
export async function runChatOrchestration({
  agent,
  agent_args,
  user,
  userMessage = 'Execute',
  timeoutMs = 300_000,
}: RunOrchestrationParams): Promise<RunOrchestrationResult> {
  const { fileId: convFileId, content: conversation } = await getOrCreateConversation(null, user, userMessage);

  const baseLog: ConversationLogEntry[] = conversation.log;
  let currentFileId = convFileId;
  let currentLogIndex = baseLog.length;
  let accumulatedLogDiff: ConversationLogEntry[] = [];
  let completed_tool_calls: CompletedToolCallPayload[] = [];
  let user_message: string | null = userMessage;

  const resolvedHomeFolder = resolveHomeFolderSync(user.mode, user.home_folder || '');

  while (true) {
    const requestPayload: PythonChatRequest = {
      log: [...baseLog, ...accumulatedLogDiff],
      user_message,
      completed_tool_calls,
      agent,
      agent_args: { ...agent_args, home_folder: resolvedHomeFolder },
    };

    const pythonResponse = await callPythonBackend(requestPayload, timeoutMs);
    accumulatedLogDiff.push(...pythonResponse.logDiff);

    const appendResult = await appendLogToConversation(
      currentFileId,
      pythonResponse.logDiff,
      currentLogIndex,
      user
    );
    currentFileId = appendResult.fileId;
    currentLogIndex += pythonResponse.logDiff.length;

    user_message = null;

    if (pythonResponse.pending_tool_calls.length === 0) break;

    // Execute Next.js-side tools (database queries, file access, etc.)
    const result = await orchestratePendingTools(
      pythonResponse.pending_tool_calls,
      currentFileId,
      currentLogIndex,
      user
    );

    currentFileId = result.updatedFileId;
    currentLogIndex = result.updatedLogIndex;
    accumulatedLogDiff.push(...result.logEntries);

    if (result.remainingPendingTools.length > 0) {
      // Frontend-only tools remain — cannot execute server-side, stop here
      break;
    }

    if (result.completedTools.length === 0) break;

    completed_tool_calls = result.completedTools;
  }

  return {
    conversationId: currentFileId,
    log: [...baseLog, ...accumulatedLogDiff],
  };
}
