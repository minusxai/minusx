// ============================================================================
// Chat/conversation domain types — split out of lib/types.ts (thin barrel
// there re-exports everything here; see lib/types.ts for the barrel).
// ============================================================================

import { FileType } from '../ui/file-metadata';
import type { FileState } from '@/store/filesSlice';
import type { BaseFileContent, QueryResult, CompressedQueryResult } from './files';

// Chat attachment types
export type Attachment = {
  type: 'text' | 'image';
  name: string;
  content: string;
  // `language`/`sourceLabel` drive the selection-snippet chip (TextAttachmentCard);
  // all metadata is client-only — the server drops it (see lib/chat/attachments.server.ts).
  metadata?: { pages?: number; wordCount?: number; auto?: boolean; language?: string; sourceLabel?: string };
};

export interface ChatMentionData {
  id?: number;
  name: string;
  schema?: string;
  /** For column mentions: the table the column belongs to. */
  table?: string;
  /**
   * Connection (database) name for table/column/metric mentions — disambiguates
   * the same schema.table across connections. Set both by agent-authored mentions
   * (the agent sees connection names in its schema app-state) and by the UI picker
   * (propagated from the schema, same as `schema`). Absent on question/dashboard
   * mentions, which have no connection. Mirrors the `connection` field on context
   * annotations (CtxTableAnnotation).
   */
  connection?: string;
  source?: 'system' | 'user';
  type: 'table' | 'question' | 'dashboard' | 'skill' | 'column' | 'metric';
}

export type SkillMention =
  | (Omit<ChatMentionData, 'type' | 'source'> & {
      type: 'skill';
      source: 'system';
      description?: string;
    })
  | (Omit<ChatMentionData, 'type' | 'source'> & {
      type: 'skill';
      source: 'user';
      description?: string;
      content?: string;
    });

export interface SlashCommand {
  type: 'command';
  name: string;
  label: string;
  description: string;
  disabled?: boolean;
  disabledReason?: string;
}

export type AgentSkillSelection =
  | { type: 'system'; name: string }
  | { type: 'user'; name: string; content: string; description?: string };

export interface AgentUserSkillCatalogItem {
  name: string;
  description?: string;
}

// AI Chat types (OpenAI-compatible)
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;           // Tool name (e.g., "GetMetadata", "ExecuteSQL")
    arguments: Record<string, any>;  // Always an object - HTTP response handles JSON serialization
    child_tasks_batch?: Array<Array<{  // Child results grouped by run_id (optional, runtime only, not persisted)
      tool_call_id: string;
      agent: string;
      args: any;
      result: any;
    }>>;
  };
  _parent_unique_id?: string;  // For child tools spawned by parent (not in OpenAI spec)
}

// Tool call details — structured metadata for UI rendering (not sent to LLM)
export interface ToolCallDetails {
  success: boolean;
  error?: string;
  message?: string;  // human-readable status message
}

export interface EditFileDetails extends ToolCallDetails {
  diff: string;
  /** Full-view screenshot captured for the post-edit review (rubric v2). UI-only, survives
   *  the turn like ScreenshotDetails.screenshotUrl. */
  screenshotUrl?: string;
}

export interface ScreenshotDetails extends ToolCallDetails {
  /** The captured image URL, for the chat display. The LLM gets the image via the content
   *  image_url block; this UI-only `details` field survives the turn (content can be reloaded
   *  stringified), so the displayed image doesn't vanish after the turn completes. */
  screenshotUrl?: string;
}

export interface ClarifyDetails extends ToolCallDetails {
  selection?: any;  // the user's selection (for highlighting chosen option)
}

export interface ToolMessage {
  role: 'tool';
  tool_call_id: string;
  content: string | any;    // Can be string or object
  details?: ToolCallDetails;  // Structured metadata for UI rendering (not sent to LLM)
}

/**
 * Convert a ToolMessage to typed details for display components.
 * Prefers structured `details` (new); falls back to parsing `content` (old conversations
 * and server-side tools that don't populate `details`).
 * Spreading parsed content allows tool-specific fields (e.g. `selection`) through.
 */
export function contentToDetails<T extends ToolCallDetails>(toolMessage: ToolMessage): T {
  if (toolMessage.details) return toolMessage.details as T;
  try {
    const parsed = typeof toolMessage.content === 'string'
      ? JSON.parse(toolMessage.content)
      : (toolMessage.content ?? {});
    return { success: false, ...parsed } as T;
  } catch {
    return { success: false } as T;
  }
}

export type CompletedToolCall = [ToolCall, ToolMessage];

// Tool names (centralized)
export const ToolNames = {
  SEARCH_DB_SCHEMA: 'SearchDBSchema',
  TALK_TO_USER: 'TalkToUser',
  ANALYST_AGENT: 'AnalystAgent',
  ATLAS_ANALYST_AGENT: 'AtlasAnalystAgent',
  TEST_AGENT: 'TestAgent',
  EXECUTE_QUERY: 'ExecuteQuery',
  ONBOARDING_CONTEXT_AGENT: 'OnboardingContextAgent',
  ONBOARDING_DASHBOARD_AGENT: 'OnboardingDashboardAgent',
  SLACK_AGENT: 'SlackAgent',
} as const;

/**
 * Conversation Management Types
 * For file-based conversation storage with orchestration tasks
 */

/**
 * Conversation metadata
 */
export type ConversationSource =
  | { type: 'slack'; teamId: string; channelId: string; threadTs: string; channelName?: string }
  | { type: 'mcp'; sessionId: string };

export interface ConversationMetadata {
  userId: string;
  name: string;  // Auto-generated from first user message (truncated to 50 chars)
  createdAt: string;
  updatedAt: string;
  logLength?: number;  // Track log length for conflict detection
  forkedFrom?: number;  // Track conversation lineage (file ID of parent)
  source?: ConversationSource;  // Set when conversation originates from an external integration
}

/**
 * Conversation log entry types (append-only conversation log)
 */
export interface TaskLogEntry {
  _type: 'task';
  _parent_unique_id?: string | null;
  _previous_unique_id?: string | null;
  _run_id: string;
  agent: string;
  args: any;
  unique_id: string;
  created_at: string;  // ISO timestamp
}

export interface TaskResultEntry {
  _type: 'task_result';
  _task_unique_id: string;
  result: string | any | null;
  created_at: string;  // ISO timestamp
  details?: ToolCallDetails;  // UI-only: preserved across reloads, ignored by the orchestrator
}

export interface TaskDebugEntry {
  _type: 'task_debug';
  _task_unique_id: string;
  duration: number;
  llmDebug: any[];
  extra?: any;
  created_at: string;  // ISO timestamp
}

export type ConversationLogEntry = TaskLogEntry | TaskResultEntry | TaskDebugEntry;

/**
 * LLM debug information for a single LLM API call
 * Extracted from TaskDebugEntry.llmDebug array
 */
export interface LLMDebugInfo {
  model: string;
  duration: number;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  /** Tokens served from / written to the provider prompt cache (from usage.cacheRead/cacheWrite). */
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  cost: number;
  completion_tokens_details?: any;
  prompt_tokens_details?: any;
  finish_reason?: string;
  lllm_call_id?: string;
  lllm_overhead_time_ms?: number;
}

/**
 * Debug information for a single task/message
 * Built from TaskDebugEntry for display purposes
 */
export interface MessageDebugInfo {
  task_unique_id: string;
  duration: number;
  llmDebug: LLMDebugInfo[];
  extra?: any;
  created_at: string;
}

/**
 * Conversation file structure
 * Stored in /logs/conversations/{userId}/{conversationId}-{name}.chat.json
 */
/**
 * Append-only error log entry persisted on the conversation document alongside
 * the orchestrator log. NEVER sent to the LLM (filtered out of pi-ai context);
 * surfaced in the UI as a distinct ErrorMessage row. One entry per failure point —
 * LLM call, server tool, frontend tool, transport, persist, session, unhandled.
 */
export interface ErrorLogEntry {
  _type: 'error';
  source: 'llm' | 'server-tool' | 'frontend-tool' | 'persist' | 'transport' | 'session' | 'unhandled';
  message: string;
  timestamp: number;
  parent_id?: string;
  details?: {
    http_status?: number;
    request_id?: string;
    tool_name?: string;
    tool_call_id?: string;
    retry_count?: number;
    stack?: string;
  };
}

export interface ConversationFileContent extends BaseFileContent {
  metadata: ConversationMetadata;
  log: ConversationLogEntry[];
  /** Parallel error log — append-only, separate from pi-ai's `log` so pi-ai's
   *  context-builder is untouched. UI merges by timestamp. */
  errors?: ErrorLogEntry[];
}

export type ChatViewMode = 'compact' | 'detailed';

export interface DisplayProps {
  toolCallTuple: CompletedToolCall;
  databaseName?: string;
  isCompact?: boolean;
  showThinking: boolean;
  toggleShowThinking?: () => void;
  markdownContext?: 'sidebar' | 'mainpage';
  readOnly?: boolean;
  viewMode?: ChatViewMode;
  conversationID?: number;  // Owning conversation (for suggested-question clicks)
  userMessageLogIndex?: number;  // logIndex of the user message this response answers (for feedback)
  isLastAssistantMessage?: boolean;  // true if this is the last assistant message in the conversation (controls suggested questions visibility)
}

// ============================================================================
// Phase 1: Unified File System API Types
// ============================================================================


export interface AugmentedFile {
  fileState: FileState;        // The requested file (always defined when item exists in Redux)
  references: FileState[];     // Referenced files belonging to this file
  queryResults: QueryResult[]; // Query results for this file and its references (raw, untruncated)
}

/**
 * CompressedFileState — pre-merged view of a FileState for model consumption.
 * content = { ...content, ...persistableChanges } so oldMatch is just a copy.
 */
export interface CompressedFileState {
  id: number;
  name: string;   // effective name (metadataChanges.name ?? name)
  path: string;   // effective path  (metadataChanges.path ?? path)
  type: FileType;
  isDirty: boolean;             // true if unpublished changes exist
  queryResultId?: string;        // computed hash of query+params+database (questions only)
  content?: FileState['content']; // merged: { ...content, ...persistableChanges }. Optional: stripped
                                 // at the LLM boundary (the agent reads `markup`, not JSON content).
  markup?: string;               // File Architecture v2 — the agent's edit surface (jsx body
                                 // for documents, keyvalue→XML for props); mirrors buildCurrentFileStr
  /** A single screenshot of the rendered file, attached client-side at send time. `key` is a
   *  stable identity for cross-turn dedup by the projection pass. Replaces the old per-chart
   *  image series. */
  image?: { key: string; url?: string; data?: string; mimeType?: string };
}

export interface CompressedAugmentedFile {
  fileState: CompressedFileState;
  references: CompressedFileState[];
  queryResults: CompressedQueryResult[];
}

/**
 * Unified `ReadFiles` tool output — the single shape every read path emits (frontend-bridge
 * and server/headless), identical in structure to the AppState `file` payload. Imported by
 * both `agents/analyst/file-tools.ts` and `lib/tools/tool-handlers.ts` so the envelope can't drift.
 */
export interface ReadFilesResult {
  success: boolean;
  files: CompressedAugmentedFile[];
}

/**
 * ExecuteQuery Tool - Standalone query execution
 */
export interface ExecuteQueryInput {
  query: string;
  connectionId: string;         // Connection name/ID
  parameters?: Record<string, any>;
}

export interface ExecuteQueryDetails extends ToolCallDetails {
  queryResult?: QueryResult;  // new messages: raw rows/columns for UI rendering
  // Old-message compat: contentToDetails spreads content fields through
  columns?: string[];
  types?: string[];
  rows?: Record<string, any>[];
  data?: string;  // Markdown table from compressQueryResult (present in historical messages)
}
