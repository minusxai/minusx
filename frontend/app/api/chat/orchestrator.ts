/**
 * Next.js Backend Orchestrator
 *
 * Core orchestration logic for executing pending tools from Python backend.
 * Uses a registry pattern for extensibility - tools register themselves
 * via registerTool() and can be looked up dynamically.
 *
 * Handles:
 * - Tool execution via registry
 * - FrontendToolException (spawning children)
 * - Conversation appending (with fork detection)
 * - Event emission (for streaming)
 */

import { ToolCall, ConversationLogEntry } from '@/lib/types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import { appendLogToConversation } from '@/lib/conversations';
import { FrontendToolException } from './frontend-tool-exception';
import {
  CompletedToolCallPayload,
  generate_unique_tool_call_id
} from '@/lib/chat-orchestration';

// ============================================================================
// Exported Types for Tool Handlers
// ============================================================================

export interface ToolExecutionResult {
  role: "tool";
  tool_call_id: string;
  content: string | any;
}

/**
 * Result of orchestrating pending tool calls
 */
export interface OrchestrationResult {
  completedTools: CompletedToolCallPayload[];
  remainingPendingTools: ToolCall[];
  spawnedTools: ToolCall[];
  updatedFileId: number;
  updatedLogIndex: number;
  logEntries: ConversationLogEntry[];
}

/**
 * Optional callbacks for orchestration events (used for streaming)
 */
export interface OrchestrationCallbacks {
  onToolExecuting?: (tool: ToolCall) => void;
  onToolCompleted?: (tool: ToolCall, result: CompletedToolCallPayload) => void;
  onToolFailed?: (tool: ToolCall, error: Error) => void;
  onToolSpawned?: (parent: ToolCall, child: ToolCall) => void;
}

/**
 * Tool handler function signature
 * @param args - Destructured tool arguments
 * @param user - Effective user for permissions
 * @param childResults - Optional child task results (for parent tools resuming after spawning children)
 */
export type ToolHandler = (
  args: Record<string, any>,
  user: EffectiveUser,
  childResults?: ToolCall['function']['child_tasks_batch']
) => Promise<string | object>;

/**
 * Global tool registry
 */
const toolRegistry: Record<string, ToolHandler> = {};

/**
 * Register a tool handler
 * Tools call this function to register themselves with the orchestrator
 */
export function registerTool(name: string, handler: ToolHandler) {
  toolRegistry[name] = handler;
}

/**
 * Check if a tool can be executed by the Next.js backend
 */
export function canExecuteTool(toolCall: ToolCall): boolean {
  const toolName = toolCall.function?.name;
  return toolName ? toolName in toolRegistry : false;
}

/**
 * Execute a tool call on the Next.js backend (internal)
 */
async function executeToolInternal(toolCall: ToolCall, user: EffectiveUser): Promise<ToolExecutionResult> {
  const toolName = toolCall.function?.name;

  if (!toolName || !toolRegistry[toolName]) {
    throw new Error(`Tool ${toolName} cannot be executed by backend`);
  }

  // Call handler with destructured args
  const content = await toolRegistry[toolName](
    toolCall.function.arguments || {},
    user,
    toolCall.function.child_tasks_batch
  );

  // Wrap result in message structure
  return {
    role: "tool",
    tool_call_id: toolCall.id,
    content: typeof content === 'string' ? content : JSON.stringify(content)
  };
}

/**
 * Orchestrate execution of pending tool calls
 *
 * Handles:
 * - Tool execution via registry
 * - FrontendToolException (spawning children)
 * - Conversation appending (with fork detection)
 * - Event emission (for streaming)
 *
 * @param pendingTools - Tool calls from Python backend
 * @param fileId - Current conversation file ID
 * @param logIndex - Current log index
 * @param user - Effective user for permissions
 * @param signal - Optional abort signal to check for interruption
 * @param callbacks - Optional callbacks for streaming events
 * @returns Orchestration result with completed/pending/spawned tools
 */
export async function orchestratePendingTools(
  pendingTools: ToolCall[],
  fileId: number,
  logIndex: number,
  user: EffectiveUser,
  signal?: AbortSignal,
  callbacks?: OrchestrationCallbacks
): Promise<OrchestrationResult> {
  // Check abort at the very start (before executing any backend tools)
  if (signal?.aborted) {
    console.log('[orchestrator] Request aborted - skipping tool execution');
    // Return all tools as pending (skip execution)
    return {
      completedTools: [],
      remainingPendingTools: pendingTools,  // All tools still pending
      spawnedTools: [],
      logEntries: [],
      updatedFileId: fileId,
      updatedLogIndex: logIndex
    };
  }

  const completedTools: CompletedToolCallPayload[] = [];
  const remainingPendingTools: ToolCall[] = [];
  const spawnedTools: ToolCall[] = [];
  let currentFileId = fileId;
  let currentLogIndex = logIndex;
  const logEntries: ConversationLogEntry[] = [];

  // Process each pending tool
  for (const toolCall of pendingTools) {
    if (canExecuteTool(toolCall)) {
      // Backend can execute this tool
      try {
        callbacks?.onToolExecuting?.(toolCall);

        const result = await executeToolInternal(toolCall, user);
        completedTools.push(result);

        callbacks?.onToolCompleted?.(toolCall, result);
      } catch (error) {
        // Check if tool is spawning frontend tools
        if (error instanceof FrontendToolException) {
          // DON'T complete parent - spawn children instead
          for (const spawnedTool of error.spawnedTools) {
            const child: ToolCall = {
              id: generate_unique_tool_call_id(),  // New ID for child
              type: 'function' as const,
              function: spawnedTool.function,
              _parent_unique_id: toolCall.id  // Reference parent
            };

            spawnedTools.push(child);
            callbacks?.onToolSpawned?.(toolCall, child);
          }
          // Note: Parent tool is NOT added to completedTools or remainingPending
          // It remains pending in the log until children complete
        } else {
          // Other error - mark as failed
          const errorObj = error instanceof Error ? error : new Error(String(error));
          callbacks?.onToolFailed?.(toolCall, errorObj);

          // Record failure to avoid infinite loop
          completedTools.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({
              success: false,
              error: errorObj.message
            })
          });
        }
      }
    } else {
      // Tool requires frontend/user interaction
      remainingPendingTools.push(toolCall);
    }
  }

  // Append spawned children to conversation
  if (spawnedTools.length > 0) {
    // All spawned children in the same batch share a run_id
    const sharedRunId = generate_unique_tool_call_id();

    const childLogEntries: ConversationLogEntry[] = spawnedTools.map(toolCall => ({
      _type: 'task' as const,
      _parent_unique_id: toolCall._parent_unique_id!,
      _run_id: sharedRunId,  // All spawned children share the same run_id
      agent: toolCall.function.name,
      args: toolCall.function.arguments,
      unique_id: toolCall.id,
      created_at: new Date().toISOString()
    }));

    // Append to conversation (may fork if conflict detected)
    const appendResult = await appendLogToConversation(
      currentFileId,
      childLogEntries,
      currentLogIndex,
      user
    );

    currentFileId = appendResult.conversationID;
    currentLogIndex += childLogEntries.length;
    logEntries.push(...childLogEntries);
  }

  return {
    completedTools,
    remainingPendingTools,
    spawnedTools,
    updatedFileId: currentFileId,
    updatedLogIndex: currentLogIndex,
    logEntries
  };
}
