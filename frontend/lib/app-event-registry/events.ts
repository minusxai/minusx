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
  ERROR:                    'error',
} as const;

export type AppEventName = typeof AppEvents[keyof typeof AppEvents];

interface BaseEventPayload {
  companyId: number;
}

export interface AppEventPayloads {
  'file:created':             BaseEventPayload & { fileId: number; fileType?: string; filePath?: string; fileName?: string; userId?: number; userEmail?: string; userRole?: string };
  'file:viewed':              BaseEventPayload & { fileId: number; fileType?: string; filePath?: string; fileName?: string; userId?: number; userEmail?: string; userRole?: string };
  'file:viewed_as_reference': BaseEventPayload & { fileId: number; fileType?: string; filePath?: string; fileName?: string; userId?: number; userEmail?: string; userRole?: string; referencedByFileId: number; referencedByFileType?: string };
  'file:updated':             BaseEventPayload & { fileId: number; fileType?: string; filePath?: string; fileName?: string; userId?: number; userEmail?: string; userRole?: string };
  'file:deleted':             BaseEventPayload & { fileId: number; fileType?: string; filePath?: string; fileName?: string; userId?: number; userEmail?: string; userRole?: string };
  'folder:created':           BaseEventPayload & { folderId: number; folderPath: string; folderName: string; userId?: number; userEmail?: string; userRole?: string };
  'llm:call':                 BaseEventPayload & { conversationId: number; llmCalls: Record<string, LLMCallDetail>; userId?: number; userEmail?: string; userRole?: string };
  'error':                    BaseEventPayload & { source: string; message: string; error?: unknown; context?: Record<string, unknown> };
}
