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

export interface AppEventPayloads {
  'file:created':             { fileId: number; fileType?: string; filePath?: string; fileName?: string; companyId: number; userId?: number; userEmail?: string; userRole?: string };
  'file:viewed':              { fileId: number; fileType?: string; filePath?: string; fileName?: string; companyId: number; userId?: number; userEmail?: string; userRole?: string };
  'file:viewed_as_reference': { fileId: number; fileType?: string; filePath?: string; fileName?: string; companyId: number; userId?: number; userEmail?: string; userRole?: string; referencedByFileId: number; referencedByFileType?: string };
  'file:updated':             { fileId: number; fileType?: string; filePath?: string; fileName?: string; companyId: number; userId?: number; userEmail?: string; userRole?: string };
  'file:deleted':             { fileId: number; fileType?: string; filePath?: string; fileName?: string; companyId: number; userId?: number; userEmail?: string; userRole?: string };
  'folder:created':           { folderId: number; folderPath: string; folderName: string; companyId: number; userId?: number; userEmail?: string; userRole?: string };
  'llm:call':                 { conversationId: number; llmCalls: Record<string, LLMCallDetail>; companyId: number; userId?: number; userEmail?: string; userRole?: string };
  'error':                    { source: string; message: string; error?: unknown; context?: Record<string, unknown> };
}
