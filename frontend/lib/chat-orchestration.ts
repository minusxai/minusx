/**
 * Shared chat request/response types — the request (`ChatRequest`) and the
 * completed-tool-call / LLM-call payloads that the chat API routes and the
 * orchestrator translator (`chat-orchestration-v2.server.ts`) produce.
 */

import { CompletedToolCall } from '@/lib/types';

/**
 * Chat request from the frontend.
 */
export interface ChatRequest {
  conversationID?: number | null;   // Optional - file ID, null to create new
  log_index?: number | null;        // Index to load log up to (replaces tasks_id)
  user_message?: string | null;
  source?: 'explore' | 'side_chat'; // Where the message originated
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
    skills?: {
      selected?: import('@/lib/types').AgentSkillSelection[];
      user_catalog?: import('@/lib/types').AgentUserSkillCatalogItem[];
    };
  };
}

/**
 * Completed tool call as returned to the frontend — call + response info in a
 * single object.
 */
export interface CompletedToolCallResult {
  role: "tool";
  tool_call_id: string;
  content: string | any;
  run_id: string;
  function: {
    name: string;
    arguments: Record<string, any>;  // Always an object - HTTP response handles JSON serialization
  };
  created_at: string;  // ISO timestamp
  details?: import('@/lib/types').ToolCallDetails;  // Server-tool details for the UI; never sent to the LLM
}

/**
 * Per-LLM-call detail surfaced for analytics.
 */
export interface LLMCallDetail {
  llm_call_id: string;
  provider?: string;
  model: string;
  duration: number;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  cached_tokens?: number;
  cache_creation_tokens?: number;
  reasoning_tokens?: number;
  system_prompt_tokens?: number;
  app_state_tokens?: number;
  total_tool_calls?: number;
  cost: number;
  stream?: boolean;
  finish_reason?: string | null;
  trigger?: string | null;  // What initiated this LLM call: "user_message", "tool_result", etc.
}
