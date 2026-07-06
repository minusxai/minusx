import type { LLMCallDetail } from '@/lib/chat/chat-types';

export const AppEvents = {
  FILE_CREATED:             'file:created',
  FILE_VIEWED:              'file:viewed',
  FILE_VIEWED_AS_REFERENCE: 'file:viewed_as_reference',
  FILE_UPDATED:             'file:updated',
  FILE_DELETED:             'file:deleted',
  FOLDER_CREATED:           'folder:created',
  LLM_CALL:                 'llm:call',
  QUERY_EXECUTED:           'query:executed',
  ERROR:                    'error',
  JOB_CRON_SUCCEEDED:       'job:cron_succeeded',
  JOB_CRON_FAILED:          'job:cron_failed',
  USER_MESSAGE:             'user:message',
  MCP_TOOL_CALL:            'mcp:tool_call',
  USER_LOGGED_IN:           'user:login',
  USER_CREATED:             'user:created',
  USER_DELETED:             'user:deleted',
  FEEDBACK:                 'user:feedback',
  SHARE_LEAD:               'share:lead',
  SHARE_OPEN:               'share:open',
} as const;

export type AppEventName = typeof AppEvents[keyof typeof AppEvents];

interface BaseEventPayload {
  mode: string;
}

export interface AppEventPayloads {
  'file:created':             BaseEventPayload & { fileId: number; fileVersion?: number; fileType?: string; filePath?: string; fileName?: string; userId?: number; userEmail?: string; userRole?: string };
  'file:viewed':              BaseEventPayload & { fileId: number; fileVersion?: number; fileType?: string; filePath?: string; fileName?: string; userId?: number; userEmail?: string; userRole?: string };
  'file:viewed_as_reference': BaseEventPayload & { fileId: number; fileVersion?: number; fileType?: string; filePath?: string; fileName?: string; userId?: number; userEmail?: string; userRole?: string; referencedByFileId: number; referencedByFileType?: string };
  'file:updated':             BaseEventPayload & { fileId: number; fileVersion?: number; fileType?: string; filePath?: string; fileName?: string; userId?: number; userEmail?: string; userRole?: string };
  'file:deleted':             BaseEventPayload & { fileId: number; fileVersion?: number; fileType?: string; filePath?: string; fileName?: string; userId?: number; userEmail?: string; userRole?: string };
  'folder:created':           BaseEventPayload & { folderId: number; folderPath: string; folderName: string; userId?: number; userEmail?: string; userRole?: string };
  // `conversationId` is present for conversation-bound turns (chat UI / onboarding);
  // headless one-shot runs (feed-summary, micro-tasks, …) omit it and set `task`
  // instead so usage can be sliced by use-case without a conversation.
  'llm:call':                 BaseEventPayload & { conversationId?: number; task?: string; llmCalls: Record<string, LLMCallDetail>; userId?: number; userEmail?: string; userRole?: string };
  'query:executed':           BaseEventPayload & { queryHash: string; fileId?: number | null; fileVersion?: number | null; query?: string; params?: Record<string, unknown>; schemaContext?: Array<{ schema: string; table: string; columns: string[] }>; databaseName: string | null; durationMs: number; rowCount: number; colCount?: number; wasCacheHit: boolean; error?: string | null; userId?: number; userEmail?: string | null };
  'error':                    BaseEventPayload & { source: string; message: string; mode?: string; error?: unknown; context?: Record<string, unknown> };
  'job:cron_succeeded':       BaseEventPayload & { triggered: number; skipped: number };
  'job:cron_failed':          BaseEventPayload & { triggered: number; skipped: number; failed: number };
  'user:message':             BaseEventPayload & { source: 'explore' | 'side_chat' | 'slack' | 'mcp'; conversationId?: number; userId?: number; userEmail?: string; messagePreview?: string };
  'mcp:tool_call':            BaseEventPayload & { sessionId: string; tool: string; userId?: number; userEmail?: string };
  'user:login':               BaseEventPayload & { userId?: number; userEmail?: string; role?: string };
  'user:created':             BaseEventPayload & { userId?: number; userEmail?: string; role?: string; createdBy?: string };
  'user:deleted':             BaseEventPayload & { userId?: number; userEmail?: string; role?: string; deletedBy?: string };
  'user:feedback':            BaseEventPayload & { conversationId: number; userMessageLogIndex: number; rating: 'positive' | 'negative'; tags: string[]; comment?: string; userId?: number; userEmail?: string };
  // Anonymous guest submitted name/email on a public share (lead capture).
  // `userEmail` mirrors `email` for consistency with other events' attribution.
  'share:lead':               BaseEventPayload & { fileId: number; nonce: string; storyName: string; name: string; email: string; userEmail: string; folderPath: string };
  // First open of a public share by a new visitor. `anonymous` = no lead captured.
  'share:open':               BaseEventPayload & { fileId: number; nonce: string; storyName: string; folderPath: string; anonymous: boolean; uid: number; userEmail?: string };
}
