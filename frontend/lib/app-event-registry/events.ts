import 'server-only';
import type { LLMCallDetail } from '@/lib/chat-orchestration';

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
} as const;

export type AppEventName = typeof AppEvents[keyof typeof AppEvents];

interface BaseEventPayload {
  companyId: number;
  mode: string;
}

export interface AppEventPayloads {
  'file:created':             BaseEventPayload & { fileId: number; fileType?: string; filePath?: string; fileName?: string; userId?: number; userEmail?: string; userRole?: string };
  'file:viewed':              BaseEventPayload & { fileId: number; fileType?: string; filePath?: string; fileName?: string; userId?: number; userEmail?: string; userRole?: string };
  'file:viewed_as_reference': BaseEventPayload & { fileId: number; fileType?: string; filePath?: string; fileName?: string; userId?: number; userEmail?: string; userRole?: string; referencedByFileId: number; referencedByFileType?: string };
  'file:updated':             BaseEventPayload & { fileId: number; fileType?: string; filePath?: string; fileName?: string; userId?: number; userEmail?: string; userRole?: string };
  'file:deleted':             BaseEventPayload & { fileId: number; fileType?: string; filePath?: string; fileName?: string; userId?: number; userEmail?: string; userRole?: string };
  'folder:created':           BaseEventPayload & { folderId: number; folderPath: string; folderName: string; userId?: number; userEmail?: string; userRole?: string };
  'llm:call':                 BaseEventPayload & { conversationId: number; llmCalls: Record<string, LLMCallDetail>; userId?: number; userEmail?: string; userRole?: string };
  'query:executed':           { queryHash: string; databaseName: string | null; durationMs: number; rowCount: number; wasCacheHit: boolean; companyId: number; userEmail?: string | null };
  'error':                    BaseEventPayload & { source: string; message: string; mode?: string; error?: unknown; context?: Record<string, unknown> };
  'job:cron_succeeded':       BaseEventPayload & { triggered: number; skipped: number };
  'job:cron_failed':          BaseEventPayload & { triggered: number; skipped: number; failed: number };
}
