/**
 * Shared chat orchestration utilities
 *
 * Contains types, utilities, and common logic for chat API routes.
 * Used by both streaming and non-streaming chat endpoints.
 */

import 'server-only';
import { ToolCall, CompletedToolCall, ConversationLogEntry } from '@/lib/types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import { appendLogToConversation } from '@/lib/conversations';

// ============================================================================
// Shared Types
// ============================================================================

/**
 * Chat request from frontend
 */
export interface ChatRequest {
  conversationID?: number | null;   // Optional - file ID, null to create new
  log_index?: number | null;        // Index to load log up to (replaces tasks_id)
  user_message?: string | null;
  completed_tool_calls?: CompletedToolCall[];  // Array of [ToolCall, ToolMessage] tuples
  agent?: string;                   // Agent name
  agent_args?: {
    selected_database_info?: {
      name: string;
      dialect: string;
    };
    schema?: Array<{
      schema: string;
      tables: string[];
    }>;
    context?: string;
    app_state?: any;
    page_type?: string;
  };
}

/**
 * Completed tool call payload for Python backend
 * Matches ChatCompletionToolMessageParamMX from Python backend
 */
export interface CompletedToolCallPayload {
  role: "tool";  // Required for OpenAI ChatCompletionToolMessageParamMX
  tool_call_id: string;
  content: string | any;  // Can be string or object (matches Python Union[str, dict])
}

/**
 * Completed tool call from Python backend
 * Contains both call and response info in a single object
 */
export interface CompletedToolCallFromPython {
  role: "tool";
  tool_call_id: string;
  content: string | any;
  run_id: string;
  function: {
    name: string;
    arguments: Record<string, any>;  // Always an object - HTTP response handles JSON serialization
  };
  created_at: string;  // ISO timestamp
}

/**
 * Python backend chat request (aligned with Python ConversationRequest)
 */
export interface PythonChatRequest {
  log: ConversationLogEntry[];  // Full conversation log
  user_message?: string | null;
  completed_tool_calls?: CompletedToolCallPayload[];
  agent: string;
  agent_args: any;
}

/**
 * LLM call detail from Python backend
 */
export interface LLMCallDetail {
  llm_call_id: string;
  model: string;
  duration: number;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost: number;
  finish_reason?: string | null;
}

/**
 * Python backend chat response (aligned with Python ConversationResponse)
 */
export interface PythonChatResponse {
  logDiff: ConversationLogEntry[];  // Only new log entries
  pending_tool_calls: ToolCall[];
  completed_tool_calls: CompletedToolCallFromPython[];  // NEW - completed tool calls
  llm_calls?: Record<string, LLMCallDetail>;  // NEW - optional for backward compat
  error?: string | null;
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Generate unique tool call ID matching Python backend format
 */
export function generate_unique_tool_call_id(): string {
  // Generate random hex string similar to Python's secrets.token_hex(12)
  const randomBytes = Array.from({ length: 12 }, () =>
    Math.floor(Math.random() * 256).toString(16).padStart(2, '0')
  ).join('');
  return `mxgen_${randomBytes}`;
}
